-- Kỳ lương (chốt tour) theo ngày bắt đầu cấu hình được – mặc định 21:
-- kỳ "tháng 11/2026" = 21/10/2026 → 20/11/2026. payroll_start_day = 1 → tháng lịch.
-- Khoá kỳ lương = payroll_periods.month (ngày 1 của tháng KẾT THÚC kỳ).
-- Mọi phép tính "tháng" (thu nhập tháng, chốt sổ, báo sai, cân bằng thuật toán)
-- chuyển sang tính theo kỳ lương. Thêm earnings_summary(from, to) để xem khoảng ngày bất kỳ.

alter table public.app_settings
  add column payroll_start_day integer not null default 21 check (payroll_start_day between 1 and 28);

create or replace function public.payroll_start_day()
returns integer
language sql stable security definer
set search_path = ''
as $$ select coalesce((select payroll_start_day from public.app_settings where id), 21) $$;

-- Kỳ lương của một ngày (giờ VN): ngày < ngày bắt đầu → kỳ tháng này, ngược lại → kỳ tháng sau
create or replace function public.pay_period_of_date(d date)
returns date
language plpgsql stable
set search_path = ''
as $$
declare
  v_start integer := public.payroll_start_day();
begin
  if v_start = 1 or extract(day from d) < v_start then
    return date_trunc('month', d)::date;
  end if;
  return (date_trunc('month', d) + interval '1 month')::date;
end $$;

create or replace function public.pay_period_of(ts timestamptz)
returns date
language sql stable
set search_path = ''
as $$ select public.pay_period_of_date(public.vn_date(ts)) $$;

-- Ngày đầu / cuối (tính cả 2 đầu) của kỳ lương p (= ngày 1 của tháng kết thúc kỳ)
create or replace function public.pay_period_from(p date)
returns date
language plpgsql stable
set search_path = ''
as $$
declare
  v_start integer := public.payroll_start_day();
begin
  if v_start = 1 then
    return date_trunc('month', p)::date;
  end if;
  return (date_trunc('month', p) - interval '1 month')::date + (v_start - 1);
end $$;

create or replace function public.pay_period_to(p date)
returns date
language sql stable
set search_path = ''
as $$ select public.pay_period_from((date_trunc('month', p) + interval '1 month')::date) - 1 $$;

create or replace function public.pay_period_label(p date)
returns text
language sql stable
set search_path = ''
as $$ select to_char(public.pay_period_from(p), 'DD/MM') || ' – ' || to_char(public.pay_period_to(p), 'DD/MM/YYYY') $$;

create or replace function public.pay_period_json(p date)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object('key', p, 'from', public.pay_period_from(p), 'to', public.pay_period_to(p),
                            'startDay', public.payroll_start_day())
$$;

-- Đã có kỳ chốt sổ thì không đổi ngày bắt đầu kỳ (khoá theo kỳ sẽ lệch nghĩa)
create or replace function public._guard_payroll_start_day()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.payroll_start_day is distinct from old.payroll_start_day
     and exists (select 1 from public.payroll_periods where status = 'locked') then
    raise exception 'Đã có kỳ lương chốt sổ – mở sổ các kỳ đó trước khi đổi ngày bắt đầu kỳ';
  end if;
  return new;
end $$;

create trigger app_settings_guard_payroll_start before update of payroll_start_day on public.app_settings
  for each row execute function public._guard_payroll_start_day();

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
  public.pay_period_of(t.completed_at) as month, -- kỳ lương (xem pay_period_of)
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


create or replace function public._assert_month_open(p_ts timestamptz)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if p_ts is not null and public._is_month_locked(public.pay_period_of(p_ts)) then
    raise exception 'Kỳ lương % đã chốt sổ, không thể thay đổi. Liên hệ chủ spa để mở sổ.',
      public.pay_period_label(public.pay_period_of(p_ts));
  end if;
