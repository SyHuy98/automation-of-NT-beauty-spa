-- =============================================================================
-- Bổ sung: đăng ký push theo thiết bị, tra cứu tour cũ (sửa sau khi có báo sai),
-- tự ghi người xếp lịch ca.
-- =============================================================================

-- Một thiết bị (endpoint) chỉ thuộc 1 tài khoản: thiết bị dùng chung đăng nhập
-- tài khoản khác thì chuyển đăng ký sang tài khoản mới.
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
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Thông tin đăng ký thông báo không hợp lệ';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
end $$;

-- Chi tiết 1 tour (cùng cấu trúc với phần tử `tours` của dashboard_snapshot)
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

-- Lịch ca: tự ghi người xếp
create or replace function public._schedule_set_updated_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

create trigger shift_schedules_updated_by before insert or update on public.shift_schedules
  for each row execute function public._schedule_set_updated_by();

-- Rà lại quyền EXECUTE cho function mới
revoke execute on all functions in schema public from public, anon;
revoke execute on function public._schedule_set_updated_by() from authenticated;
