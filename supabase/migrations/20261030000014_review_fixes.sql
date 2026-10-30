-- =============================================================================
-- Sửa lỗi sau đợt rà soát logic + bảo mật:
--  * Tour 2 KTV: không cho 1 người lấy 100% khi còn chỗ trống (kẹt tour); giữ
--    phần % cho KTV khách chỉ định đang bận.
--  * Sửa tỷ lệ chia không vượt 100%; rút lời mời KTV chỉ định không tự gửi lại;
--    tour chỉ định đang chờ được quét lại mỗi phút.
--  * Chỉ chốt sổ kỳ đã kết thúc; đổi KTV / sửa tour vẫn giữ luật kỹ năng + giới tính.
--  * Vào ca lại trong ngày không tính khoảng nghỉ; khoá theo thứ tự tour → offer.
--  * Bảo mật: KTV không đọc được SĐT khách qua API; giới hạn link ảnh / push.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Cấu trúc
-- -----------------------------------------------------------------------------

-- Phút đã làm trong ngày trước lần vào ca lại (ra ca rồi vào lại)
alter table public.shift_checkins
  add column worked_minutes_before integer not null default 0 check (worked_minutes_before >= 0);

-- Chỉ có 1 chủ spa
create unique index profiles_single_owner on public.profiles ((role)) where role = 'owner';

-- Index cho các khoá ngoại (Supabase advisor)
create index admin_alerts_tour_idx on public.admin_alerts (tour_id);
create index admin_alerts_resolved_by_idx on public.admin_alerts (resolved_by);
create index announcements_created_by_idx on public.announcements (created_by);
create index app_settings_updated_by_idx on public.app_settings (updated_by);
create index earning_disputes_resolved_by_idx on public.earning_disputes (resolved_by);
create index earning_disputes_technician_idx on public.earning_disputes (technician_id);
create index earning_disputes_tour_idx on public.earning_disputes (tour_id);
create index payroll_periods_locked_by_idx on public.payroll_periods (locked_by);
create index shift_schedules_updated_by_idx on public.shift_schedules (updated_by);
create index tour_audit_logs_actor_idx on public.tour_audit_logs (actor_id);
create index tour_items_service_idx on public.tour_items (service_id);
create index tour_offers_offered_by_idx on public.tour_offers (offered_by);
create index tours_created_by_idx on public.tours (created_by);
create index tours_requested_technician_idx on public.tours (requested_technician_id);

-- -----------------------------------------------------------------------------
-- Helper mới
-- -----------------------------------------------------------------------------

-- Tour khách chỉ định 2 KTV mà KTV được chỉ định chưa có lời mời nào (đang bận,
-- tour chờ họ rảnh): giữ sẵn phần % của họ để người làm cùng không lấy hết.
create or replace function public._reserved_share(p_tour_id uuid)
returns integer
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select least(t.requested_share_percent, 99)
    from public.tours t
    where t.id = p_tour_id and t.is_requested and t.team_size > 1
      and t.status in ('waiting', 'offered')
      and not exists (select 1 from public.tour_offers o
                      where o.tour_id = t.id and o.technician_id = t.requested_technician_id)
      and not exists (select 1 from public.tour_assignments a
                      where a.tour_id = t.id and a.technician_id = t.requested_technician_id
                        and a.status <> 'removed')
  ), 0)
$$;

-- KTV có hợp với tour không (kỹ năng + giới tính). null = hợp.
-- KTV khách chỉ định thì theo đúng lựa chọn của khách.
create or replace function public._tech_ineligible_reason(p_tour_id uuid, p_tech uuid)
returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tour public.tours;
  v_missing text[];
