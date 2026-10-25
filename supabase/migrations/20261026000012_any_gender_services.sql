-- Dịch vụ chuyên môn không phân biệt giới tính khách (tiêm meso, botox, HIFU…):
-- tour CHỈ gồm các dịch vụ này thì KTV nam có kỹ năng vẫn làm được cho khách nữ
-- (và ngược lại). Tour có lẫn dịch vụ thường thì vẫn theo quy tắc giới tính.

alter table public.services add column any_gender boolean not null default false;
comment on column public.services.any_gender is
  'Không phân biệt giới tính khách: KTV nam/nữ có kỹ năng đều được phân';

-- Tour chỉ gồm dịch vụ không phân biệt giới tính?
create or replace function public._tour_gender_free(p_tour_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.tour_items i where i.tour_id = p_tour_id)
     and not exists (select 1 from public.tour_items i
                     join public.services s on s.id = i.service_id
                     where i.tour_id = p_tour_id and not s.any_gender)
$$;

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

  -- Giới tính: khách nữ chỉ KTV nữ. Khách nam ưu tiên KTV nam nhưng được chuyển
  -- KTV nữ khi không còn KTV nam rảnh (thuật toán xếp; ở đây không chặn).
  -- Khách chỉ định thì theo đúng lựa chọn của khách. Tour CHỈ gồm dịch vụ
  -- "không phân biệt giới tính" (tiêm meso, botox, HIFU…) thì KTV nam/nữ đều được.
  if v_tour.customer_gender = 'female'
     and not (v_tour.is_requested and p_tech = v_tour.requested_technician_id)
     and not public._tour_gender_free(p_tour_id)
     and exists (select 1 from public.profiles where id = p_tech and gender = 'male') then
    raise exception 'Khách nữ chỉ phân cho KTV nữ (trừ tour chỉ gồm dịch vụ không phân biệt giới tính)';
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
    'genderFree', coalesce(array_length(p_service_ids, 1), 0) > 0
                  and not exists (select 1 from public.services s
                                  where s.id = any (p_service_ids) and not s.any_gender),
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

revoke execute on function public._tour_gender_free(uuid) from public, anon, authenticated;
grant execute on function public._tour_gender_free(uuid) to service_role;