end $$;

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
      and public.pay_period_of(t.completed_at) = v_month
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
  if v_month > public.pay_period_of_date(public.vn_today()) then
    raise exception 'Không thể chốt sổ kỳ lương chưa bắt đầu';
  end if;
  if exists (select 1 from public.tours t
             where t.status in ('waiting', 'offered', 'in_progress')
               and public.pay_period_of(t.created_at) <= v_month) then
    raise exception 'Còn tour chưa kết thúc trong kỳ – hãy hoàn thành hoặc huỷ trước khi chốt sổ';
  end if;
  insert into public.payroll_periods (month, status, locked_at, locked_by)
  values (v_month, 'locked', now(), auth.uid())
  on conflict (month) do update set status = 'locked', locked_at = now(), locked_by = auth.uid();
  perform public._log(null, 'lock_month', null, jsonb_build_object('month', v_month), null);
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
    select public.pay_period_of(coalesce(t.completed_at, t.created_at)) into v_month
    from public.tours t where t.id = p_tour_id;
  end if;
  insert into public.earning_disputes (technician_id, tour_id, month, message)
  values (auth.uid(), p_tour_id, v_month, btrim(p_message))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.my_snapshot()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := public.vn_today();
  v_day_start timestamptz := public.vn_day_start(public.vn_today());
  v_month_start timestamptz := public.vn_day_start(public.pay_period_from(public.pay_period_of_date(public.vn_today())));
  v_settings public.app_settings;
  v_profile public.profiles;
