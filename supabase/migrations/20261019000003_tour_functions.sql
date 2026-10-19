-- =============================================================================
-- Function nghiệp vụ. Mọi thao tác ghi quan trọng là function SECURITY DEFINER
-- chạy trong 1 transaction, khoá dòng (FOR UPDATE) để không có chuyện 1 KTV
-- nhận 2 tour hay 1 tour bị gán thừa người.
-- Thông báo lỗi bằng tiếng Việt để hiển thị thẳng cho người dùng.
-- =============================================================================

-- KTV được khách chỉ định nhưng đang bận: nhớ tỷ lệ chia để gửi offer khi rảnh
alter table public.tours
  add column requested_share_percent smallint not null default 100
  check (requested_share_percent between 1 and 100);

-- -----------------------------------------------------------------------------
-- Helper chung
-- -----------------------------------------------------------------------------
create or replace function public._require_staff()
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'Bạn không có quyền thực hiện thao tác này' using errcode = '42501';
  end if;
end $$;

create or replace function public._require_owner()
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Chỉ chủ spa mới được thực hiện thao tác này' using errcode = '42501';
  end if;
end $$;

create or replace function public._require_technician()
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if coalesce(public.auth_role() <> 'technician', true) then
    raise exception 'Chỉ tài khoản Kỹ thuật viên mới thực hiện được thao tác này' using errcode = '42501';
  end if;
end $$;

create or replace function public._require_reason(p_reason text)
returns text
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'Vui lòng nhập lý do (ít nhất 3 ký tự)';
  end if;
  return btrim(p_reason);
end $$;

create or replace function public._log(
  p_tour_id uuid, p_action text, p_before jsonb, p_after jsonb, p_reason text
)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.tour_audit_logs (tour_id, actor_id, action, before, after, reason)
  values (p_tour_id, auth.uid(), p_action, p_before, p_after, p_reason)
$$;

create or replace function public._is_month_locked(p_month date)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.payroll_periods pp where pp.month = p_month and pp.status = 'locked'
  )
$$;

create or replace function public._assert_month_open(p_ts timestamptz)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if p_ts is not null and public._is_month_locked(public.vn_month(p_ts)) then
    raise exception 'Tháng %/% đã chốt sổ, không thể thay đổi. Liên hệ chủ spa để mở sổ.',
      to_char(public.vn_month(p_ts), 'MM'), to_char(public.vn_month(p_ts), 'YYYY');
  end if;
end $$;

-- Mã tour dễ đọc, đánh số lại mỗi ngày theo giờ VN: T-20261020-015
create or replace function public._next_tour_code()
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_day date := public.vn_today();
  v_n integer;
begin
  insert into public.tour_code_counters (day, last_value) values (v_day, 1)
  on conflict (day) do update set last_value = public.tour_code_counters.last_value + 1
  returning last_value into v_n;
  return 'T-' || to_char(v_day, 'YYYYMMDD') || '-' || lpad(v_n::text, 3, '0');
end $$;

-- -----------------------------------------------------------------------------
-- Tiền tour
-- -----------------------------------------------------------------------------
-- Chia tổng tiền theo tỷ lệ %. Làm tròn xuống từng phần; phần dư (vài đồng)
-- dồn cho người có tỷ lệ lớn nhất (người đứng trước nếu bằng nhau) để tổng
-- luôn khớp. Giống hệt splitFee() trong src/lib/earnings.
create or replace function public.split_fee(p_total integer, p_shares integer[])
returns integer[]
language plpgsql immutable
set search_path = ''
as $$
declare
  v_result integer[] := '{}';
  v_sum bigint := 0;
  v_share_sum integer := 0;
  v_big integer := 1;
  i integer;
begin
  if p_shares is null or coalesce(array_length(p_shares, 1), 0) = 0 then
    return v_result;
  end if;
  for i in 1 .. array_length(p_shares, 1) loop
    v_result := v_result || ((p_total::bigint * p_shares[i]) / 100)::integer;
    v_sum := v_sum + v_result[i];
    v_share_sum := v_share_sum + p_shares[i];
    if p_shares[i] > p_shares[v_big] then
      v_big := i;
    end if;
  end loop;
  if v_share_sum = 100 then
    v_result[v_big] := v_result[v_big] + (p_total - v_sum)::integer;
  end if;
  return v_result;
end $$;

-- Tính lại tiền từng KTV của 1 tour (gọi sau khi hoàn thành / sửa / đổi người)
create or replace function public._recompute_tour_earnings(p_tour_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_ids uuid[];
  v_shares integer[];
  v_amounts integer[];
  i integer;
begin
  select coalesce(sum(fee_snapshot), 0) into v_total
  from public.tour_items where tour_id = p_tour_id;

  select array_agg(id order by share_percent desc, accepted_at, id),
         array_agg(share_percent::integer order by share_percent desc, accepted_at, id)
    into v_ids, v_shares
  from public.tour_assignments
  where tour_id = p_tour_id and status <> 'removed';

  update public.tour_assignments set earned_amount = 0
  where tour_id = p_tour_id and status = 'removed' and earned_amount <> 0;

  if v_ids is null then
    return;
  end if;

  v_amounts := public.split_fee(v_total, v_shares);
  for i in 1 .. array_length(v_ids, 1) loop
    update public.tour_assignments set earned_amount = v_amounts[i] where id = v_ids[i];
  end loop;
end $$;

-- Ảnh chụp đầy đủ 1 tour (dùng cho nhật ký trước/sau và màn chi tiết)
create or replace function public._tour_json(p_tour_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id, 'code', t.code, 'status', t.status, 'assign_mode', t.assign_mode,
    'customer_name', t.customer_name, 'customer_phone', t.customer_phone, 'note', t.note,
    'is_requested', t.is_requested, 'requested_technician_id', t.requested_technician_id,
    'team_size', t.team_size, 'started_at', t.started_at, 'completed_at', t.completed_at,
    'cancelled_reason', t.cancelled_reason,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'service_id', i.service_id, 'name', i.service_name_snapshot,
        'fee', i.fee_snapshot, 'duration', i.duration_snapshot) order by i.position)
      from public.tour_items i where i.tour_id = t.id), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'technician_id', a.technician_id, 'name', p.full_name,
        'share_percent', a.share_percent, 'status', a.status, 'amount', a.earned_amount)
        order by a.share_percent desc)
      from public.tour_assignments a join public.profiles p on p.id = a.technician_id
      where a.tour_id = t.id and a.status <> 'removed'), '[]'::jsonb)
  )
  from public.tours t where t.id = p_tour_id
$$;

-- -----------------------------------------------------------------------------
-- Trạng thái KTV
-- -----------------------------------------------------------------------------
-- null = KTV rảnh (đã vào ca, không có offer chờ, không có tour đang làm);
-- ngược lại trả lý do bằng tiếng Việt.
create or replace function public._tech_busy_reason(p_tech uuid)
returns text
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_tech and p.role = 'technician' and p.is_active
  ) then
    return 'Tài khoản đã khoá hoặc không phải KTV';
  end if;
  if not exists (
    select 1 from public.shift_checkins c
    where c.technician_id = p_tech and c.work_date = public.vn_today() and c.check_out_at is null
  ) then
    return 'Chưa vào ca';
  end if;
  if exists (select 1 from public.tour_offers o where o.technician_id = p_tech and o.status = 'pending') then
    return 'Đang có lời mời khác';
  end if;
  if exists (
    select 1 from public.tour_assignments a
    where a.technician_id = p_tech and a.status in ('accepted', 'working')
  ) then
    return 'Đang làm tour khác';
  end if;
  return null;
end $$;

-- Phần % chia tiền còn trống của tour (trừ người đã nhận và offer đang chờ)
create or replace function public._open_share(p_tour_id uuid)
returns integer
language sql stable security definer
set search_path = ''
as $$
  select 100
    - coalesce((select sum(share_percent) from public.tour_assignments
                where tour_id = p_tour_id and status <> 'removed'), 0)::integer
    - coalesce((select sum(share_percent) from public.tour_offers
                where tour_id = p_tour_id and status = 'pending'), 0)::integer
$$;

