-- =============================================================================
-- Phase 3/4/5 – Bảng nghiệp vụ: ca làm, tour, offer, nhật ký, thông báo,
-- push subscription, chốt lương, báo sai.
-- =============================================================================

create type public.tour_status as enum ('waiting', 'offered', 'in_progress', 'completed', 'cancelled');
create type public.assign_mode as enum ('suggest', 'auto', 'random', 'requested');
-- accepted = đã nhận, đang chờ KTV còn lại (tour 2 người); working = đang làm;
-- done = đã bấm hoàn thành phần của mình; removed = bị đổi người / tour huỷ
create type public.assignment_status as enum ('accepted', 'working', 'done', 'removed');
create type public.offer_status as enum ('pending', 'accepted', 'declined', 'expired', 'withdrawn');
create type public.dispute_status as enum ('open', 'resolved', 'rejected');
create type public.payroll_status as enum ('open', 'locked');

-- -----------------------------------------------------------------------------
-- Ca làm
-- -----------------------------------------------------------------------------
-- Lịch ca theo ngày do admin xếp (không bắt buộc). Không có dòng = dùng profiles.shift.
create table public.shift_schedules (
  technician_id uuid not null references public.profiles (id) on delete cascade,
  work_date date not null,
  shift public.shift_type not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (technician_id, work_date)
);

-- Vào/ra ca thực tế. Mỗi KTV tối đa 1 dòng/ngày (vào lại sau khi ra ca = mở lại dòng cũ).
create table public.shift_checkins (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles (id) on delete cascade,
  work_date date not null,
  shift public.shift_type not null check (shift <> 'off'),
  check_in_at timestamptz not null default now(),
  check_out_at timestamptz,
  unique (technician_id, work_date)
);

create index shift_checkins_open_idx on public.shift_checkins (technician_id) where check_out_at is null;

-- -----------------------------------------------------------------------------
-- Tour
-- -----------------------------------------------------------------------------
create table public.tour_code_counters (
  day date primary key,
  last_value integer not null
);

create table public.tours (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  customer_name text not null check (length(btrim(customer_name)) between 1 and 120),
  customer_phone text check (customer_phone is null or customer_phone ~ '^[0-9 +.-]{8,20}$'),
  note text check (note is null or length(note) <= 1000),
  is_requested boolean not null default false,
  requested_technician_id uuid references public.profiles (id),
  team_size smallint not null default 1 check (team_size between 1 and 2),
  status public.tour_status not null default 'waiting',
  assign_mode public.assign_mode not null default 'suggest',
  -- Dành cho sau: mã lịch hẹn Google Sheets / app quản lý giường
  external_ref text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_reason text,
  updated_at timestamptz not null default now(),
  check (not is_requested or requested_technician_id is not null)
);

create index tours_created_at_idx on public.tours (created_at desc);
create index tours_status_idx on public.tours (status) where status in ('waiting', 'offered', 'in_progress');
create index tours_completed_at_idx on public.tours (completed_at) where status = 'completed';

create trigger tours_updated_at before update on public.tours
  for each row execute function public.set_updated_at();

-- Dịch vụ trong tour – chụp lại tên/giá/thời lượng lúc tạo tour
create table public.tour_items (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references public.tours (id) on delete cascade,
  service_id uuid not null references public.services (id),
  service_name_snapshot text not null,
  fee_snapshot integer not null check (fee_snapshot >= 0),
  duration_snapshot integer not null check (duration_snapshot > 0),
  position smallint not null default 0
);

create index tour_items_tour_idx on public.tour_items (tour_id);

