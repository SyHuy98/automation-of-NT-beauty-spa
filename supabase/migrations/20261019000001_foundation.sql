-- =============================================================================
-- Phase 1 – Nền móng: tài khoản, bảng giá dịch vụ, kỹ năng KTV, cài đặt.
-- Quy ước:
--   * Tiền lưu integer VND.
--   * Mọi khái niệm "hôm nay"/"tháng này" tính theo giờ Asia/Ho_Chi_Minh.
--   * Ghi dữ liệu nghiệp vụ quan trọng đi qua function SECURITY DEFINER có
--     kiểm tra quyền; RLS chỉ mở SELECT và vài thao tác CRUD đơn giản.
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Schema private: không được expose qua PostgREST, chứa cấu hình nội bộ
-- (URL Edge Function, secret nội bộ, khoá VAPID).
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Kiểu dữ liệu
-- -----------------------------------------------------------------------------
create type public.user_role as enum ('owner', 'manager', 'technician');
-- Ca làm: sáng 09–18, chiều 12–21, full 09–21, off = nghỉ (giờ cấu hình trong app_settings)
create type public.shift_type as enum ('morning', 'afternoon', 'full', 'off');

-- -----------------------------------------------------------------------------
-- Helper thời gian theo giờ VN
-- -----------------------------------------------------------------------------
create or replace function public.vn_today()
returns date
language sql stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Ho_Chi_Minh')::date $$;

-- Thời điểm 00:00 (giờ VN) của một ngày, dạng timestamptz
create or replace function public.vn_day_start(d date)
returns timestamptz
language sql immutable
set search_path = ''
as $$ select (d::timestamp at time zone 'Asia/Ho_Chi_Minh') $$;

create or replace function public.vn_date(ts timestamptz)
returns date
language sql immutable
set search_path = ''
as $$ select (ts at time zone 'Asia/Ho_Chi_Minh')::date $$;

-- Ngày đầu tháng (giờ VN) của một thời điểm
create or replace function public.vn_month(ts timestamptz)
returns date
language sql immutable
set search_path = ''
as $$ select date_trunc('month', ts at time zone 'Asia/Ho_Chi_Minh')::date $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 1 and 100),
  -- Tên đăng nhập: chữ thường, số, . _ - ; email ảo = <username>@ntspa.local
  username text not null unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  phone text check (phone is null or phone ~ '^[0-9 +.-]{8,20}$'),
  role public.user_role not null default 'technician',
  -- Ca mặc định (chỉ có nghĩa với KTV); ca thực tế theo ngày nằm ở shift_schedules / shift_checkins
  shift public.shift_type not null default 'morning',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Vai trò của người đang đăng nhập (null nếu không có hồ sơ hoặc bị khoá)
create or replace function public.auth_role()
returns public.user_role
language sql stable security definer
set search_path = ''
as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.is_active
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer
set search_path = ''
as $$ select coalesce(public.auth_role() in ('owner', 'manager'), false) $$;

create or replace function public.is_owner()
returns boolean
language sql stable security definer
set search_path = ''
as $$ select coalesce(public.auth_role() = 'owner', false) $$;

-- Request đến từ service role (Edge Function)?
create or replace function public.is_service_role()
returns boolean
language sql stable
set search_path = ''
as $$ select coalesce(auth.jwt() ->> 'role', '') = 'service_role' $$;

-- -----------------------------------------------------------------------------
-- services – bảng giá chung cho mọi KTV
-- -----------------------------------------------------------------------------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  tour_fee integer not null check (tour_fee >= 0 and tour_fee <= 100000000),
  duration_minutes integer not null check (duration_minutes between 1 and 600),
  -- Dịch vụ cần tay nghề riêng (HIFU, tiêm…): chỉ KTV có kỹ năng mới được gợi ý
  requires_skill boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger services_updated_at before update on public.services
  for each row execute function public.set_updated_at();

create table public.technician_skills (
  technician_id uuid not null references public.profiles (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (technician_id, service_id)
);

create index technician_skills_service_idx on public.technician_skills (service_id);

-- -----------------------------------------------------------------------------
-- app_settings – đúng 1 dòng
-- -----------------------------------------------------------------------------
create table public.app_settings (
  id boolean primary key default true check (id),
  offer_timeout_seconds integer not null default 120 check (offer_timeout_seconds between 30 and 900),
  shift_hours jsonb not null default '{
    "morning":   {"start": "09:00", "end": "18:00"},
    "afternoon": {"start": "12:00", "end": "21:00"},
    "full":      {"start": "09:00", "end": "21:00"}
  }'::jsonb,
  -- Trọng số thuật toán gợi ý (xem src/lib/assignment/score.ts)
  weights jsonb not null default '{
    "today": 40, "month": 25, "requested": 15, "idle": 15, "shiftEnd": 50, "declines": 5
  }'::jsonb,
  -- Ngưỡng lệch do tour chỉ định (% so với TB nhóm)
  requested_threshold_percent integer not null default 20 check (requested_threshold_percent between 0 and 200),
  -- Ngưỡng lệch thu nhập để cảnh báo trên biểu đồ cân bằng
  imbalance_threshold_percent integer not null default 20 check (imbalance_threshold_percent between 0 and 200),
  -- Số ứng viên tốt nhất đưa vào vòng quay ở chế độ Random cân bằng
  random_pool_size integer not null default 3 check (random_pool_size between 1 and 10),
  decline_reasons text[] not null default array[
    'Đang dở việc', 'Không làm được dịch vụ này', 'Sức khỏe', 'Khác – ghi rõ'
  ],
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

insert into public.app_settings default values;

create trigger app_settings_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.technician_skills enable row level security;
alter table public.app_settings enable row level security;

-- profiles: tự xem mình; owner/manager xem tất cả. Không có policy ghi:
-- tạo/sửa/khoá tài khoản chỉ đi qua Edge Function admin-users hoặc RPC owner.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());

-- services: ai đăng nhập cũng xem được; chỉ owner thêm/sửa (không xoá – chỉ ẩn)
create policy services_select on public.services for select to authenticated
  using (public.auth_role() is not null);
create policy services_insert on public.services for insert to authenticated
  with check (public.is_owner());
create policy services_update on public.services for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- technician_skills: KTV xem của mình; staff xem hết; owner gán/bỏ
create policy skills_select on public.technician_skills for select to authenticated
  using (technician_id = auth.uid() or public.is_staff());
create policy skills_insert on public.technician_skills for insert to authenticated
  with check (public.is_owner());
create policy skills_delete on public.technician_skills for delete to authenticated
  using (public.is_owner());

-- app_settings: mọi người đăng nhập đọc (KTV cần lý do từ chối, thời gian chờ); owner sửa
create policy settings_select on public.app_settings for select to authenticated
  using (public.auth_role() is not null);
create policy settings_update on public.app_settings for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- -----------------------------------------------------------------------------
-- Quyền thực thi function
-- -----------------------------------------------------------------------------
revoke execute on function public.auth_role() from public, anon;
revoke execute on function public.is_staff() from public, anon;
revoke execute on function public.is_owner() from public, anon;
grant execute on function public.auth_role() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_owner() to authenticated;