-- Tên các dịch vụ cần kỹ năng riêng mà KTV chưa được gán
create or replace function public._missing_skills(p_tour_id uuid, p_tech uuid)
returns text[]
language sql stable security definer
set search_path = ''
as $$
  select array_agg(distinct s.name)
  from public.tour_items ti
  join public.services s on s.id = ti.service_id
  where ti.tour_id = p_tour_id
    and s.requires_skill
    and not exists (
      select 1 from public.technician_skills k
      where k.technician_id = p_tech and k.service_id = s.id
    )
$$;

-- -----------------------------------------------------------------------------
-- Gửi offer
-- -----------------------------------------------------------------------------
create or replace function public._create_offer(
  p_tour_id uuid, p_tech uuid, p_share integer, p_by uuid
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_round integer;
  v_timeout integer;
begin
  select offer_timeout_seconds into v_timeout from public.app_settings where id;
  select count(*) + 1 into v_round from public.tour_offers where tour_id = p_tour_id;

  insert into public.tour_offers (tour_id, technician_id, share_percent, expires_at, round, offered_by)
  values (p_tour_id, p_tech, p_share, now() + make_interval(secs => v_timeout), v_round, p_by)
  returning id into v_id;

  update public.tours set status = 'offered' where id = p_tour_id and status = 'waiting';

  perform public._log(p_tour_id, 'offer', null,
    jsonb_build_object('offer_id', v_id, 'technician_id', p_tech, 'share_percent', p_share, 'round', v_round),
    null);
  return v_id;
end $$;

-- Gửi offer cho 1 KTV với đầy đủ kiểm tra.
-- p_allow_queue: tour chỉ định mà KTV đang bận/chưa vào ca → không lỗi, tour chờ
-- và sẽ tự gửi khi KTV đó rảnh (xem _dispatch_requested_for).
create or replace function public._offer_internal(
  p_tour_id uuid, p_tech uuid, p_share integer, p_by uuid, p_allow_queue boolean
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tour public.tours;
  v_open integer;
  v_share integer;
  v_missing text[];
  v_busy text;
  v_offer uuid;
begin
  select * into v_tour from public.tours where id = p_tour_id for update;
  if not found then
    raise exception 'Không tìm thấy tour';
  end if;
  if v_tour.status not in ('waiting', 'offered') then
    raise exception 'Tour % không còn ở trạng thái chờ phân', v_tour.code;
  end if;

  if exists (select 1 from public.tour_assignments
             where tour_id = p_tour_id and technician_id = p_tech and status <> 'removed')
     or exists (select 1 from public.tour_offers
                where tour_id = p_tour_id and technician_id = p_tech and status = 'pending') then
    raise exception 'KTV này đã được mời hoặc đã nhận tour này';
  end if;

  v_open := public._open_share(p_tour_id);
  if v_open <= 0 then
    raise exception 'Tour % đã đủ người', v_tour.code;
  end if;
  v_share := case when v_tour.team_size = 1 then 100 else coalesce(p_share, v_open) end;
  if v_share > v_open or v_share < 1 then
    raise exception '%', format('Tỷ lệ chia không hợp lệ (phần còn lại: %s%%)', v_open);
  end if;

  -- Kỹ năng: bắt buộc với tour thường; tour chỉ định chỉ cảnh báo ở giao diện
  if not (v_tour.is_requested and p_tech = v_tour.requested_technician_id) then
    v_missing := public._missing_skills(p_tour_id, p_tech);
    if v_missing is not null then
      raise exception 'KTV chưa có kỹ năng: %', array_to_string(v_missing, ', ');
    end if;
  end if;

  v_busy := public._tech_busy_reason(p_tech);
  if v_busy is not null then
    if p_allow_queue and v_tour.is_requested and p_tech = v_tour.requested_technician_id
       and v_busy <> 'Tài khoản đã khoá hoặc không phải KTV' then
      update public.tours set requested_share_percent = v_share where id = p_tour_id;
      return jsonb_build_object('queued', true, 'technician_id', p_tech, 'reason', v_busy);
    end if;
    raise exception 'Không thể gửi cho KTV này: %', v_busy;
  end if;

  v_offer := public._create_offer(p_tour_id, p_tech, v_share, p_by);
  return jsonb_build_object('queued', false, 'technician_id', p_tech, 'offer_id', v_offer);
end $$;

-- Gửi Edge Function "dispatch" để tự chuyển tour cho người kế tiếp (chế độ
-- Tự động / Random). Gọi bằng pg_net nên chạy bất đồng bộ sau khi commit,
-- không phụ thuộc điện thoại KTV.
create or replace function public._kick_dispatch(p_tour_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from private.config where key = 'functions_url';
  select value into v_secret from private.config where key = 'internal_secret';
  if v_url is null or v_secret is null then
    if p_tour_id is not null then
      insert into public.admin_alerts (tour_id, kind, message)
      select p_tour_id, 'dispatch_unavailable',
             'Chưa cấu hình tự động chuyển tour – vui lòng phân tour ' || t.code || ' thủ công'
      from public.tours t where t.id = p_tour_id;
    end if;
    return;
  end if;
  perform net.http_post(
    url := v_url || '/dispatch',
    body := jsonb_build_object('tour_id', p_tour_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
    timeout_milliseconds := 10000
  );
end $$;

-- Có tour Tự động/Random đang chờ người → gọi dispatch (khi có KTV vừa rảnh)
create or replace function public._kick_dispatch_if_waiting()
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.tours t
    where t.status = 'waiting' and t.assign_mode in ('auto', 'random') and t.team_size = 1
  ) then
    perform public._kick_dispatch(null);
  end if;
end $$;

-- KTV vừa rảnh: nếu có tour khách chỉ định đang chờ mình → tự gửi offer
create or replace function public._dispatch_requested_for(p_tech uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tour public.tours;
  v_share integer;
begin
  if public._tech_busy_reason(p_tech) is not null then
    return;
  end if;
  select t.* into v_tour
  from public.tours t
  where t.status in ('waiting', 'offered')
    and t.is_requested
    and t.requested_technician_id = p_tech
    -- đã từ chối/hết giờ thì để admin quyết, không tự gửi lại
    and not exists (select 1 from public.tour_offers o
                    where o.tour_id = t.id and o.technician_id = p_tech
                      and o.status in ('pending', 'declined', 'expired', 'accepted'))
    and not exists (select 1 from public.tour_assignments a
                    where a.tour_id = t.id and a.technician_id = p_tech and a.status <> 'removed')
  order by t.created_at
  limit 1
  for update of t skip locked;
  if not found then
    return;
  end if;
  v_share := least(
    case when v_tour.team_size = 1 then 100 else v_tour.requested_share_percent end,
    public._open_share(v_tour.id));
  if v_share >= 1 then
    perform public._create_offer(v_tour.id, p_tech, v_share, null);
  end if;
end $$;

-- Sau khi offer bị từ chối / hết giờ
create or replace function public._after_offer_failed(p_offer_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_offer public.tour_offers;
  v_tour public.tours;
  v_name text;
  v_verb text;
begin
  select * into v_offer from public.tour_offers where id = p_offer_id;
  select * into v_tour from public.tours where id = v_offer.tour_id for update;

  if v_tour.status in ('waiting', 'offered') then
    if not exists (select 1 from public.tour_offers where tour_id = v_tour.id and status = 'pending')
       and not exists (select 1 from public.tour_assignments
                       where tour_id = v_tour.id and status in ('accepted', 'working')) then
      update public.tours set status = 'waiting' where id = v_tour.id;
    end if;

    if v_tour.assign_mode in ('auto', 'random') and v_tour.team_size = 1 and not v_tour.is_requested then
      -- Tự động / Random: tự chuyển người kế tiếp
      perform public._kick_dispatch(v_tour.id);
    else
      -- Gợi ý / Chỉ định / tour 2 KTV: báo admin chọn lại
      select full_name into v_name from public.profiles where id = v_offer.technician_id;
      v_verb := case v_offer.status when 'declined' then 'từ chối' else 'không phản hồi kịp' end;
      insert into public.admin_alerts (tour_id, kind, message)
      values (
        v_tour.id,
        case when v_tour.is_requested then 'requested_failed' else 'offer_failed' end,
        format('%s đã %s tour %s (%s)%s',
          v_name, v_verb, v_tour.code, v_tour.customer_name,
          case when v_offer.decline_reason is not null then ' – ' || v_offer.decline_reason else '' end)
      );
    end if;
  end if;

  -- KTV vừa rảnh có thể có tour chỉ định khác đang chờ
  perform public._dispatch_requested_for(v_offer.technician_id);
end $$;

-- -----------------------------------------------------------------------------
-- RPC: tạo tour
-- p = {
--   customer_name, customer_phone?, note?, service_ids: uuid[],
--   assign_mode: suggest|auto|random|requested, team_size: 1|2,
--   requested_technician_id?, offers?: [{technician_id, share_percent}]
-- }
-- -----------------------------------------------------------------------------
create or replace function public.create_tour(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p ->> 'customer_name', ''));
  v_phone text := nullif(btrim(coalesce(p ->> 'customer_phone', '')), '');
  v_note text := nullif(btrim(coalesce(p ->> 'note', '')), '');
  v_mode public.assign_mode := coalesce(nullif(p ->> 'assign_mode', ''), 'suggest')::public.assign_mode;
  v_team integer := coalesce((p ->> 'team_size')::integer, 1);
  v_req_tech uuid := nullif(p ->> 'requested_technician_id', '')::uuid;
  v_service_ids uuid[];
  v_offers jsonb := coalesce(p -> 'offers', '[]'::jsonb);
  v_share_sum integer;
  v_tour public.tours;
  v_offer jsonb;
  v_results jsonb := '[]'::jsonb;
  v_requested_in_offers boolean := false;
begin
  perform public._require_staff();

  if length(v_name) = 0 then
    raise exception 'Vui lòng nhập tên khách';
  end if;
  if v_team not in (1, 2) then
    raise exception 'Số KTV chỉ được là 1 hoặc 2';
  end if;
  if v_mode in ('auto', 'random') and v_team = 2 then
    raise exception 'Tour 2 KTV chỉ dùng chế độ Gợi ý hoặc Khách chỉ định';
  end if;
  if v_mode = 'requested' and v_req_tech is null then
    raise exception 'Vui lòng chọn KTV khách chỉ định';
  end if;
  if v_mode <> 'requested' then
    v_req_tech := null;
  end if;

  select array_agg(x::uuid) into v_service_ids
  from jsonb_array_elements_text(coalesce(p -> 'service_ids', '[]'::jsonb)) x;
  if v_service_ids is null then
    raise exception 'Vui lòng chọn ít nhất 1 dịch vụ';
  end if;
  if array_length(v_service_ids, 1) > 10 then
    raise exception 'Tối đa 10 dịch vụ cho 1 tour';
  end if;
  if exists (select 1 from unnest(v_service_ids) sid
             where not exists (select 1 from public.services s where s.id = sid and s.is_active)) then
    raise exception 'Có dịch vụ không tồn tại hoặc đã ẩn';
  end if;

  if jsonb_array_length(v_offers) > v_team then
    raise exception 'Số KTV được mời vượt quá số KTV của tour';
  end if;
  if v_team = 2 and jsonb_array_length(v_offers) = 2 then
    select sum((o ->> 'share_percent')::integer) into v_share_sum from jsonb_array_elements(v_offers) o;
    if v_share_sum <> 100 then
      raise exception 'Tổng tỷ lệ chia của 2 KTV phải bằng 100%%';
    end if;
  end if;

  insert into public.tours (
    code, customer_name, customer_phone, note, is_requested, requested_technician_id,
    team_size, assign_mode, created_by
  ) values (
    public._next_tour_code(), v_name, v_phone, v_note, v_mode = 'requested', v_req_tech,
    v_team, v_mode, auth.uid()
  ) returning * into v_tour;

  insert into public.tour_items (tour_id, service_id, service_name_snapshot, fee_snapshot, duration_snapshot, position)
  select v_tour.id, s.id, s.name, s.tour_fee, s.duration_minutes, x.ord
  from unnest(v_service_ids) with ordinality as x(sid, ord)
  join public.services s on s.id = x.sid;

  perform public._log(v_tour.id, 'create', null, public._tour_json(v_tour.id), null);

  for v_offer in select * from jsonb_array_elements(v_offers) loop
    if (v_offer ->> 'technician_id')::uuid = v_req_tech then
      v_requested_in_offers := true;
    end if;
    v_results := v_results || public._offer_internal(
      v_tour.id,
      (v_offer ->> 'technician_id')::uuid,
      coalesce((v_offer ->> 'share_percent')::integer, 100),
      auth.uid(),
      true
    );
  end loop;

  -- Khách chỉ định mà form không gửi kèm offer → tự gửi cho KTV được chỉ định
  if v_mode = 'requested' and not v_requested_in_offers then
    v_results := v_results || public._offer_internal(
      v_tour.id, v_req_tech, case when v_team = 1 then 100 else 50 end, auth.uid(), true);
  end if;

  return jsonb_build_object('id', v_tour.id, 'code', v_tour.code, 'offers', v_results);
end $$;

-- Admin gửi offer thủ công (chế độ Gợi ý, chọn lại sau khi bị từ chối…)
create or replace function public.send_offer(p_tour_id uuid, p_technician_id uuid, p_share_percent integer default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform public._require_staff();
  v_result := public._offer_internal(p_tour_id, p_technician_id, p_share_percent, auth.uid(), true);
  update public.admin_alerts set resolved_at = now(), resolved_by = auth.uid()
  where tour_id = p_tour_id and resolved_at is null;
  return v_result;
end $$;

create or replace function public.withdraw_offer(p_offer_id uuid, p_reason text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_offer public.tour_offers;
begin
  perform public._require_staff();
  select * into v_offer from public.tour_offers where id = p_offer_id for update;
  if not found or v_offer.status <> 'pending' then
    raise exception 'Lời mời không còn ở trạng thái chờ';
  end if;
  perform 1 from public.tours where id = v_offer.tour_id for update;
  update public.tour_offers set status = 'withdrawn', responded_at = now() where id = p_offer_id;
  update public.tours t set status = 'waiting'
  where t.id = v_offer.tour_id and t.status = 'offered'
    and not exists (select 1 from public.tour_offers o where o.tour_id = t.id and o.status = 'pending')
    and not exists (select 1 from public.tour_assignments a
                    where a.tour_id = t.id and a.status in ('accepted', 'working'));
  perform public._log(v_offer.tour_id, 'withdraw', null,
    jsonb_build_object('offer_id', p_offer_id, 'technician_id', v_offer.technician_id),
    nullif(btrim(coalesce(p_reason, '')), ''));
  perform public._dispatch_requested_for(v_offer.technician_id);
end $$;

-- -----------------------------------------------------------------------------
-- RPC: KTV nhận / từ chối / hết giờ
-- -----------------------------------------------------------------------------
create or replace function public.accept_offer(p_offer_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_offer public.tour_offers;
  v_tour public.tours;
  v_members integer;
  v_started boolean := false;
begin
  perform public._require_technician();

  -- Khoá offer trước để 2 lần bấm liên tiếp không tạo 2 assignment
  select * into v_offer from public.tour_offers where id = p_offer_id for update;
  if not found or v_offer.technician_id <> v_uid then
    raise exception 'Không tìm thấy lời mời';
  end if;
  if v_offer.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'Lời mời không còn hiệu lực');
  end if;

  if v_offer.expires_at <= now() then
    update public.tour_offers set status = 'expired', responded_at = now() where id = p_offer_id;
    perform public._log(v_offer.tour_id, 'expire', null,
      jsonb_build_object('offer_id', p_offer_id, 'technician_id', v_uid), null);
    perform public._after_offer_failed(p_offer_id);
    return jsonb_build_object('ok', false, 'error', 'Lời mời đã hết hạn');
  end if;

  select * into v_tour from public.tours where id = v_offer.tour_id for update;
  if v_tour.status not in ('waiting', 'offered') then
    update public.tour_offers set status = 'withdrawn', responded_at = now() where id = p_offer_id;
    return jsonb_build_object('ok', false, 'error', 'Tour không còn khả dụng');
  end if;

  if exists (select 1 from public.tour_assignments
             where technician_id = v_uid and status in ('accepted', 'working')) then
    raise exception 'Bạn đang làm tour khác, hãy hoàn thành trước khi nhận tour mới';
  end if;

  select count(*) into v_members from public.tour_assignments
  where tour_id = v_tour.id and status <> 'removed';
  if v_members >= v_tour.team_size then
    update public.tour_offers set status = 'withdrawn', responded_at = now() where id = p_offer_id;
    return jsonb_build_object('ok', false, 'error', 'Tour đã đủ người');
  end if;

  update public.tour_offers set status = 'accepted', responded_at = now() where id = p_offer_id;
  insert into public.tour_assignments (tour_id, technician_id, share_percent, status)
  values (v_tour.id, v_uid, v_offer.share_percent, 'accepted');
  perform public._log(v_tour.id, 'accept', null,
    jsonb_build_object('offer_id', p_offer_id, 'technician_id', v_uid), null);

  -- Đủ người → bắt đầu tour
  if (select count(*) from public.tour_assignments
      where tour_id = v_tour.id and status = 'accepted') >= v_tour.team_size then
    update public.tour_assignments set status = 'working'
    where tour_id = v_tour.id and status = 'accepted';
    update public.tours set status = 'in_progress', started_at = now() where id = v_tour.id;
    update public.tour_offers set status = 'withdrawn', responded_at = now()
    where tour_id = v_tour.id and status = 'pending';
    update public.admin_alerts set resolved_at = now()
    where tour_id = v_tour.id and resolved_at is null;
    perform public._recompute_tour_earnings(v_tour.id);
    v_started := true;
  end if;

  return jsonb_build_object('ok', true, 'tour_id', v_tour.id, 'started', v_started);
end $$;

create or replace function public.decline_offer(p_offer_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_offer public.tour_offers;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public._require_technician();
  if v_reason is null then
    raise exception 'Vui lòng chọn lý do từ chối';
  end if;
  if length(v_reason) > 300 then
    raise exception 'Lý do quá dài (tối đa 300 ký tự)';
  end if;
  select * into v_offer from public.tour_offers where id = p_offer_id for update;
  if not found or v_offer.technician_id <> auth.uid() then
    raise exception 'Không tìm thấy lời mời';
  end if;
  if v_offer.status <> 'pending' then
    raise exception 'Lời mời không còn hiệu lực';
  end if;
  update public.tour_offers
  set status = 'declined', decline_reason = v_reason, responded_at = now()
  where id = p_offer_id;
  perform public._log(v_offer.tour_id, 'decline', null,
    jsonb_build_object('offer_id', p_offer_id, 'technician_id', v_offer.technician_id), v_reason);
  perform public._after_offer_failed(p_offer_id);
end $$;

-- Client gọi khi đồng hồ đếm về 0 để xử lý ngay (không phải đợi pg_cron)
create or replace function public.expire_offer(p_offer_id uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_offer public.tour_offers;
begin
  select * into v_offer from public.tour_offers where id = p_offer_id for update;
  if not found or not (v_offer.technician_id = auth.uid() or public.is_staff()) then
    return false;
  end if;
  -- cho phép lệch đồng hồ điện thoại tối đa 2 giây
  if v_offer.status <> 'pending' or v_offer.expires_at > now() + interval '2 seconds' then
    return false;
  end if;
  update public.tour_offers set status = 'expired', responded_at = now() where id = p_offer_id;
  perform public._log(v_offer.tour_id, 'expire', null,
    jsonb_build_object('offer_id', p_offer_id, 'technician_id', v_offer.technician_id), null);
  perform public._after_offer_failed(p_offer_id);
  return true;
end $$;

-- pg_cron gọi mỗi 20 giây: xử lý mọi offer quá hạn ở phía server
create or replace function public.expire_offers()
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_offer record;
  v_count integer := 0;
begin
  for v_offer in
    select id, tour_id, technician_id from public.tour_offers
    where status = 'pending' and expires_at <= now()
    order by expires_at
    for update skip locked
  loop
    update public.tour_offers set status = 'expired', responded_at = now() where id = v_offer.id;
    perform public._log(v_offer.tour_id, 'expire', null,
      jsonb_build_object('offer_id', v_offer.id, 'technician_id', v_offer.technician_id), null);
    perform public._after_offer_failed(v_offer.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- -----------------------------------------------------------------------------
-- RPC: hoàn thành / huỷ / sửa / đổi KTV
-- -----------------------------------------------------------------------------
create or replace function public.complete_tour(p_tour_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role public.user_role := public.auth_role();
  v_tour public.tours;
  v_freed uuid[];
  v_tech uuid;
  v_done boolean := false;
begin
  if v_role is null then
    raise exception 'Bạn không có quyền thực hiện thao tác này' using errcode = '42501';
  end if;
  select * into v_tour from public.tours where id = p_tour_id for update;
  if not found then
    raise exception 'Không tìm thấy tour';
  end if;
  if v_tour.status <> 'in_progress' then
    raise exception 'Tour % không ở trạng thái đang làm', v_tour.code;
  end if;
  perform public._assert_month_open(now());

  if v_role = 'technician' then
    update public.tour_assignments set status = 'done', completed_at = now()
    where tour_id = p_tour_id and technician_id = auth.uid() and status = 'working';
    if not found then
      raise exception 'Bạn không thực hiện tour này';
    end if;
    v_freed := array[auth.uid()];
  else
    -- Admin hoàn thành thay
    select array_agg(technician_id) into v_freed from public.tour_assignments
    where tour_id = p_tour_id and status = 'working';
    update public.tour_assignments set status = 'done', completed_at = now()
    where tour_id = p_tour_id and status = 'working';
  end if;

  if not exists (select 1 from public.tour_assignments where tour_id = p_tour_id and status = 'working') then
    update public.tours set status = 'completed', completed_at = now() where id = p_tour_id;
    perform public._recompute_tour_earnings(p_tour_id);
    v_done := true;
  end if;

  perform public._log(p_tour_id, 'complete', null,
    jsonb_build_object('by_admin', v_role <> 'technician', 'tour_completed', v_done,
                       'technicians', to_jsonb(v_freed)),
    null);

  foreach v_tech in array coalesce(v_freed, '{}') loop
    perform public._dispatch_requested_for(v_tech);
  end loop;
  perform public._kick_dispatch_if_waiting();

  return jsonb_build_object('tour_completed', v_done);
end $$;

create or replace function public.cancel_tour(p_tour_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_reason text := public._require_reason(p_reason);
  v_tour public.tours;
  v_before jsonb;
  v_freed uuid[];
  v_tech uuid;
begin
  perform public._require_staff();
  select * into v_tour from public.tours where id = p_tour_id for update;
  if not found then
    raise exception 'Không tìm thấy tour';
  end if;
  if v_tour.status = 'cancelled' then
    raise exception 'Tour đã bị huỷ trước đó';
  end if;
  if v_tour.status = 'completed' then
    perform public._assert_month_open(v_tour.completed_at);
  end if;

  v_before := public._tour_json(p_tour_id);
  select array_agg(technician_id) into v_freed from public.tour_assignments
  where tour_id = p_tour_id and status in ('accepted', 'working');

  update public.tour_offers set status = 'withdrawn', responded_at = now()
  where tour_id = p_tour_id and status = 'pending';
  update public.tour_assignments set status = 'removed', earned_amount = 0
  where tour_id = p_tour_id and status <> 'removed';
  update public.tours
  set status = 'cancelled', cancelled_at = now(), cancelled_reason = v_reason
  where id = p_tour_id;
  update public.admin_alerts set resolved_at = now(), resolved_by = auth.uid()
  where tour_id = p_tour_id and resolved_at is null;

  perform public._log(p_tour_id, 'cancel', v_before, public._tour_json(p_tour_id), v_reason);

  foreach v_tech in array coalesce(v_freed, '{}') loop
    perform public._dispatch_requested_for(v_tech);
  end loop;
  perform public._kick_dispatch_if_waiting();
end $$;

-- p = { customer_name?, customer_phone?, note?, service_ids?: uuid[],
--       shares?: [{technician_id, share_percent}] }
create or replace function public.edit_tour(p_tour_id uuid, p jsonb, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_reason text := public._require_reason(p_reason);
  v_tour public.tours;
  v_before jsonb;
  v_sid uuid;
  v_pos integer := 0;
  v_item uuid;
  v_kept uuid[] := '{}';
  v_share jsonb;
  v_sum integer;
  v_count integer;
begin
  perform public._require_staff();
  select * into v_tour from public.tours where id = p_tour_id for update;
  if not found then
    raise exception 'Không tìm thấy tour';
  end if;
  if v_tour.status = 'cancelled' then
    raise exception 'Không sửa được tour đã huỷ';
  end if;
  if v_tour.status = 'completed' then
    perform public._assert_month_open(v_tour.completed_at);
  end if;
  v_before := public._tour_json(p_tour_id);

  if p ? 'customer_name' then
    if length(btrim(coalesce(p ->> 'customer_name', ''))) = 0 then
      raise exception 'Vui lòng nhập tên khách';
    end if;
    update public.tours set customer_name = btrim(p ->> 'customer_name') where id = p_tour_id;
  end if;
  if p ? 'customer_phone' then
    update public.tours set customer_phone = nullif(btrim(coalesce(p ->> 'customer_phone', '')), '')
    where id = p_tour_id;
  end if;
  if p ? 'note' then
    update public.tours set note = nullif(btrim(coalesce(p ->> 'note', '')), '') where id = p_tour_id;
  end if;

  -- Dịch vụ: dịch vụ đã có giữ nguyên giá đã chụp; dịch vụ mới lấy giá hiện tại
  if p ? 'service_ids' then
    if jsonb_array_length(coalesce(p -> 'service_ids', '[]'::jsonb)) = 0 then
      raise exception 'Tour phải có ít nhất 1 dịch vụ';
    end if;
    for v_sid in select x::uuid from jsonb_array_elements_text(p -> 'service_ids') x loop
      v_pos := v_pos + 1;
      select id into v_item from public.tour_items
      where tour_id = p_tour_id and service_id = v_sid and not (id = any (v_kept))
      order by position limit 1;
      if found then
        update public.tour_items set position = v_pos where id = v_item;
      else
        insert into public.tour_items (tour_id, service_id, service_name_snapshot, fee_snapshot, duration_snapshot, position)
        select p_tour_id, s.id, s.name, s.tour_fee, s.duration_minutes, v_pos
        from public.services s where s.id = v_sid and s.is_active
        returning id into v_item;
        if v_item is null then
          raise exception 'Có dịch vụ không tồn tại hoặc đã ẩn';
        end if;
      end if;
      v_kept := v_kept || v_item;
      v_item := null;
    end loop;
    delete from public.tour_items where tour_id = p_tour_id and not (id = any (v_kept));
  end if;

  -- Tỷ lệ chia: phải liệt kê đủ mọi KTV của tour, tổng = 100
  if p ? 'shares' then
    select coalesce(sum((s ->> 'share_percent')::integer), 0), count(*)
      into v_sum, v_count
    from jsonb_array_elements(p -> 'shares') s;
    if v_sum <> 100 then
      raise exception 'Tổng tỷ lệ chia phải bằng 100%%';
    end if;
    if v_count <> (select count(*) from public.tour_assignments
                   where tour_id = p_tour_id and status <> 'removed') then
      raise exception 'Cần nhập tỷ lệ cho đủ các KTV của tour';
    end if;
    for v_share in select * from jsonb_array_elements(p -> 'shares') loop
      if (v_share ->> 'share_percent')::integer < 1 then
        raise exception 'Tỷ lệ mỗi KTV phải từ 1%% trở lên';
      end if;
      update public.tour_assignments set share_percent = (v_share ->> 'share_percent')::integer
      where tour_id = p_tour_id and technician_id = (v_share ->> 'technician_id')::uuid
        and status <> 'removed';
      if not found then
        raise exception 'KTV không thuộc tour này';
      end if;
    end loop;
  end if;

  perform public._recompute_tour_earnings(p_tour_id);
  perform public._log(p_tour_id, 'edit', v_before, public._tour_json(p_tour_id), v_reason);
end $$;

-- Đổi KTV của một assignment (tour đang làm, hoặc sửa sai sau khi đã xong)
create or replace function public.reassign_technician(p_assignment_id uuid, p_new_technician_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_reason text := public._require_reason(p_reason);
  v_old public.tour_assignments;
  v_tour public.tours;
  v_before jsonb;
  v_busy text;
begin
  perform public._require_staff();
  select * into v_old from public.tour_assignments where id = p_assignment_id for update;
  if not found or v_old.status = 'removed' then
    raise exception 'Không tìm thấy KTV của tour';
  end if;
  select * into v_tour from public.tours where id = v_old.tour_id for update;
  if v_tour.status = 'cancelled' then
    raise exception 'Tour đã huỷ';
  end if;
  if v_tour.status = 'completed' then
    perform public._assert_month_open(v_tour.completed_at);
  end if;
  if v_old.technician_id = p_new_technician_id then
    raise exception 'KTV mới trùng KTV hiện tại';
  end if;
  if not exists (select 1 from public.profiles
                 where id = p_new_technician_id and role = 'technician' and is_active) then
    raise exception 'KTV mới không hợp lệ hoặc đã bị khoá';
  end if;
  if exists (select 1 from public.tour_assignments
             where tour_id = v_tour.id and technician_id = p_new_technician_id and status <> 'removed') then
    raise exception 'KTV mới đã có trong tour này';
  end if;
  -- Tour còn đang chạy: người mới phải rảnh thật sự
  if v_old.status in ('accepted', 'working') then
    v_busy := public._tech_busy_reason(p_new_technician_id);
    if v_busy is not null then
      raise exception 'KTV mới đang bận: %', v_busy;
    end if;
  end if;

  v_before := public._tour_json(v_tour.id);
  update public.tour_assignments set status = 'removed', earned_amount = 0 where id = p_assignment_id;
  insert into public.tour_assignments (tour_id, technician_id, share_percent, status, accepted_at, completed_at)
  values (v_tour.id, p_new_technician_id, v_old.share_percent, v_old.status, now(), v_old.completed_at);
  perform public._recompute_tour_earnings(v_tour.id);
  perform public._log(v_tour.id, 'reassign', v_before, public._tour_json(v_tour.id), v_reason);

  if v_old.status in ('accepted', 'working') then
    perform public._dispatch_requested_for(v_old.technician_id);
    perform public._kick_dispatch_if_waiting();
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- RPC: vào / ra ca
-- -----------------------------------------------------------------------------
create or replace function public._do_check_in(p_tech uuid, p_shift public.shift_type)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_shift is null or p_shift = 'off' then
    raise exception 'Vui lòng chọn ca làm (sáng / chiều / full)';
  end if;
  if not exists (select 1 from public.profiles where id = p_tech and role = 'technician' and is_active) then
    raise exception 'Tài khoản KTV không hợp lệ';
  end if;
  insert into public.shift_checkins (technician_id, work_date, shift)
  values (p_tech, public.vn_today(), p_shift)
  on conflict (technician_id, work_date)
  do update set check_out_at = null, shift = excluded.shift;

  perform public._dispatch_requested_for(p_tech);
  perform public._kick_dispatch_if_waiting();
end $$;

create or replace function public._do_check_out(p_tech uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.tour_offers where technician_id = p_tech and status = 'pending') then
    raise exception 'Đang có lời mời tour chờ phản hồi – hãy nhận hoặc từ chối trước khi ra ca';
  end if;
  update public.shift_checkins set check_out_at = now()
  where technician_id = p_tech and work_date = public.vn_today() and check_out_at is null;
  if not found then
    raise exception 'Chưa vào ca hôm nay';
  end if;
end $$;

create or replace function public.check_in(p_shift public.shift_type)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public._require_technician();
  perform public._do_check_in(auth.uid(), p_shift);
end $$;

-- KTV được ra ca kể cả khi còn tour đang làm (tour vẫn tiếp tục, chỉ không nhận tour mới)
create or replace function public.check_out()
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public._require_technician();
  perform public._do_check_out(auth.uid());
end $$;

create or replace function public.admin_check_in(p_technician_id uuid, p_shift public.shift_type)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public._require_staff();
  perform public._do_check_in(p_technician_id, p_shift);
end $$;

create or replace function public.admin_check_out(p_technician_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public._require_staff();
  perform public._do_check_out(p_technician_id);
end $$;

-- Cron 00:05 giờ VN: đóng các ca quên bấm "Ra ca" của ngày trước
create or replace function public.close_stale_checkins()
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.shift_checkins
  set check_out_at = public.vn_day_start(work_date + 1) - interval '1 second'
  where check_out_at is null and work_date < public.vn_today();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- -----------------------------------------------------------------------------
-- Dữ liệu cho thuật toán gợi ý (src/lib/assignment/score.ts)
-- Trả về đúng shape AssignmentSnapshot.
-- -----------------------------------------------------------------------------
create or replace function public.assignment_snapshot(p_service_ids uuid[], p_tour_id uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_today date := public.vn_today();
  v_day_start timestamptz := public.vn_day_start(public.vn_today());
  v_month_start timestamptz := public.vn_day_start(date_trunc('month', public.vn_today())::date);
  v_settings public.app_settings;
  v_duration integer;
  v_required uuid[];
  v_techs jsonb;
begin
  if not (public.is_staff() or public.is_service_role()) then
    raise exception 'Bạn không có quyền thực hiện thao tác này' using errcode = '42501';
  end if;
  select * into v_settings from public.app_settings where id;

  select coalesce(sum(s.duration_minutes), 0) into v_duration
  from unnest(coalesce(p_service_ids, '{}')) sid join public.services s on s.id = sid;
  select coalesce(array_agg(distinct s.id), '{}') into v_required
  from public.services s where s.id = any (coalesce(p_service_ids, '{}')) and s.requires_skill;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'fullName', p.full_name,
    'isActive', p.is_active,
    'checkedIn', c.id is not null and c.check_out_at is null,
    'isFree', public._tech_busy_reason(p.id) is null,
    'busyReason', public._tech_busy_reason(p.id),
    'shift', c.shift,
    'checkInAt', c.check_in_at,
    'skillServiceIds', coalesce((select jsonb_agg(k.service_id) from public.technician_skills k
                                 where k.technician_id = p.id), '[]'::jsonb),
    'excluded', p_tour_id is not null and exists (
      select 1 from public.tour_offers o
      where o.tour_id = p_tour_id and o.technician_id = p.id and o.status in ('declined', 'expired')),
    'todayEarnings', coalesce(e.today_amount, 0),
    'monthEarnings', coalesce(e.month_amount, 0),
    'monthRequestedEarnings', coalesce(e.month_requested_amount, 0),
    'lastTourEndedAt', e.last_end,
    'declinesToday', (select count(*) from public.tour_offers o
                      where o.technician_id = p.id and o.status in ('declined', 'expired')
                        and o.offered_at >= v_day_start)
  ) order by p.full_name), '[]'::jsonb)
  into v_techs
  from public.profiles p
  left join public.shift_checkins c on c.technician_id = p.id and c.work_date = v_today
  left join lateral (
    select
      sum(a.earned_amount) filter (where t.completed_at >= v_day_start) as today_amount,
      sum(a.earned_amount) filter (where t.completed_at >= v_month_start) as month_amount,
      sum(a.earned_amount) filter (where t.completed_at >= v_month_start and t.is_requested
                                   and t.requested_technician_id = a.technician_id) as month_requested_amount,
      max(coalesce(a.completed_at, t.completed_at)) as last_end
    from public.tour_assignments a
    join public.tours t on t.id = a.tour_id
    where a.technician_id = p.id and a.status = 'done' and t.status = 'completed'
      and t.completed_at >= v_month_start
  ) e on true
  where p.role = 'technician' and p.is_active;

  return jsonb_build_object(
    'now', now(),
    'durationMinutes', v_duration,
    'requiredSkillServiceIds', to_jsonb(v_required),
    'settings', jsonb_build_object(
      'weights', v_settings.weights,
      'requestedThresholdPercent', v_settings.requested_threshold_percent,
      'shiftHours', v_settings.shift_hours,
      'randomPoolSize', v_settings.random_pool_size
    ),
    'technicians', v_techs
  );
end $$;

-- -----------------------------------------------------------------------------
-- Bảng điều phối (admin) – 1 lần gọi lấy đủ dữ liệu, client refetch khi có Realtime
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_snapshot()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_today date := public.vn_today();
  v_day_start timestamptz := public.vn_day_start(public.vn_today());
  v_month_start timestamptz := public.vn_day_start(date_trunc('month', public.vn_today())::date);
  v_settings public.app_settings;
begin
  perform public._require_staff();
  select * into v_settings from public.app_settings where id;

  return jsonb_build_object(
    'now', now(),
    'today', v_today,
    'settings', jsonb_build_object(
      'offerTimeoutSeconds', v_settings.offer_timeout_seconds,
      'shiftHours', v_settings.shift_hours,
      'imbalanceThresholdPercent', v_settings.imbalance_threshold_percent,
      'requestedThresholdPercent', v_settings.requested_threshold_percent
    ),
    'technicians', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'fullName', p.full_name, 'username', p.username,
        'defaultShift', p.shift,
        'scheduledShift', coalesce(ss.shift, p.shift),
        'checkin', case when c.id is null then null else jsonb_build_object(
          'shift', c.shift, 'checkInAt', c.check_in_at, 'checkOutAt', c.check_out_at) end,
        'offer', (select jsonb_build_object(
            'id', o.id, 'tourId', o.tour_id, 'code', t.code, 'customerName', t.customer_name,
            'offeredAt', o.offered_at, 'expiresAt', o.expires_at)
          from public.tour_offers o join public.tours t on t.id = o.tour_id
          where o.technician_id = p.id and o.status = 'pending' limit 1),
        'work', (select jsonb_build_object(
            'tourId', t.id, 'code', t.code, 'customerName', t.customer_name,
            'status', a.status, 'startedAt', t.started_at, 'isRequested', t.is_requested,
            'durationMinutes', (select sum(i.duration_snapshot) from public.tour_items i where i.tour_id = t.id),
            'services', (select string_agg(i.service_name_snapshot, ', ' order by i.position)
                         from public.tour_items i where i.tour_id = t.id))
          from public.tour_assignments a join public.tours t on t.id = a.tour_id
          where a.technician_id = p.id and a.status in ('accepted', 'working') limit 1),
        'todayAmount', coalesce(e.today_amount, 0),
        'monthAmount', coalesce(e.month_amount, 0),
        'monthRequestedAmount', coalesce(e.month_requested_amount, 0),
        'todayTours', coalesce(e.today_tours, 0),
        'lastTourEndedAt', e.last_end
      ) order by p.full_name)
      from public.profiles p
      left join public.shift_checkins c on c.technician_id = p.id and c.work_date = v_today
      left join public.shift_schedules ss on ss.technician_id = p.id and ss.work_date = v_today
      left join lateral (
        select
          sum(a.earned_amount) filter (where t.completed_at >= v_day_start) as today_amount,
          count(*) filter (where t.completed_at >= v_day_start) as today_tours,
          sum(a.earned_amount) as month_amount,
          sum(a.earned_amount) filter (where t.is_requested and t.requested_technician_id = a.technician_id)
            as month_requested_amount,
          max(coalesce(a.completed_at, t.completed_at)) as last_end
        from public.tour_assignments a join public.tours t on t.id = a.tour_id
        where a.technician_id = p.id and a.status = 'done' and t.status = 'completed'
          and t.completed_at >= v_month_start
      ) e on true
      where p.role = 'technician' and p.is_active
    ), '[]'::jsonb),
    'tours', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'code', t.code, 'customerName', t.customer_name, 'customerPhone', t.customer_phone,
        'note', t.note, 'status', t.status, 'assignMode', t.assign_mode, 'isRequested', t.is_requested,
        'requestedTechnicianId', t.requested_technician_id,
        'requestedTechnicianName', (select full_name from public.profiles where id = t.requested_technician_id),
        'teamSize', t.team_size, 'createdAt', t.created_at, 'startedAt', t.started_at,
        'completedAt', t.completed_at, 'cancelledReason', t.cancelled_reason,
        'totalFee', (select coalesce(sum(i.fee_snapshot), 0) from public.tour_items i where i.tour_id = t.id),
        'durationMinutes', (select coalesce(sum(i.duration_snapshot), 0) from public.tour_items i where i.tour_id = t.id),
        'items', (select coalesce(jsonb_agg(jsonb_build_object(
                    'serviceId', i.service_id, 'name', i.service_name_snapshot,
                    'fee', i.fee_snapshot, 'duration', i.duration_snapshot) order by i.position), '[]'::jsonb)
                  from public.tour_items i where i.tour_id = t.id),
        'members', (select coalesce(jsonb_agg(jsonb_build_object(
                      'assignmentId', a.id, 'technicianId', a.technician_id, 'name', p.full_name,
                      'status', a.status, 'sharePercent', a.share_percent, 'amount', a.earned_amount)
                      order by a.share_percent desc), '[]'::jsonb)
                    from public.tour_assignments a join public.profiles p on p.id = a.technician_id
                    where a.tour_id = t.id and a.status <> 'removed'),
        'pendingOffers', (select coalesce(jsonb_agg(jsonb_build_object(
                            'id', o.id, 'technicianId', o.technician_id, 'name', p.full_name,
                            'expiresAt', o.expires_at, 'sharePercent', o.share_percent)), '[]'::jsonb)
                          from public.tour_offers o join public.profiles p on p.id = o.technician_id
                          where o.tour_id = t.id and o.status = 'pending')
      ) order by t.created_at desc)
      from public.tours t
      where t.created_at >= v_day_start or t.status in ('waiting', 'offered', 'in_progress')
    ), '[]'::jsonb),
    'alerts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', al.id, 'tourId', al.tour_id, 'kind', al.kind, 'message', al.message, 'createdAt', al.created_at)
        order by al.created_at desc)
      from public.admin_alerts al where al.resolved_at is null
    ), '[]'::jsonb)
  );
