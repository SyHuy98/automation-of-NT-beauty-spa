-- 1) Cân bằng công bằng hơn: chỉ tính TOUR THƯỜNG, chia theo GIỜ CÓ MẶT
--    (xem src/lib/assignment/score.ts + fairness.sim.test.ts). Snapshot trả thêm
--    tiền/phút tour khách chỉ định và tổng phút trong ca của tháng.
-- 2) Nhắc tour quá giờ: quá thời lượng dịch vụ + N phút → báo quản lý (admin_alerts,
--    có chuông) và push nhắc KTV bấm Hoàn thành. Mỗi tour chỉ nhắc 1 lần.

-- Trọng số mới (mô phỏng 20 ngày cho mức lệch thấp nhất). Chỉ đổi nếu còn đang
-- dùng bộ mặc định cũ – chủ spa đã tự chỉnh thì giữ nguyên.
alter table public.app_settings alter column weights
  set default '{"today": 10, "month": 90, "idle": 0, "shiftEnd": 50, "declines": 5}'::jsonb;
update public.app_settings
set weights = '{"today": 10, "month": 90, "idle": 0, "shiftEnd": 50, "declines": 5}'::jsonb
where weights = '{"today": 40, "month": 25, "requested": 15, "idle": 15, "shiftEnd": 50, "declines": 5}'::jsonb;

alter table public.app_settings
  add column overdue_alert_minutes integer not null default 15
  check (overdue_alert_minutes between 1 and 240);

alter table public.tours add column overdue_notified_at timestamptz;

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
    -- tổng phút trong ca tháng này (ca đang mở tính đến hiện tại)
    'monthWorkedMinutes', coalesce((
      select sum(extract(epoch from (coalesce(c2.check_out_at, now()) - c2.check_in_at)) / 60)
      from public.shift_checkins c2
      where c2.technician_id = p.id and c2.work_date >= date_trunc('month', v_today)::date), 0),
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

create or replace function public.push_targets(p_kind text, p_id text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_title text;
  v_body text;
  v_url text;
  v_tag text;
begin
  perform public._require_service_role();
  if p_kind = 'offer' then
    select o.technician_id,
           'Tour mới ' || t.code || case when t.is_requested and t.requested_technician_id = o.technician_id
                                         then ' · Chỉ định' else '' end,
           t.customer_name || ' – ' ||
             (select string_agg(i.service_name_snapshot, ', ' order by i.position)
              from public.tour_items i where i.tour_id = t.id),
           '/ktv', 'offer-' || o.id
      into v_user, v_title, v_body, v_url, v_tag
    from public.tour_offers o join public.tours t on t.id = o.tour_id
    where o.id = p_id::uuid and o.status = 'pending';
  elsif p_kind = 'overdue' then
    select a.technician_id,
           'Tour ' || t.code || ' đã quá giờ',
           t.customer_name || ' – nếu đã làm xong, nhớ bấm Hoàn thành để được cộng tiền tour',
           '/ktv', 'overdue-' || t.id
      into v_user, v_title, v_body, v_url, v_tag
    from public.tours t
    join public.tour_assignments a on a.tour_id = t.id
    where t.id = split_part(p_id, ':', 1)::uuid
      and a.technician_id = split_part(p_id, ':', 2)::uuid
      and t.status = 'in_progress' and a.status = 'working';
  elsif p_kind = 'announcement' then
    select r.technician_id, 'Thông báo: ' || a.title, left(a.body, 180), '/ktv/thong-bao', 'ann-' || a.id
      into v_user, v_title, v_body, v_url, v_tag
    from public.announcement_recipients r join public.announcements a on a.id = r.announcement_id
    where r.announcement_id = split_part(p_id, ':', 1)::uuid
      and r.technician_id = split_part(p_id, ':', 2)::uuid;
  end if;

  if v_user is null then
    return jsonb_build_object('subscriptions', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'title', v_title, 'body', v_body, 'url', v_url, 'tag', v_tag,
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
      from public.push_subscriptions s where s.user_id = v_user), '[]'::jsonb)
  );
end $$;

-- Quét tour quá giờ (pg_cron mỗi phút)
create or replace function public.check_overdue_tours()
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_minutes integer;
  v_url text;
  v_secret text;
  r record;
  v_tech uuid;
  v_count integer := 0;
begin
  select overdue_alert_minutes into v_minutes from public.app_settings where id;
  select value into v_url from private.config where key = 'functions_url';
  select value into v_secret from private.config where key = 'internal_secret';

  for r in
    select t.id, t.code, t.customer_name,
           floor(extract(epoch from (now() - t.started_at)) / 60)::integer - d.total as over_minutes
    from public.tours t
    cross join lateral (select coalesce(sum(i.duration_snapshot), 0)::integer as total
                        from public.tour_items i where i.tour_id = t.id) d
    where t.status = 'in_progress' and t.started_at is not null and t.overdue_notified_at is null
      and t.started_at + make_interval(mins => d.total + v_minutes) <= now()
    for update of t skip locked
  loop
    update public.tours set overdue_notified_at = now() where id = r.id;

    insert into public.admin_alerts (tour_id, kind, message)
    values (r.id, 'tour_overdue', format(
      'Tour %s (%s) đã quá giờ %s phút – KTV: %s. Nhắc KTV bấm Hoàn thành hoặc bấm "Hoàn thành thay".',
      r.code, r.customer_name, r.over_minutes,
      (select string_agg(p.full_name, ', ') from public.tour_assignments a
       join public.profiles p on p.id = a.technician_id
       where a.tour_id = r.id and a.status = 'working')));

    if v_url is not null and v_secret is not null then
      for v_tech in select a.technician_id from public.tour_assignments a
                    where a.tour_id = r.id and a.status = 'working' loop
        perform net.http_post(
          url := v_url || '/send-push',
          body := jsonb_build_object('kind', 'overdue', 'id', r.id || ':' || v_tech),
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
          timeout_milliseconds := 10000
        );
      end loop;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Tour đã hoàn thành / huỷ → tự đóng cảnh báo quá giờ của tour đó
create or replace function public._resolve_overdue_alerts()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status in ('completed', 'cancelled') and old.status is distinct from new.status then
    update public.admin_alerts set resolved_at = now()
    where tour_id = new.id and kind = 'tour_overdue' and resolved_at is null;
  end if;
  return new;
end $$;

create trigger tours_resolve_overdue after update of status on public.tours
  for each row execute function public._resolve_overdue_alerts();

select cron.schedule('overdue-tours', '* * * * *', $$select public.check_overdue_tours()$$);

-- Quyền: hàm hệ thống chỉ cho postgres / service_role
revoke execute on function public.check_overdue_tours() from public, anon, authenticated;
grant execute on function public.check_overdue_tours() to service_role;
revoke execute on function public._resolve_overdue_alerts() from public, anon, authenticated;