begin
  select * into v_tour from public.tours where id = p_tour_id;
  if v_tour.is_requested and p_tech = v_tour.requested_technician_id then
    return null;
  end if;
  v_missing := public._missing_skills(p_tour_id, p_tech);
  if v_missing is not null then
    return 'KTV chưa có kỹ năng: ' || array_to_string(v_missing, ', ');
  end if;
  -- Khách nữ chỉ KTV nữ (trừ tour chỉ gồm dịch vụ không phân biệt giới tính).
  -- Khách nam ưu tiên KTV nam nhưng được chuyển KTV nữ (thuật toán xếp; không chặn).
  if v_tour.customer_gender = 'female'
     and not public._tour_gender_free(p_tour_id)
     and exists (select 1 from public.profiles where id = p_tech and gender = 'male') then
    return 'Khách nữ chỉ phân cho KTV nữ (trừ tour chỉ gồm dịch vụ không phân biệt giới tính)';
  end if;
  return null;
end $$;

revoke execute on function public._reserved_share(uuid) from public, anon, authenticated;
revoke execute on function public._tech_ineligible_reason(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Gửi lời mời: chừa chỗ cho người thứ 2, giữ phần của KTV chỉ định
-- -----------------------------------------------------------------------------

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
  v_reserved integer;
  v_slots integer;
  v_max integer;
  v_reason text;
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

  -- Phần % còn trống, trừ phần giữ cho KTV khách chỉ định đang bận
  v_reserved := case when v_tour.is_requested and p_tech = v_tour.requested_technician_id then 0
                     else public._reserved_share(p_tour_id) end;
  v_open := public._open_share(p_tour_id) - v_reserved;
  -- Số chỗ còn trống (tính cả chỗ của KTV đang được mời này)
  v_slots := v_tour.team_size
    - (select count(*) from public.tour_assignments where tour_id = p_tour_id and status <> 'removed')::integer
    - (select count(*) from public.tour_offers where tour_id = p_tour_id and status = 'pending')::integer
    - case when v_reserved > 0 then 1 else 0 end;
  if v_open <= 0 or v_slots <= 0 then
    raise exception 'Tour % đã đủ người', v_tour.code;
  end if;
  -- Còn chỗ cho người khác → chừa lại ít nhất 1% mỗi chỗ (không thì tour kẹt mãi
  -- vì 1 người đã lấy 100% mà tour vẫn chờ đủ 2 KTV)
  v_max := v_open - (v_slots - 1);
  v_share := case when v_tour.team_size = 1 then 100
                  else coalesce(p_share, case when v_slots > 1 then v_open / v_slots else v_open end) end;
  if v_share > v_max or v_share < 1 then
    raise exception '%', format('Tỷ lệ chia không hợp lệ (tối đa %s%%)', v_max);
  end if;

  -- Kỹ năng + giới tính (KTV khách chỉ định thì theo lựa chọn của khách)
  v_reason := public._tech_ineligible_reason(p_tour_id, p_tech);
  if v_reason is not null then
    raise exception '%', v_reason;
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

-- -----------------------------------------------------------------------------
-- Tạo tour: lưu sẵn tỷ lệ của KTV chỉ định (tour 2 KTV)
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
  v_req_share integer := 100;
  v_share integer;
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
  -- Tour chỉ định 2 KTV: phần % của KTV chỉ định (để giữ chỗ khi họ đang bận)
  if v_mode = 'requested' and v_team = 2 then
    select nullif((o ->> 'share_percent')::integer, 100) into v_req_share
    from jsonb_array_elements(v_offers) o
    where (o ->> 'technician_id')::uuid = v_req_tech limit 1;
    v_req_share := least(greatest(coalesce(v_req_share, 50), 1), 99);
  end if;

  insert into public.tours (
    code, customer_name, customer_phone, customer_gender, allow_any_gender, note, is_requested, requested_technician_id,
    team_size, assign_mode, created_by, requested_share_percent
  ) values (
    public._next_tour_code(), v_name, v_phone, v_gender, v_any_gender, v_note, v_mode = 'requested', v_req_tech,
    v_team, v_mode, auth.uid(), v_req_share
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
    v_share := (v_offer ->> 'share_percent')::integer;
    -- tour 2 KTV mà mới mời 1 người: không cho lấy 100% (tự chia phần còn lại)
    if v_team = 2 and jsonb_array_length(v_offers) = 1 and coalesce(v_share, 100) >= 100 then
      v_share := case when (v_offer ->> 'technician_id')::uuid = v_req_tech then v_req_share end;
    end if;
    v_results := v_results || public._offer_internal(
      v_tour.id,
      (v_offer ->> 'technician_id')::uuid,
      case when v_team = 1 then 100 else v_share end,
      auth.uid(),
      true
    );
  end loop;

  -- Khách chỉ định mà form không gửi kèm offer → tự gửi cho KTV được chỉ định
  if v_mode = 'requested' and not v_requested_in_offers then
    v_results := v_results || public._offer_internal(
      v_tour.id, v_req_tech, case when v_team = 1 then 100 else v_req_share end, auth.uid(), true);
  end if;

  return jsonb_build_object('id', v_tour.id, 'code', v_tour.code, 'offers', v_results);
end $$;

-- -----------------------------------------------------------------------------
-- KTV rảnh → tự gửi tour chỉ định đang chờ mình
-- -----------------------------------------------------------------------------

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
    -- đã từ chối / hết giờ / quản lý rút lời mời thì để admin quyết, không tự gửi lại
    and not exists (select 1 from public.tour_offers o
                    where o.tour_id = t.id and o.technician_id = p_tech
                      and o.status in ('pending', 'declined', 'expired', 'accepted', 'withdrawn'))
    -- còn chỗ (tour đầu tiên đã đủ người thì xét tour kế tiếp)
    and public._open_share(t.id) > 0
    and (select count(*) from public.tour_assignments a2 where a2.tour_id = t.id and a2.status <> 'removed')
      + (select count(*) from public.tour_offers o2 where o2.tour_id = t.id and o2.status = 'pending')
      < t.team_size
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

-- pg_cron mỗi phút: tour chỉ định đang chờ mà KTV đó đã rảnh (phòng khi lỡ sự kiện)
create or replace function public.dispatch_requested_waiting()
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tech uuid;
  v_count integer := 0;
begin
  for v_tech in
    select distinct t.requested_technician_id
    from public.tours t
    where t.status in ('waiting', 'offered') and t.is_requested
      and not exists (select 1 from public.tour_offers o
                      where o.tour_id = t.id and o.technician_id = t.requested_technician_id)
      and not exists (select 1 from public.tour_assignments a
                      where a.tour_id = t.id and a.technician_id = t.requested_technician_id
                        and a.status <> 'removed')
      and public._tech_busy_reason(t.requested_technician_id) is null
  loop
    perform public._dispatch_requested_for(v_tech);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

revoke execute on function public.dispatch_requested_waiting() from public, anon, authenticated;
select cron.schedule('dispatch-requested', '* * * * *', $$select public.dispatch_requested_waiting()$$);

-- -----------------------------------------------------------------------------
-- Khoá tour trước rồi mới tới offer (cùng thứ tự với huỷ / sửa tour → không deadlock)
-- -----------------------------------------------------------------------------

create or replace function public.withdraw_offer(p_offer_id uuid, p_reason text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_offer public.tour_offers;
begin
  perform public._require_staff();
  select * into v_offer from public.tour_offers where id = p_offer_id;
  if not found then
    raise exception 'Lời mời không còn ở trạng thái chờ';
  end if;
  perform 1 from public.tours where id = v_offer.tour_id for update;
  select * into v_offer from public.tour_offers where id = p_offer_id for update;
  if v_offer.status <> 'pending' then
    raise exception 'Lời mời không còn ở trạng thái chờ';
  end if;
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
  v_reason text;
  v_freed uuid[];
  v_tech uuid;
begin
  perform public._require_technician();

  select * into v_offer from public.tour_offers where id = p_offer_id;
  if not found or v_offer.technician_id <> v_uid then
    raise exception 'Không tìm thấy lời mời';
  end if;
  -- Khoá tour rồi tới offer (cùng thứ tự với huỷ / sửa tour); khoá offer để 2 lần
  -- bấm liên tiếp không tạo 2 assignment
  select * into v_tour from public.tours where id = v_offer.tour_id for update;
  select * into v_offer from public.tour_offers where id = p_offer_id for update;
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

  if v_tour.status not in ('waiting', 'offered') then
    update public.tour_offers set status = 'withdrawn', responded_at = now() where id = p_offer_id;
    perform public._dispatch_requested_for(v_uid);
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
    perform public._dispatch_requested_for(v_uid);
    return jsonb_build_object('ok', false, 'error', 'Tour đã đủ người');
  end if;

  -- Tour vừa được sửa (dịch vụ / giới tính) hoặc KTV vừa bị bỏ kỹ năng
  v_reason := public._tech_ineligible_reason(v_tour.id, v_uid);
  if v_reason is not null then
    return jsonb_build_object('ok', false, 'error', v_reason || ' – báo quản lý để đổi người');
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
    select array_agg(technician_id) into v_freed from public.tour_offers
    where tour_id = v_tour.id and status = 'pending';
    update public.tour_offers set status = 'withdrawn', responded_at = now()
    where tour_id = v_tour.id and status = 'pending';
    update public.admin_alerts set resolved_at = now()
    where tour_id = v_tour.id and resolved_at is null;
    perform public._recompute_tour_earnings(v_tour.id);
    v_started := true;
  end if;

  foreach v_tech in array coalesce(v_freed, '{}') loop
    perform public._dispatch_requested_for(v_tech);
  end loop;

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
  select * into v_offer from public.tour_offers where id = p_offer_id;
  if not found or v_offer.technician_id <> auth.uid() then
    raise exception 'Không tìm thấy lời mời';
  end if;
  perform 1 from public.tours where id = v_offer.tour_id for update;
  select * into v_offer from public.tour_offers where id = p_offer_id for update;
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

create or replace function public.expire_offer(p_offer_id uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_offer public.tour_offers;
begin
  select * into v_offer from public.tour_offers where id = p_offer_id;
  if not found or not (v_offer.technician_id = auth.uid() or public.is_staff()) then
    return false;
  end if;
  perform 1 from public.tours where id = v_offer.tour_id for update;
  select * into v_offer from public.tour_offers where id = p_offer_id for update;
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
  loop
    -- tour / offer đang được thao tác thì để lượt sau (20 giây)
    perform 1 from public.tours where id = v_offer.tour_id for update skip locked;
    if not found then
      continue;
    end if;
    perform 1 from public.tour_offers
    where id = v_offer.id and status = 'pending' and expires_at <= now()
    for update skip locked;
    if not found then
      continue;
    end if;
    update public.tour_offers set status = 'expired', responded_at = now() where id = v_offer.id;
    perform public._log(v_offer.tour_id, 'expire', null,
      jsonb_build_object('offer_id', v_offer.id, 'technician_id', v_offer.technician_id), null);
    perform public._after_offer_failed(v_offer.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- -----------------------------------------------------------------------------
-- Huỷ tour: KTV bị rút lời mời cũng được xét tour chỉ định đang chờ
-- -----------------------------------------------------------------------------

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
  v_offered uuid[];
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

  select array_agg(technician_id) into v_offered from public.tour_offers
  where tour_id = p_tour_id and status = 'pending';
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

  foreach v_tech in array coalesce(v_freed, '{}') || coalesce(v_offered, '{}') loop
    perform public._dispatch_requested_for(v_tech);
  end loop;
  perform public._kick_dispatch_if_waiting();
end $$;

-- -----------------------------------------------------------------------------
-- Sửa tour: tỷ lệ luôn = 100%, giữ luật kỹ năng / giới tính, nhắc quá giờ theo thời lượng mới
-- -----------------------------------------------------------------------------

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
  v_distinct integer;
  v_name text;
  v_why text;
  v_o record;
  v_withdrawn uuid[] := '{}';
  v_tech uuid;
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
    -- thời lượng đổi → nhắc quá giờ tính lại theo thời lượng mới
    update public.tours set overdue_notified_at = null where id = p_tour_id;
    update public.admin_alerts set resolved_at = now(), resolved_by = auth.uid()
    where tour_id = p_tour_id and kind = 'tour_overdue' and resolved_at is null;
  end if;

  -- Tỷ lệ chia: phải liệt kê đủ mọi KTV của tour, tổng = 100
  if p ? 'shares' then
    if exists (select 1 from public.tour_offers where tour_id = p_tour_id and status = 'pending') then
      raise exception 'Tour đang chờ KTV phản hồi lời mời – đợi phản hồi xong rồi mới sửa tỷ lệ';
    end if;
    if (select count(*) from public.tour_assignments where tour_id = p_tour_id and status <> 'removed')
       < v_tour.team_size and v_tour.status in ('waiting', 'offered') then
      raise exception 'Tour chưa đủ KTV – chờ đủ người rồi mới sửa tỷ lệ';
    end if;
    select coalesce(sum((s ->> 'share_percent')::integer), 0), count(*), count(distinct s ->> 'technician_id')
      into v_sum, v_count, v_distinct
    from jsonb_array_elements(p -> 'shares') s;
    if v_distinct <> v_count then
      raise exception 'Mỗi KTV chỉ nhập tỷ lệ 1 lần';
    end if;
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
    if (select coalesce(sum(share_percent), 0) from public.tour_assignments
        where tour_id = p_tour_id and status <> 'removed') <> 100 then
      raise exception 'Tổng tỷ lệ chia phải bằng 100%%';
    end if;
  end if;

  -- Đổi giới tính khách / dịch vụ khi tour còn chờ người: KTV đã nhận phải còn phù
  -- hợp; lời mời đang chờ không còn phù hợp thì rút lại.
  -- (Tour đang làm / đã xong là sửa cho đúng thực tế → không chặn.)
  if v_tour.status in ('waiting', 'offered')
     and (p ? 'customer_gender' or p ? 'service_ids' or p ? 'allow_any_gender') then
    select pr.full_name, public._tech_ineligible_reason(p_tour_id, a.technician_id)
      into v_name, v_why
    from public.tour_assignments a join public.profiles pr on pr.id = a.technician_id
    where a.tour_id = p_tour_id and a.status <> 'removed'
      and public._tech_ineligible_reason(p_tour_id, a.technician_id) is not null
    limit 1;
    if v_name is not null then
      raise exception '%', format('%s không còn phù hợp với tour sau khi sửa (%s) – hãy đổi KTV trước', v_name, v_why);
    end if;
    for v_o in
      select o.id, o.technician_id from public.tour_offers o
      where o.tour_id = p_tour_id and o.status = 'pending'
        and public._tech_ineligible_reason(p_tour_id, o.technician_id) is not null
    loop
      update public.tour_offers set status = 'withdrawn', responded_at = now() where id = v_o.id;
      perform public._log(p_tour_id, 'withdraw', null,
        jsonb_build_object('offer_id', v_o.id, 'technician_id', v_o.technician_id),
        'Tour đã sửa – KTV không còn phù hợp');
      v_withdrawn := v_withdrawn || v_o.technician_id;
    end loop;
    if cardinality(v_withdrawn) > 0 then
      update public.tours t set status = 'waiting'
      where t.id = p_tour_id and t.status = 'offered'
        and not exists (select 1 from public.tour_offers o where o.tour_id = t.id and o.status = 'pending')
        and not exists (select 1 from public.tour_assignments a
                        where a.tour_id = t.id and a.status in ('accepted', 'working'));
    end if;
  end if;

  perform public._recompute_tour_earnings(p_tour_id);
  perform public._log(p_tour_id, 'edit', v_before, public._tour_json(p_tour_id), v_reason);

  if cardinality(v_withdrawn) > 0 then
    foreach v_tech in array v_withdrawn loop
      perform public._dispatch_requested_for(v_tech);
    end loop;
    perform public._kick_dispatch_if_waiting();
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Đổi KTV: khoá tour trước; người mới phải đúng kỹ năng / giới tính
-- -----------------------------------------------------------------------------

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
  v_why text;
begin
  perform public._require_staff();
  select * into v_old from public.tour_assignments where id = p_assignment_id;
  if not found then
    raise exception 'Không tìm thấy KTV của tour';
  end if;
  -- khoá tour rồi mới tới KTV của tour (cùng thứ tự với hoàn thành / huỷ tour)
  select * into v_tour from public.tours where id = v_old.tour_id for update;
  select * into v_old from public.tour_assignments where id = p_assignment_id for update;
  if v_old.status = 'removed' then
    raise exception 'Không tìm thấy KTV của tour';
  end if;
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
  -- Tour chưa xong: cùng luật kỹ năng / giới tính như khi gửi lời mời.
  -- Tour đã hoàn thành chỉ là sửa lại cho đúng người đã làm → không chặn.
  if v_tour.status <> 'completed' then
    v_why := public._tech_ineligible_reason(v_tour.id, p_new_technician_id);
    if v_why is not null then
      raise exception '%', v_why;
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
-- Vào ca lại trong ngày: cộng dồn phút đã làm, không tính khoảng nghỉ
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
  insert into public.shift_checkins as sc (technician_id, work_date, shift)
  values (p_tech, public.vn_today(), p_shift)
  on conflict (technician_id, work_date)
  do update set
    worked_minutes_before = sc.worked_minutes_before + case when sc.check_out_at is null then 0
      else greatest(0, floor(extract(epoch from (sc.check_out_at - sc.check_in_at)) / 60))::integer end,
    check_in_at = case when sc.check_out_at is null then sc.check_in_at else now() end,
    check_out_at = null,
    shift = excluded.shift;

  perform public._dispatch_requested_for(p_tech);
  perform public._kick_dispatch_if_waiting();
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
      select sum(c2.worked_minutes_before + extract(epoch from (coalesce(c2.check_out_at, now()) - c2.check_in_at)) / 60)
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

-- -----------------------------------------------------------------------------
-- Dashboard: thêm giờ có mặt để biểu đồ cân bằng đánh giá giống thuật toán
-- -----------------------------------------------------------------------------

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
        'monthRequestedMinutes', coalesce(e.month_requested_minutes, 0),
        'monthWorkedMinutes', coalesce((
          select sum(c2.worked_minutes_before + extract(epoch from (coalesce(c2.check_out_at, now()) - c2.check_in_at)) / 60)
          from public.shift_checkins c2
          where c2.technician_id = p.id
            and c2.work_date >= public.pay_period_from(public.pay_period_of_date(v_today))), 0),
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
          sum(extract(epoch from (coalesce(a.completed_at, t.completed_at) - t.started_at)) / 60)
            filter (where t.is_requested and t.requested_technician_id = a.technician_id) as month_requested_minutes,
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

-- -----------------------------------------------------------------------------
-- Chốt sổ: chỉ kỳ đã kết thúc (chốt kỳ đang chạy làm KTV không bấm Hoàn thành được)
-- -----------------------------------------------------------------------------

create or replace function public.lock_month(p_month date)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
begin
  perform public._require_owner();
  if v_month >= public.pay_period_of_date(public.vn_today()) then
    raise exception '%', format('Chỉ chốt sổ được kỳ lương đã kết thúc – kỳ này hết ngày %s, chốt sổ được từ ngày %s',
      to_char(public.pay_period_to(v_month), 'DD/MM'), to_char(public.pay_period_to(v_month) + 1, 'DD/MM'));
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

-- -----------------------------------------------------------------------------
-- Bảo mật
-- -----------------------------------------------------------------------------

create or replace function public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if public.auth_role() is null then
    raise exception 'Bạn cần đăng nhập' using errcode = '42501';
  end if;
  -- chỉ chấp nhận máy chủ push của trình duyệt (Chrome/Edge/Firefox/Safari)
  if coalesce(p_endpoint, '') !~ ('^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|'
                                   || '[a-z0-9.-]+\.notify\.windows\.com|([a-z0-9-]+\.)?push\.apple\.com)/')
     or length(p_endpoint) > 1000
     or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Thông tin đăng ký thông báo không hợp lệ';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
end $$;

-- Thiết bị chỉ đăng ký qua register_push_subscription (đã kiểm tra địa chỉ)
drop policy push_insert on public.push_subscriptions;
drop policy push_update on public.push_subscriptions;

create or replace function public.set_avatar(p_user_id uuid, p_avatar_url text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not ((p_user_id = auth.uid() and public.auth_role() is not null) or public.is_owner()) then
    raise exception 'Bạn không có quyền đổi ảnh của tài khoản này' using errcode = '42501';
  end if;
  -- chỉ chấp nhận ảnh nằm trong thư mục của đúng người đó trên Storage của project
  if p_avatar_url is not null
     and p_avatar_url !~ ('^https://vjdzgeaowzhencuespdx\.supabase\.co/storage/v1/object/public/avatars/'
                          || p_user_id::text || '/[A-Za-z0-9._-]+$') then
    raise exception 'Ảnh không hợp lệ';
  end if;
  update public.profiles set avatar_url = p_avatar_url where id = p_user_id;
  if not found then
    raise exception 'Không tìm thấy tài khoản';
  end if;
end $$;

-- Ảnh đại diện: chỉ tài khoản nhân viên đang hoạt động
alter policy avatars_select on storage.objects
  using (bucket_id = 'avatars' and public.auth_role() is not null
         and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_owner()));
alter policy avatars_insert on storage.objects
  with check (bucket_id = 'avatars' and public.auth_role() is not null
              and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_owner()));
alter policy avatars_update on storage.objects
  using (bucket_id = 'avatars' and public.auth_role() is not null
         and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_owner()))
  with check (bucket_id = 'avatars' and public.auth_role() is not null
              and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_owner()));
alter policy avatars_delete on storage.objects
  using (bucket_id = 'avatars' and public.auth_role() is not null
         and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_owner()));

-- SĐT khách: không cho đọc trực tiếp qua API (KTV từng được mời cũng đọc được
-- dòng tour). Quản lý xem SĐT qua dashboard_snapshot / get_tour.
do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'tours' and column_name <> 'customer_phone';
  execute 'revoke select on public.tours from anon, authenticated';
  execute format('grant select (%s) on public.tours to authenticated', v_cols);
end $$;

-- Hàm mới tạo sau này không tự cấp quyền cho khách chưa đăng nhập
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;

-- RLS: gọi auth.uid() 1 lần mỗi truy vấn thay vì mỗi dòng (Supabase advisor)
alter policy profiles_select on public.profiles using (id = (select auth.uid()) or public.is_staff());
alter policy skills_select on public.technician_skills using (technician_id = (select auth.uid()) or public.is_staff());
alter policy schedules_select on public.shift_schedules using (technician_id = (select auth.uid()) or public.is_staff());
alter policy checkins_select on public.shift_checkins using (technician_id = (select auth.uid()) or public.is_staff());
alter policy assignments_select on public.tour_assignments using (technician_id = (select auth.uid()) or public.is_staff());
alter policy offers_select on public.tour_offers using (technician_id = (select auth.uid()) or public.is_staff());
alter policy recipients_select on public.announcement_recipients
  using (technician_id = (select auth.uid()) or public.is_staff());
alter policy announcements_select on public.announcements
  using (public.is_staff() or exists (select 1 from public.announcement_recipients r
                                      where r.announcement_id = announcements.id
                                        and r.technician_id = (select auth.uid())));
alter policy push_select on public.push_subscriptions using (user_id = (select auth.uid()));
alter policy push_delete on public.push_subscriptions using (user_id = (select auth.uid()));
alter policy disputes_select on public.earning_disputes using (technician_id = (select auth.uid()) or public.is_staff());
