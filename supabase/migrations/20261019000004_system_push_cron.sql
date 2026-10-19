-- =============================================================================
-- Function cho Edge Function (service role), trigger Web Push, lịch pg_cron,
-- và rà lại quyền EXECUTE.
-- =============================================================================

-- Secret nội bộ để DB gọi Edge Function (dispatch, send-push) – sinh ngẫu nhiên,
-- không nằm trong repo. URL Edge Function cấu hình 1 lần sau khi tạo project:
--   insert into private.config (key, value)
--   values ('functions_url', 'https://<project-ref>.supabase.co/functions/v1');
insert into private.config (key, value)
values ('internal_secret', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

create or replace function public._require_service_role()
returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if not public.is_service_role() then
    raise exception 'Chỉ dùng nội bộ' using errcode = '42501';
  end if;
end $$;

-- Cấu hình nội bộ cho Edge Function (secret, khoá VAPID)
create or replace function public.internal_config()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public._require_service_role();
  return (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from private.config);
end $$;

-- Edge Function send-push tự sinh cặp khoá VAPID lần đầu và lưu lại ở đây,
-- nên khoá bí mật không bao giờ phải dán vào repo hay biến môi trường.
create or replace function public.internal_set_config(p_key text, p_value text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public._require_service_role();
  if p_key not in ('vapid_public', 'vapid_private', 'vapid_subject') then
    raise exception 'Khoá cấu hình không hợp lệ';
  end if;
  insert into private.config (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- Khoá công khai VAPID cho trình duyệt đăng ký nhận push
create or replace function public.get_vapid_public_key()
returns text
language sql stable security definer
set search_path = ''
as $$ select value from private.config where key = 'vapid_public' and public.auth_role() is not null $$;

-- Hàng đợi tour Tự động / Random đang chờ người (FIFO)
create or replace function public.system_dispatch_queue()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public._require_service_role();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'code', t.code, 'assignMode', t.assign_mode,
      'serviceIds', (select jsonb_agg(i.service_id order by i.position)
                     from public.tour_items i where i.tour_id = t.id)
    ) order by t.created_at)
    from public.tours t
    where t.status = 'waiting' and t.assign_mode in ('auto', 'random')
      and t.team_size = 1 and not t.is_requested
      and not exists (select 1 from public.tour_offers o where o.tour_id = t.id and o.status = 'pending')
      and not exists (select 1 from public.tour_assignments a
                      where a.tour_id = t.id and a.status <> 'removed')
  ), '[]'::jsonb);
end $$;

create or replace function public.system_send_offer(p_tour_id uuid, p_technician_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public._require_service_role();
  return public._offer_internal(p_tour_id, p_technician_id, 100, null, false);
end $$;

-- Không còn ai phù hợp → báo admin (không báo trùng)
create or replace function public.system_no_candidate(p_tour_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public._require_service_role();
  insert into public.admin_alerts (tour_id, kind, message)
  select t.id, 'no_candidate',
         format('Không còn KTV rảnh phù hợp cho tour %s (%s) – vui lòng phân thủ công hoặc chờ KTV rảnh',
                t.code, t.customer_name)
  from public.tours t
  where t.id = p_tour_id
    and not exists (select 1 from public.admin_alerts a
                    where a.tour_id = t.id and a.kind = 'no_candidate' and a.resolved_at is null);
end $$;

-- Nội dung push + danh sách thiết bị nhận
-- p_kind = 'offer' (p_id = offer id) | 'announcement' (p_id = '<announcement_id>:<technician_id>')
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

create or replace function public.system_remove_push_subscription(p_endpoint text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public._require_service_role();
  delete from public.push_subscriptions where endpoint = p_endpoint;
end $$;

-- Trigger: offer mới / thông báo mới → gọi Edge Function send-push qua pg_net.
-- Nhờ vậy offer do pg_cron / dispatch tạo tự động cũng có push.
create or replace function public._notify_push()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_body jsonb;
begin
  select value into v_url from private.config where key = 'functions_url';
  select value into v_secret from private.config where key = 'internal_secret';
  if v_url is null or v_secret is null then
    return new;
  end if;
  if tg_table_name = 'tour_offers' then
    if new.status <> 'pending' then
      return new;
    end if;
    v_body := jsonb_build_object('kind', 'offer', 'id', new.id);
  else
    v_body := jsonb_build_object('kind', 'announcement', 'id', new.announcement_id || ':' || new.technician_id);
  end if;
  perform net.http_post(
    url := v_url || '/send-push',
    body := v_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
    timeout_milliseconds := 10000
  );
  return new;
end $$;

create trigger tour_offers_push after insert on public.tour_offers
  for each row execute function public._notify_push();
create trigger announcement_recipients_push after insert on public.announcement_recipients
  for each row execute function public._notify_push();

-- -----------------------------------------------------------------------------
-- pg_cron
-- -----------------------------------------------------------------------------
-- Hết hạn offer phía server, không phụ thuộc điện thoại KTV
select cron.schedule('expire-offers', '20 seconds', $$select public.expire_offers()$$);
-- 00:05 giờ VN (17:05 UTC): đóng ca quên bấm "Ra ca"
select cron.schedule('close-stale-checkins', '5 17 * * *', $$select public.close_stale_checkins()$$);
-- Lưới an toàn: nếu lần gọi dispatch trước thất bại, mỗi phút thử lại cho tour Tự động/Random đang chờ
select cron.schedule('dispatch-waiting', '* * * * *', $$select public._kick_dispatch_if_waiting()$$);

-- -----------------------------------------------------------------------------
-- Quyền EXECUTE: anon không gọi được gì; helper nội bộ (_xxx) và function hệ
-- thống chỉ dành cho postgres / service_role.
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like '\_%'
           or p.proname in ('internal_config', 'internal_set_config', 'system_dispatch_queue',
                            'system_send_offer', 'system_no_candidate', 'push_targets',
                            'system_remove_push_subscription', 'expire_offers', 'close_stale_checkins'))
  loop
    execute format('revoke execute on function %s from authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;