end $$;

create or replace function public.resolve_alert(p_alert_id bigint)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public._require_staff();
  update public.admin_alerts set resolved_at = now(), resolved_by = auth.uid()
  where id = p_alert_id and resolved_at is null;
end $$;

-- -----------------------------------------------------------------------------
-- Màn hình KTV – 1 lần gọi lấy trạng thái của chính mình
-- -----------------------------------------------------------------------------
create or replace function public.my_snapshot()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := public.vn_today();
  v_day_start timestamptz := public.vn_day_start(public.vn_today());
  v_month_start timestamptz := public.vn_day_start(date_trunc('month', public.vn_today())::date);
  v_settings public.app_settings;
  v_profile public.profiles;
begin
  perform public._require_technician();
  select * into v_settings from public.app_settings where id;
  select * into v_profile from public.profiles where id = v_uid;

  return jsonb_build_object(
    'now', now(),
    'today', v_today,
    'profile', jsonb_build_object('id', v_profile.id, 'fullName', v_profile.full_name,
                                  'username', v_profile.username, 'defaultShift', v_profile.shift),
    'scheduledShift', coalesce((select shift from public.shift_schedules
                                where technician_id = v_uid and work_date = v_today), v_profile.shift),
    'settings', jsonb_build_object(
      'offerTimeoutSeconds', v_settings.offer_timeout_seconds,
      'declineReasons', to_jsonb(v_settings.decline_reasons),
      'shiftHours', v_settings.shift_hours),
    'checkin', (select jsonb_build_object('shift', c.shift, 'checkInAt', c.check_in_at, 'checkOutAt', c.check_out_at)
                from public.shift_checkins c where c.technician_id = v_uid and c.work_date = v_today),
    'offer', (select jsonb_build_object(
        'id', o.id, 'offeredAt', o.offered_at, 'expiresAt', o.expires_at, 'sharePercent', o.share_percent,
        'tour', jsonb_build_object(
          'id', t.id, 'code', t.code, 'customerName', t.customer_name, 'note', t.note,
          'isRequested', t.is_requested and t.requested_technician_id = v_uid,
          'teamSize', t.team_size,
          'items', (select coalesce(jsonb_agg(jsonb_build_object(
                      'name', i.service_name_snapshot, 'fee', i.fee_snapshot, 'duration', i.duration_snapshot)
                      order by i.position), '[]'::jsonb)
                    from public.tour_items i where i.tour_id = t.id),
          'totalFee', (select coalesce(sum(i.fee_snapshot), 0) from public.tour_items i where i.tour_id = t.id),
          'durationMinutes', (select coalesce(sum(i.duration_snapshot), 0) from public.tour_items i where i.tour_id = t.id)))
      from public.tour_offers o join public.tours t on t.id = o.tour_id
      where o.technician_id = v_uid and o.status = 'pending'
      order by o.offered_at desc limit 1),
    'work', (select jsonb_build_object(
        'assignmentStatus', a.status, 'sharePercent', a.share_percent,
        'tour', jsonb_build_object(
          'id', t.id, 'code', t.code, 'customerName', t.customer_name, 'note', t.note,
          'startedAt', t.started_at, 'isRequested', t.is_requested and t.requested_technician_id = v_uid,
          'teamSize', t.team_size,
          'items', (select coalesce(jsonb_agg(jsonb_build_object(
                      'name', i.service_name_snapshot, 'fee', i.fee_snapshot, 'duration', i.duration_snapshot)
                      order by i.position), '[]'::jsonb)
                    from public.tour_items i where i.tour_id = t.id),
          'totalFee', (select coalesce(sum(i.fee_snapshot), 0) from public.tour_items i where i.tour_id = t.id),
          'durationMinutes', (select coalesce(sum(i.duration_snapshot), 0) from public.tour_items i where i.tour_id = t.id),
          'partners', (select coalesce(jsonb_agg(jsonb_build_object('name', p.full_name, 'status', a2.status)), '[]'::jsonb)
                       from public.tour_assignments a2 join public.profiles p on p.id = a2.technician_id
                       where a2.tour_id = t.id and a2.technician_id <> v_uid and a2.status <> 'removed')))
      from public.tour_assignments a join public.tours t on t.id = a.tour_id
      where a.technician_id = v_uid and a.status in ('accepted', 'working') limit 1),
    'todayAmount', (select coalesce(sum(a.earned_amount), 0) from public.tour_assignments a
                    join public.tours t on t.id = a.tour_id
                    where a.technician_id = v_uid and a.status = 'done' and t.status = 'completed'
                      and t.completed_at >= v_day_start),
    'todayTours', (select count(*) from public.tour_assignments a join public.tours t on t.id = a.tour_id
                   where a.technician_id = v_uid and a.status = 'done' and t.status = 'completed'
                     and t.completed_at >= v_day_start),
    'monthAmount', (select coalesce(sum(a.earned_amount), 0) from public.tour_assignments a
                    join public.tours t on t.id = a.tour_id
                    where a.technician_id = v_uid and a.status = 'done' and t.status = 'completed'
                      and t.completed_at >= v_month_start),
    'monthTours', (select count(*) from public.tour_assignments a join public.tours t on t.id = a.tour_id
                   where a.technician_id = v_uid and a.status = 'done' and t.status = 'completed'
                     and t.completed_at >= v_month_start),
    'unreadAnnouncements', (select count(*) from public.announcement_recipients r
                            where r.technician_id = v_uid and r.read_at is null)
  );
