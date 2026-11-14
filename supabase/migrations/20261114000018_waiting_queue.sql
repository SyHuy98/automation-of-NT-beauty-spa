-- =============================================================================
-- Hàng chờ khách khi mọi KTV đang bận:
--  * Tour Tự động / Random (kể cả tour 2 KTV) nằm trong hàng chờ, xử lý theo thứ tự
--    đến trước; có KTV rảnh là tự gửi cho người phù hợp nhất (thuật toán công bằng).
--  * Tour khách chỉ định chờ đúng KTV đó (đã có: _dispatch_requested_for + cron).
--  * Tour Gợi ý đang chờ có thể chuyển sang hàng chờ tự động (set_auto_dispatch).
-- =============================================================================

-- Tour cần người: còn chỗ trống (người đã nhận + lời mời đang chờ < số KTV của tour)
create or replace function public._tour_open_slots(p_tour_id uuid)
returns integer
language sql stable security definer
set search_path = ''
as $$
  select t.team_size
    - (select count(*) from public.tour_assignments a where a.tour_id = t.id and a.status <> 'removed')::integer
    - (select count(*) from public.tour_offers o where o.tour_id = t.id and o.status = 'pending')::integer
  from public.tours t where t.id = p_tour_id
$$;
revoke execute on function public._tour_open_slots(uuid) from public, anon, authenticated;

-- Hàng chờ cho Edge Function `dispatch`: tour Tự động / Random còn chỗ, đến trước xử lý trước
create or replace function public.system_dispatch_queue()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public._require_service_role();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'code', t.code, 'assignMode', t.assign_mode, 'teamSize', t.team_size,
      'needed', public._tour_open_slots(t.id),
      'serviceIds', (select jsonb_agg(i.service_id order by i.position)
                     from public.tour_items i where i.tour_id = t.id)
    ) order by t.created_at)
    from public.tours t
    where t.status in ('waiting', 'offered') and t.assign_mode in ('auto', 'random')
      and not t.is_requested
      and public._tour_open_slots(t.id) > 0
  ), '[]'::jsonb);
end $$;

-- Gửi lời mời từ hàng chờ. Tour 2 KTV: không truyền tỷ lệ → server tự chia (50/50
-- hoặc phần còn lại)
drop function public.system_send_offer(uuid, uuid);
create function public.system_send_offer(p_tour_id uuid, p_technician_id uuid, p_share integer default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public._require_service_role();
  return public._offer_internal(p_tour_id, p_technician_id, p_share, null, false);
end $$;
revoke execute on function public.system_send_offer(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.system_send_offer(uuid, uuid, integer) to service_role;

-- Có KTV vừa rảnh mà hàng chờ còn khách → gọi dispatch
create or replace function public._kick_dispatch_if_waiting()
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.tours t
    where t.status in ('waiting', 'offered') and t.assign_mode in ('auto', 'random')
      and not t.is_requested and public._tour_open_slots(t.id) > 0
  ) then
    perform public._kick_dispatch(null);
  end if;
end $$;

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

    if v_tour.assign_mode in ('auto', 'random') and not v_tour.is_requested then
      -- Tự động / Random (cả tour 2 KTV): tự chuyển người kế tiếp
      perform public._kick_dispatch(v_tour.id);
    else
      -- Gợi ý / Chỉ định: báo admin chọn lại
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

-- Tour Gợi ý đang chờ người (vd. lúc mọi KTV đều bận) → đưa vào hàng chờ tự động
create or replace function public.set_auto_dispatch(p_tour_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tour public.tours;
begin
  perform public._require_dispatcher();
  select * into v_tour from public.tours where id = p_tour_id for update;
  if not found then
    raise exception 'Không tìm thấy tour';
  end if;
  if v_tour.status not in ('waiting', 'offered') then
    raise exception 'Tour % không còn chờ phân', v_tour.code;
  end if;
  if v_tour.is_requested then
    raise exception 'Tour khách chỉ định tự chờ đúng KTV được chỉ định';
  end if;
  if v_tour.assign_mode in ('auto', 'random') then
    return;
  end if;
  update public.tours set assign_mode = 'auto' where id = p_tour_id;
  update public.admin_alerts set resolved_at = now(), resolved_by = auth.uid()
  where tour_id = p_tour_id and resolved_at is null;
  perform public._log(p_tour_id, 'edit', jsonb_build_object('assign_mode', v_tour.assign_mode),
    jsonb_build_object('assign_mode', 'auto'), 'Đưa vào hàng chờ tự động');
  perform public._kick_dispatch(p_tour_id);
end $$;
revoke execute on function public.set_auto_dispatch(uuid) from public, anon;
grant execute on function public.set_auto_dispatch(uuid) to authenticated;
