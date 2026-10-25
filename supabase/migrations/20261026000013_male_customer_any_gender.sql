-- Khách nam đồng ý để KTV nữ làm (đông khách / khách muốn KTV nữ) dù vẫn còn
-- KTV nam rảnh: tours.allow_any_gender → thuật toán xét cả KTV nam và nữ.
-- (Khách nam chỉ định đích danh KTV nữ và trường hợp hết KTV nam rảnh đã có sẵn.)

alter table public.tours add column allow_any_gender boolean not null default false;

create or replace function public._tour_json(p_tour_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id, 'code', t.code, 'status', t.status, 'assign_mode', t.assign_mode,
    'customer_name', t.customer_name, 'customer_phone', t.customer_phone, 'note', t.note,
    'customer_gender', t.customer_gender, 'allow_any_gender', t.allow_any_gender,
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

create or replace function public.create_tour(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p ->> 'customer_name', ''));
  v_phone text := nullif(btrim(coalesce(p ->> 'customer_phone', '')), '');
  v_note text := nullif(btrim(coalesce(p ->> 'note', '')), '');
  v_gender public.gender_type := coalesce(nullif(p ->> 'customer_gender', ''), 'female')::public.gender_type;
  -- Khách nam đồng ý để KTV nữ làm (khách nữ vẫn chỉ KTV nữ)
  v_any_gender boolean := coalesce((p ->> 'allow_any_gender')::boolean, false)
                          and coalesce(nullif(p ->> 'customer_gender', ''), 'female') = 'male';
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
    code, customer_name, customer_phone, customer_gender, allow_any_gender, note, is_requested, requested_technician_id,
    team_size, assign_mode, created_by
  ) values (
    public._next_tour_code(), v_name, v_phone, v_gender, v_any_gender, v_note, v_mode = 'requested', v_req_tech,
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
  if p ? 'customer_gender' then
    update public.tours
    set customer_gender = coalesce(nullif(p ->> 'customer_gender', ''), 'female')::public.gender_type
    where id = p_tour_id;
  end if;
  if p ? 'allow_any_gender' then
    update public.tours set allow_any_gender = coalesce((p ->> 'allow_any_gender')::boolean, false)
    where id = p_tour_id;
  end if;
  -- chỉ khách nam mới có tuỳ chọn đồng ý KTV nữ
  update public.tours set allow_any_gender = false
  where id = p_tour_id and customer_gender = 'female' and allow_any_gender;
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
    -- mọi dịch vụ đều "không phân biệt giới tính" → bỏ quy tắc giới tính
    -- hoặc khách nam đã đồng ý để KTV nữ làm
    'genderFree', (coalesce(array_length(p_service_ids, 1), 0) > 0
                   and not exists (select 1 from public.services s
                                   where s.id = any (p_service_ids) and not s.any_gender))
                  or coalesce((select t.allow_any_gender from public.tours t where t.id = p_tour_id), false),
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
        'customerGender', t.customer_gender, 'allowAnyGender', t.allow_any_gender,
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

create or replace function public.get_tour(p_tour_id uuid default null, p_code text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public._require_staff();
  select t.id into v_id from public.tours t
  where (p_tour_id is not null and t.id = p_tour_id)
     or (p_tour_id is null and upper(t.code) = upper(btrim(coalesce(p_code, ''))));
  if v_id is null then
    return null;
  end if;
  return (
    select jsonb_build_object(
      'id', t.id, 'code', t.code, 'customerName', t.customer_name, 'customerPhone', t.customer_phone,
      'customerGender', t.customer_gender, 'allowAnyGender', t.allow_any_gender,
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
    )
    from public.tours t where t.id = v_id
  );
end $$;