end $$;

-- -----------------------------------------------------------------------------
-- Thu nhập
-- -----------------------------------------------------------------------------
-- Mỗi dòng = phần tiền của 1 KTV trong 1 tour ĐÃ HOÀN THÀNH.
-- security_invoker: KTV chỉ thấy dòng của mình (theo RLS các bảng gốc).
create or replace view public.earning_lines
with (security_invoker = true) as
select
  a.id as assignment_id,
  a.technician_id,
  p.full_name as technician_name,
  t.id as tour_id,
  t.code,
  t.customer_name,
  t.started_at,
  t.completed_at,
  public.vn_date(t.completed_at) as work_date,
  public.vn_month(t.completed_at) as month,
  (select coalesce(sum(i.fee_snapshot), 0) from public.tour_items i where i.tour_id = t.id)::integer as tour_total,
  a.share_percent,
  a.earned_amount as amount,
  (t.is_requested and t.requested_technician_id = a.technician_id) as is_requested,
  t.team_size,
  (select string_agg(i.service_name_snapshot, ', ' order by i.position)
   from public.tour_items i where i.tour_id = t.id) as services
from public.tour_assignments a
join public.tours t on t.id = a.tour_id
join public.profiles p on p.id = a.technician_id
where t.status = 'completed' and a.status <> 'removed';