-- KTV thực hiện tour (1 hoặc 2 người) + tỷ lệ chia tiền + số tiền đã tính
create table public.tour_assignments (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references public.tours (id) on delete cascade,
  technician_id uuid not null references public.profiles (id),
  share_percent smallint not null check (share_percent between 1 and 100),
  status public.assignment_status not null default 'accepted',
  -- Tiền tour của KTV cho tour này (tính lại mỗi khi tour/tỷ lệ thay đổi);
  -- chỉ được cộng vào thu nhập khi tours.status = 'completed'
  earned_amount integer not null default 0,
  accepted_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- 1 KTV không thể nhận 2 tour cùng lúc
create unique index tour_assignments_one_active_per_tech
  on public.tour_assignments (technician_id) where status in ('accepted', 'working');
create unique index tour_assignments_unique_member
  on public.tour_assignments (tour_id, technician_id) where status <> 'removed';
create index tour_assignments_tech_idx on public.tour_assignments (technician_id, status);
create index tour_assignments_tour_idx on public.tour_assignments (tour_id);

create table public.tour_offers (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references public.tours (id) on delete cascade,
  technician_id uuid not null references public.profiles (id),
  status public.offer_status not null default 'pending',
  share_percent smallint not null default 100 check (share_percent between 1 and 100),
  decline_reason text,
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  round smallint not null default 1,
  offered_by uuid references public.profiles (id) on delete set null -- null = hệ thống tự gửi
);

-- Mỗi KTV tối đa 1 offer đang chờ
create unique index tour_offers_one_pending_per_tech
  on public.tour_offers (technician_id) where status = 'pending';
create index tour_offers_tour_idx on public.tour_offers (tour_id);
create index tour_offers_pending_exp_idx on public.tour_offers (expires_at) where status = 'pending';
create index tour_offers_tech_time_idx on public.tour_offers (technician_id, offered_at desc);

-- Nhật ký thao tác (tour_id null cho thao tác cấp tháng như chốt/mở sổ)
create table public.tour_audit_logs (
  id bigint generated always as identity primary key,
  tour_id uuid references public.tours (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (action in (
    'create', 'offer', 'accept', 'decline', 'expire', 'withdraw', 'complete', 'edit',
    'cancel', 'reassign', 'lock_month', 'unlock_month'
  )),
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index tour_audit_logs_tour_idx on public.tour_audit_logs (tour_id);
create index tour_audit_logs_created_idx on public.tour_audit_logs (created_at desc);

-- Cảnh báo cho bảng điều phối (KTV từ chối/hết giờ, không còn ai rảnh…)
create table public.admin_alerts (
  id bigint generated always as identity primary key,
  tour_id uuid references public.tours (id) on delete cascade,
  kind text not null,
  message text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null
);

create index admin_alerts_open_idx on public.admin_alerts (created_at desc) where resolved_at is null;

-- -----------------------------------------------------------------------------
-- Thông báo & push
-- -----------------------------------------------------------------------------
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 150),
  body text not null check (length(body) between 1 and 4000),
  target text not null check (target in ('all', 'individual')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.announcement_recipients (
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  technician_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz,
  primary key (announcement_id, technician_id)
);

create index announcement_recipients_tech_idx on public.announcement_recipients (technician_id, read_at);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- -----------------------------------------------------------------------------
-- Chốt lương & báo sai
-- -----------------------------------------------------------------------------
create table public.payroll_periods (
  month date primary key check (extract(day from month) = 1),
  status public.payroll_status not null default 'open',
  locked_at timestamptz,
  locked_by uuid references public.profiles (id) on delete set null
);

create table public.earning_disputes (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles (id) on delete cascade,
  tour_id uuid references public.tours (id) on delete set null,
  month date not null check (extract(day from month) = 1),
  message text not null check (length(btrim(message)) between 1 and 1000),
  status public.dispute_status not null default 'open',
  admin_reply text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null
);

create index earning_disputes_month_idx on public.earning_disputes (month, status);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.shift_schedules enable row level security;
alter table public.shift_checkins enable row level security;
alter table public.tour_code_counters enable row level security;
alter table public.tours enable row level security;
alter table public.tour_items enable row level security;
alter table public.tour_assignments enable row level security;
alter table public.tour_offers enable row level security;
alter table public.tour_audit_logs enable row level security;
alter table public.admin_alerts enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_recipients enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.payroll_periods enable row level security;
alter table public.earning_disputes enable row level security;

-- KTV có liên quan tới tour? (có offer hoặc assignment) – dùng cho RLS
create or replace function public.is_tour_member(p_tour_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.tour_offers o where o.tour_id = p_tour_id and o.technician_id = auth.uid())
      or exists (select 1 from public.tour_assignments a where a.tour_id = p_tour_id and a.technician_id = auth.uid())
$$;

-- Lịch ca: KTV xem của mình, staff xem & xếp lịch
create policy schedules_select on public.shift_schedules for select to authenticated
  using (technician_id = auth.uid() or public.is_staff());
create policy schedules_insert on public.shift_schedules for insert to authenticated
  with check (public.is_staff());
create policy schedules_update on public.shift_schedules for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy schedules_delete on public.shift_schedules for delete to authenticated
  using (public.is_staff());

create policy checkins_select on public.shift_checkins for select to authenticated
  using (technician_id = auth.uid() or public.is_staff());

-- tour_code_counters: không policy nào → chỉ function SECURITY DEFINER dùng

create policy tours_select on public.tours for select to authenticated
  using (public.is_staff() or public.is_tour_member(id));
create policy tour_items_select on public.tour_items for select to authenticated
  using (public.is_staff() or public.is_tour_member(tour_id));
create policy assignments_select on public.tour_assignments for select to authenticated
  using (technician_id = auth.uid() or public.is_staff());
create policy offers_select on public.tour_offers for select to authenticated
  using (technician_id = auth.uid() or public.is_staff());
create policy audit_select on public.tour_audit_logs for select to authenticated
  using (public.is_staff());
create policy alerts_select on public.admin_alerts for select to authenticated
  using (public.is_staff());

create policy announcements_select on public.announcements for select to authenticated
  using (
    public.is_staff()
    or exists (select 1 from public.announcement_recipients r
               where r.announcement_id = announcements.id and r.technician_id = auth.uid())
  );
create policy recipients_select on public.announcement_recipients for select to authenticated
  using (technician_id = auth.uid() or public.is_staff());

-- push_subscriptions: mỗi người tự quản lý thiết bị của mình
create policy push_select on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());
create policy push_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = auth.uid() and public.auth_role() is not null);
create policy push_update on public.push_subscriptions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_delete on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid());

create policy payroll_select on public.payroll_periods for select to authenticated
  using (public.auth_role() is not null);

create policy disputes_select on public.earning_disputes for select to authenticated
  using (technician_id = auth.uid() or public.is_staff());

-- -----------------------------------------------------------------------------
-- Realtime: các bảng cần đẩy thay đổi về client
-- -----------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.tours, public.tour_offers, public.tour_assignments, public.shift_checkins,
  public.admin_alerts, public.announcement_recipients, public.earning_disputes;