begin
  perform public._require_technician();
  select * into v_settings from public.app_settings where id;
  select * into v_profile from public.profiles where id = v_uid;

  return jsonb_build_object(
    'now', now(),
    'today', v_today,
    'period', public.pay_period_json(public.pay_period_of_date(v_today)),
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
          'id', t.id, 'code', t.code, 'customerName', t.customer_name, 'customerGender', t.customer_gender,
          'note', t.note,
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
          'id', t.id, 'code', t.code, 'customerName', t.customer_name, 'customerGender', t.customer_gender,
          'note', t.note,
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

create or replace function public.dashboard_snapshot()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_today date := public.vn_today();
  v_day_start timestamptz := public.vn_day_start(public.vn_today());
  v_month_start timestamptz := public.vn_day_start(public.pay_period_from(public.pay_period_of_date(public.vn_today())));
  v_settings public.app_settings;
begin
  perform public._require_staff();
  select * into v_settings from public.app_settings where id;

  return jsonb_build_object(
    'now', now(),
    'today', v_today,
    'period', public.pay_period_json(public.pay_period_of_date(v_today)),
    'settings', jsonb_build_object(
      'offerTimeoutSeconds', v_settings.offer_timeout_seconds,
      'shiftHours', v_settings.shift_hours,
      'imbalanceThresholdPercent', v_settings.imbalance_threshold_percent,
      'requestedThresholdPercent', v_settings.requested_threshold_percent
    ),
    'technicians', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'fullName', p.full_name, 'username', p.username, 'gender', coalesce(p.gender, 'female'),
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
        'todayRequestedAmount', coalesce(e.today_requested_amount, 0),
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
          sum(a.earned_amount) filter (where t.completed_at >= v_day_start and t.is_requested
                                       and t.requested_technician_id = a.technician_id) as today_requested_amount,
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
        'customerGender', t.customer_gender,
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

create or replace function public.assignment_snapshot(p_service_ids uuid[], p_tour_id uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_today date := public.vn_today();
  v_day_start timestamptz := public.vn_day_start(public.vn_today());
  v_month_start timestamptz := public.vn_day_start(public.pay_period_from(public.pay_period_of_date(public.vn_today())));
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
    'gender', coalesce(p.gender, 'female'),
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
    'todayRequestedEarnings', coalesce(e.today_requested_amount, 0),
    'todayRequestedMinutes', coalesce(e.today_requested_minutes, 0),
    'monthEarnings', coalesce(e.month_amount, 0),
    'monthRequestedEarnings', coalesce(e.month_requested_amount, 0),
    'monthRequestedMinutes', coalesce(e.month_requested_minutes, 0),
    -- tổng phút trong ca của kỳ lương này (ca đang mở tính đến hiện tại)
    'monthWorkedMinutes', coalesce((
      select sum(extract(epoch from (coalesce(c2.check_out_at, now()) - c2.check_in_at)) / 60)
      from public.shift_checkins c2
      where c2.technician_id = p.id
        and c2.work_date >= public.pay_period_from(public.pay_period_of_date(v_today))), 0),
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
      sum(a.earned_amount) filter (where t.completed_at >= v_day_start and t.is_requested
                                   and t.requested_technician_id = a.technician_id) as today_requested_amount,
      sum(extract(epoch from (coalesce(a.completed_at, t.completed_at) - t.started_at)) / 60)
        filter (where t.completed_at >= v_month_start and t.is_requested
                and t.requested_technician_id = a.technician_id) as month_requested_minutes,
      sum(extract(epoch from (coalesce(a.completed_at, t.completed_at) - t.started_at)) / 60)
        filter (where t.completed_at >= v_day_start and t.is_requested
                and t.requested_technician_id = a.technician_id) as today_requested_minutes,
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
    'customerGender', (select t.customer_gender from public.tours t where t.id = p_tour_id),
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

-- Tổng hợp tiền tour theo khoảng ngày bất kỳ (giờ VN, tính cả 2 đầu) – để xem / xuất Excel
create or replace function public.earnings_summary(p_from date, p_to date)
returns table (
  technician_id uuid, full_name text, username text, is_active boolean,
  tours integer, requested_tours integer, amount bigint, requested_amount bigint
)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public._require_staff();
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Khoảng ngày không hợp lệ';
  end if;
  if p_to - p_from > 400 then
    raise exception 'Chỉ xem tối đa khoảng 13 tháng một lần';
  end if;
  return query
  select p.id, p.full_name, p.username, p.is_active,
    coalesce(m.tours, 0), coalesce(m.requested_tours, 0),
    coalesce(m.amount, 0)::bigint, coalesce(m.requested_amount, 0)::bigint
  from public.profiles p
  left join lateral (
    select count(*)::integer as tours,
           count(*) filter (where t.is_requested and t.requested_technician_id = a.technician_id)::integer as requested_tours,
           sum(a.earned_amount) as amount,
           sum(a.earned_amount) filter (where t.is_requested and t.requested_technician_id = a.technician_id) as requested_amount
    from public.tour_assignments a join public.tours t on t.id = a.tour_id
    where a.technician_id = p.id and a.status <> 'removed' and t.status = 'completed'
      and t.completed_at >= public.vn_day_start(p_from)
      and t.completed_at < public.vn_day_start(p_to + 1)
  ) m on true
  where p.role = 'technician' and (p.is_active or coalesce(m.tours, 0) > 0)
  order by p.full_name;
end $$;

-- Quyền: hàm tiện ích kỳ lương cho người đăng nhập; trigger guard chỉ nội bộ
revoke execute on function public.payroll_start_day() from public, anon;
revoke execute on function public.pay_period_of_date(date) from public, anon;
revoke execute on function public.pay_period_of(timestamptz) from public, anon;
revoke execute on function public.pay_period_from(date) from public, anon;
revoke execute on function public.pay_period_to(date) from public, anon;
revoke execute on function public.pay_period_label(date) from public, anon;
revoke execute on function public.pay_period_json(date) from public, anon;
revoke execute on function public.earnings_summary(date, date) from public, anon;
grant execute on function public.payroll_start_day(), public.pay_period_of_date(date), public.pay_period_of(timestamptz),
  public.pay_period_from(date), public.pay_period_to(date), public.pay_period_label(date), public.pay_period_json(date),
  public.earnings_summary(date, date) to authenticated, service_role;
revoke execute on function public._guard_payroll_start_day() from public, anon, authenticated;