create or replace view public.earnings_daily
with (security_invoker = true) as
select technician_id, technician_name, work_date,
       count(*)::integer as tours,
       count(*) filter (where is_requested)::integer as requested_tours,
       sum(amount)::bigint as amount
from public.earning_lines
group by technician_id, technician_name, work_date;

create or replace view public.earnings_monthly
with (security_invoker = true) as
select technician_id, technician_name, month,
       count(*)::integer as tours,
       count(*) filter (where is_requested)::integer as requested_tours,
       sum(amount)::bigint as amount,
       sum(amount) filter (where is_requested)::bigint as requested_amount
from public.earning_lines
group by technician_id, technician_name, month;

-- Tổng tiền tour của 1 KTV trong khoảng ngày (giờ VN, tính cả 2 đầu)
create or replace function public.technician_earnings(p_technician_id uuid, p_from date, p_to date)
returns bigint
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not (p_technician_id = auth.uid() or public.is_staff()) then
    raise exception 'Bạn không có quyền xem thu nhập này' using errcode = '42501';
  end if;
  return (
    select coalesce(sum(a.earned_amount), 0)
    from public.tour_assignments a join public.tours t on t.id = a.tour_id
    where a.technician_id = p_technician_id and a.status <> 'removed' and t.status = 'completed'
      and t.completed_at >= public.vn_day_start(p_from)
      and t.completed_at < public.vn_day_start(p_to + 1)
  );
