-- =============================================================================
-- Vai trò Lễ tân: chỉ dùng Bảng điều phối (tạo / phân / sửa / huỷ / hoàn thành tour,
-- vào ca hộ KTV). Không xem chốt lương, bảng giá, KTV, lịch ca, thông báo, nhật ký,
-- cài đặt; không thấy số tiền (tiền tour, thu nhập KTV) trên bảng điều phối.
-- =============================================================================

-- Người được điều phối tour: chủ spa, quản lý, lễ tân
create or replace function public.is_dispatcher()
returns boolean
language sql stable security definer
set search_path = ''
as $$ select coalesce(public.auth_role() in ('owner', 'manager', 'receptionist'), false) $$;

create or replace function public._require_dispatcher()
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_dispatcher() then
    raise exception 'Bạn không có quyền thực hiện thao tác này' using errcode = '42501';
  end if;
end $$;

-- Lễ tân không thấy số tiền: đưa các trường tiền của 1 tour (dạng JSON của
-- dashboard / get_tour) về 0
create or replace function public._mask_tour_money(p jsonb)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case
    when p is null or public.auth_role() is distinct from 'receptionist' then p
    else p || jsonb_build_object(
      'totalFee', 0,
      'items', coalesce((select jsonb_agg(i || '{"fee": 0}'::jsonb order by n)
                         from jsonb_array_elements(p -> 'items') with ordinality x(i, n)), '[]'::jsonb),
      'members', coalesce((select jsonb_agg(m || '{"amount": 0}'::jsonb order by n)
                           from jsonb_array_elements(p -> 'members') with ordinality x(m, n)), '[]'::jsonb))
  end
$$;

create or replace function public._mask_dashboard_money(p jsonb)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case
    when public.auth_role() is distinct from 'receptionist' then p
    else p || jsonb_build_object(
      'technicians', coalesce((
        select jsonb_agg(t || '{"todayAmount": 0, "monthAmount": 0, "monthRequestedAmount": 0, "todayRequestedAmount": 0}'::jsonb
                         order by n)
        from jsonb_array_elements(p -> 'technicians') with ordinality x(t, n)), '[]'::jsonb),
      'tours', coalesce((
        select jsonb_agg(public._mask_tour_money(t) order by n)
        from jsonb_array_elements(p -> 'tours') with ordinality x(t, n)), '[]'::jsonb))
  end
$$;

grant execute on function public.is_dispatcher() to authenticated;
revoke execute on function public.is_dispatcher() from public, anon;
revoke execute on function public._require_dispatcher() from public, anon, authenticated;
revoke execute on function public._mask_tour_money(jsonb) from public, anon, authenticated;
revoke execute on function public._mask_dashboard_money(jsonb) from public, anon, authenticated;

-- Các thao tác trên Bảng điều phối: cho cả lễ tân

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
  perform public._require_dispatcher();

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

create or replace function public.send_offer(p_tour_id uuid, p_technician_id uuid, p_share_percent integer default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform public._require_dispatcher();
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
  perform public._require_dispatcher();
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
  perform public._require_dispatcher();
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
  perform public._require_dispatcher();
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
  perform public._require_dispatcher();
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

create or replace function public.resolve_alert(p_alert_id bigint)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public._require_dispatcher();
  update public.admin_alerts set resolved_at = now(), resolved_by = auth.uid()
  where id = p_alert_id and resolved_at is null;
end $$;

create or replace function public.admin_check_in(p_technician_id uuid, p_shift public.shift_type)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public._require_dispatcher();
  perform public._do_check_in(p_technician_id, p_shift);
end $$;

create or replace function public.admin_check_out(p_technician_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public._require_dispatcher();
  perform public._do_check_out(p_technician_id);
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
  if not found or not (v_offer.technician_id = auth.uid() or public.is_dispatcher()) then
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
  if not (public.is_dispatcher() or public.is_service_role()) then
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
  perform public._require_dispatcher();
  select * into v_settings from public.app_settings where id;

  return public._mask_dashboard_money(jsonb_build_object(
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
  ));
end $$;

create or replace function public.get_tour(p_tour_id uuid default null, p_code text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public._require_dispatcher();
  select t.id into v_id from public.tours t
  where (p_tour_id is not null and t.id = p_tour_id)
     or (p_tour_id is null and upper(t.code) = upper(btrim(coalesce(p_code, ''))));
  if v_id is null then
    return null;
  end if;
  return public._mask_tour_money((
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
  ));
end $$;

-- Realtime + đọc trực tiếp cho Bảng điều phối của lễ tân (SĐT khách vẫn bị chặn theo cột)
alter policy tours_select on public.tours using (public.is_dispatcher() or public.is_tour_member(id));
alter policy tour_items_select on public.tour_items using (public.is_dispatcher() or public.is_tour_member(tour_id));
alter policy offers_select on public.tour_offers using (technician_id = (select auth.uid()) or public.is_dispatcher());
alter policy assignments_select on public.tour_assignments
  using (technician_id = (select auth.uid()) or public.is_dispatcher());
alter policy checkins_select on public.shift_checkins using (technician_id = (select auth.uid()) or public.is_dispatcher());
alter policy alerts_select on public.admin_alerts using (public.is_dispatcher());