end $$;

-- Thống kê nhận / từ chối / hết giờ theo KTV
create or replace function public.technician_response_stats(p_from date, p_to date)
returns table (
  technician_id uuid, full_name text, offers integer, accepted integer, declined integer, expired integer
)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public._require_staff();
  return query
  select p.id, p.full_name,
    count(o.id)::integer,
    count(o.id) filter (where o.status = 'accepted')::integer,
    count(o.id) filter (where o.status = 'declined')::integer,
    count(o.id) filter (where o.status = 'expired')::integer
  from public.profiles p
  left join public.tour_offers o on o.technician_id = p.id
    and o.offered_at >= public.vn_day_start(p_from)
    and o.offered_at < public.vn_day_start(p_to + 1)
  where p.role = 'technician'
  group by p.id, p.full_name
  order by p.full_name;
end $$;

-- -----------------------------------------------------------------------------
-- Tài khoản: owner sửa hồ sơ + kỹ năng (tạo/khoá/xoá/đổi mật khẩu ở Edge Function)
-- -----------------------------------------------------------------------------
create or replace function public.update_member_profile(
  p_id uuid, p_full_name text, p_phone text, p_shift public.shift_type, p_skill_ids uuid[]
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  perform public._require_owner();
  select role into v_role from public.profiles where id = p_id;
  if not found then
    raise exception 'Không tìm thấy tài khoản';
  end if;
  if length(btrim(coalesce(p_full_name, ''))) = 0 then
    raise exception 'Vui lòng nhập họ tên';
  end if;
  update public.profiles
  set full_name = btrim(p_full_name),
      phone = nullif(btrim(coalesce(p_phone, '')), ''),
      shift = coalesce(p_shift, shift)
  where id = p_id;
  if v_role = 'technician' and p_skill_ids is not null then
    delete from public.technician_skills where technician_id = p_id and not (service_id = any (p_skill_ids));
    insert into public.technician_skills (technician_id, service_id)
    select p_id, sid from unnest(p_skill_ids) sid
    where exists (select 1 from public.services s where s.id = sid)
    on conflict do nothing;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Thông báo
-- -----------------------------------------------------------------------------
create or replace function public.send_announcement(p_title text, p_body text, p_technician_ids uuid[] default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_target text := case when coalesce(array_length(p_technician_ids, 1), 0) = 0 then 'all' else 'individual' end;
begin
  perform public._require_staff();
  if length(btrim(coalesce(p_title, ''))) = 0 or length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'Vui lòng nhập tiêu đề và nội dung';
  end if;
  insert into public.announcements (title, body, target, created_by)
  values (btrim(p_title), btrim(p_body), v_target, auth.uid())
  returning id into v_id;

  insert into public.announcement_recipients (announcement_id, technician_id)
  select v_id, p.id from public.profiles p
  where p.role = 'technician' and p.is_active
    and (v_target = 'all' or p.id = any (p_technician_ids));
  if not found then
    raise exception 'Không có KTV nào nhận thông báo';
  end if;
  return v_id;
end $$;

create or replace function public.mark_announcement_read(p_announcement_id uuid default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  -- null = đánh dấu tất cả đã đọc
  update public.announcement_recipients set read_at = now()
  where technician_id = auth.uid() and read_at is null
    and (p_announcement_id is null or announcement_id = p_announcement_id);
end $$;

-- -----------------------------------------------------------------------------
-- Chốt lương & báo sai
-- -----------------------------------------------------------------------------
create or replace function public.payroll_summary(p_month date)
returns table (
  technician_id uuid, full_name text, username text, is_active boolean,
  tours integer, requested_tours integer, amount bigint, requested_amount bigint, open_disputes integer
)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_month date := date_trunc('month', p_month)::date;
begin
  perform public._require_staff();
  return query
  select p.id, p.full_name, p.username, p.is_active,
    coalesce(m.tours, 0), coalesce(m.requested_tours, 0),
    coalesce(m.amount, 0)::bigint, coalesce(m.requested_amount, 0)::bigint,
    (select count(*)::integer from public.earning_disputes d
     where d.technician_id = p.id and d.month = v_month and d.status = 'open')
  from public.profiles p
  left join lateral (
    select count(*)::integer as tours,
           count(*) filter (where t.is_requested and t.requested_technician_id = a.technician_id)::integer as requested_tours,
           sum(a.earned_amount) as amount,
           sum(a.earned_amount) filter (where t.is_requested and t.requested_technician_id = a.technician_id) as requested_amount
    from public.tour_assignments a join public.tours t on t.id = a.tour_id
    where a.technician_id = p.id and a.status <> 'removed' and t.status = 'completed'
      and public.vn_month(t.completed_at) = v_month
  ) m on true
  where p.role = 'technician' and (p.is_active or coalesce(m.tours, 0) > 0)
  order by p.full_name;
end $$;

create or replace function public.lock_month(p_month date)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
begin
  perform public._require_owner();
  if v_month > date_trunc('month', public.vn_today())::date then
    raise exception 'Không thể chốt sổ tháng trong tương lai';
  end if;
  if exists (select 1 from public.tours t
             where t.status in ('waiting', 'offered', 'in_progress')
               and public.vn_month(t.created_at) <= v_month) then
    raise exception 'Còn tour chưa kết thúc trong tháng – hãy hoàn thành hoặc huỷ trước khi chốt sổ';
  end if;
  insert into public.payroll_periods (month, status, locked_at, locked_by)
  values (v_month, 'locked', now(), auth.uid())
  on conflict (month) do update set status = 'locked', locked_at = now(), locked_by = auth.uid();
  perform public._log(null, 'lock_month', null, jsonb_build_object('month', v_month), null);
end $$;

create or replace function public.unlock_month(p_month date, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_reason text := public._require_reason(p_reason);
  v_month date := date_trunc('month', p_month)::date;
begin
  perform public._require_owner();
  update public.payroll_periods set status = 'open', locked_at = null, locked_by = null
  where month = v_month and status = 'locked';
  if not found then
    raise exception 'Tháng này chưa chốt sổ';
  end if;
  perform public._log(null, 'unlock_month', null, jsonb_build_object('month', v_month), v_reason);
end $$;

create or replace function public.create_dispute(p_tour_id uuid, p_month date, p_message text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_id uuid;
begin
  perform public._require_technician();
  if length(btrim(coalesce(p_message, ''))) = 0 then
    raise exception 'Vui lòng mô tả chỗ sai';
  end if;
  if p_tour_id is not null then
    if not exists (select 1 from public.tour_assignments
                   where tour_id = p_tour_id and technician_id = auth.uid()) then
      raise exception 'Bạn không thuộc tour này';
    end if;
    select public.vn_month(coalesce(t.completed_at, t.created_at)) into v_month
    from public.tours t where t.id = p_tour_id;
  end if;
  insert into public.earning_disputes (technician_id, tour_id, month, message)
  values (auth.uid(), p_tour_id, v_month, btrim(p_message))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.resolve_dispute(p_id uuid, p_status public.dispute_status, p_reply text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public._require_owner();
  if p_status = 'open' then
    raise exception 'Trạng thái không hợp lệ';
  end if;
  update public.earning_disputes
  set status = p_status, admin_reply = nullif(btrim(coalesce(p_reply, '')), ''),
      resolved_at = now(), resolved_by = auth.uid()
  where id = p_id;
  if not found then
    raise exception 'Không tìm thấy yêu cầu';
  end if;
end $$;
