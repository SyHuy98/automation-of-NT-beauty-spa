-- Kiểm thử nhanh luồng nghiệp vụ trên DB thật mà KHÔNG để lại dữ liệu:
-- toàn bộ chạy trong 1 khối DO và kết thúc bằng RAISE EXCEPTION để rollback.
-- Kết quả nằm trong thông báo lỗi cuối cùng ("SMOKE OK ..." hoặc chỗ sai).
-- Chạy: dán vào SQL editor của Supabase (hoặc MCP execute_sql).
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
  v_s1 uuid;
  v_s2 uuid;
  v_res jsonb;
  v_tour uuid;
  v_offer uuid;
  v_offer2 uuid;
  v_log text := '';
  v_n integer;
  v_ok boolean;
begin
  -- dữ liệu giả
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u || '@smoke.local',
         '{}'::jsonb, '{}'::jsonb, now(), now()
  from (values (v_owner, 'smoke_owner'), (v_a, 'smoke_a'), (v_b, 'smoke_b'), (v_c, 'smoke_c')) x(id, u);
  insert into public.profiles (id, full_name, username, role, shift) values
    (v_owner, 'Smoke Owner', 'smoke_owner', 'owner', 'full'),
    (v_a, 'KTV A', 'smoke_a', 'technician', 'morning'),
    (v_b, 'KTV B', 'smoke_b', 'technician', 'morning'),
    (v_c, 'KTV C', 'smoke_c', 'technician', 'afternoon');
  insert into public.services (name, tour_fee, duration_minutes) values ('Smoke triệt lông', 100001, 60) returning id into v_s1;
  insert into public.services (name, tour_fee, duration_minutes, requires_skill) values ('Smoke HIFU', 300000, 90, true) returning id into v_s2;
  insert into public.technician_skills values (v_a, v_s2, now());

  -- A, B vào ca
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform public.check_in('morning');
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform public.check_in('morning');

  -- Owner: snapshot + tạo tour gợi ý gửi A
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_res := public.assignment_snapshot(array[v_s1, v_s2]);
  v_log := v_log || format('snapshot: %s techs free=%s; ', jsonb_array_length(v_res -> 'technicians'),
    (select count(*) from jsonb_array_elements(v_res -> 'technicians') t where (t ->> 'isFree')::boolean));

  v_res := public.create_tour(jsonb_build_object('customer_name', 'Khách 1', 'service_ids', jsonb_build_array(v_s1, v_s2),
    'assign_mode', 'suggest', 'offers', jsonb_build_array(jsonb_build_object('technician_id', v_a))));
  v_tour := (v_res ->> 'id')::uuid;
  v_offer := (v_res -> 'offers' -> 0 ->> 'offer_id')::uuid;
  v_log := v_log || format('tour %s offer=%s; ', v_res ->> 'code', v_offer is not null);

  -- B không có kỹ năng HIFU → không gửi được
  begin
    perform public.send_offer(v_tour, v_b);
    v_log := v_log || 'LỖI: gửi được cho B thiếu kỹ năng; ';
  exception when others then
    v_log := v_log || 'skill-check ok; ';
  end;

  -- B không nhận được offer của A
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  begin
    perform public.accept_offer(v_offer);
    v_log := v_log || 'LỖI: B nhận offer của A; ';
  exception when others then
    v_log := v_log || 'cross-accept blocked; ';
  end;

  -- A nhận → in_progress; A ra ca vẫn được; A hoàn thành → completed
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  v_res := public.accept_offer(v_offer);
  v_log := v_log || format('accept=%s started=%s status=%s; ', v_res ->> 'ok', v_res ->> 'started',
    (select status from public.tours where id = v_tour));
  v_res := public.my_snapshot();
  v_log := v_log || format('my_snapshot work=%s; ', v_res -> 'work' -> 'tour' ->> 'code');
  v_res := public.complete_tour(v_tour);
  v_log := v_log || format('complete=%s amountA=%s; ', v_res ->> 'tour_completed',
    (select earned_amount from public.tour_assignments where tour_id = v_tour and technician_id = v_a));

  -- Tour 2 KTV 60/40, tổng 100.001 → 60.001 / 40.000
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_res := public.create_tour(jsonb_build_object('customer_name', 'Khách 2', 'service_ids', jsonb_build_array(v_s1),
    'assign_mode', 'suggest', 'team_size', 2, 'offers', jsonb_build_array(
      jsonb_build_object('technician_id', v_a, 'share_percent', 60),
      jsonb_build_object('technician_id', v_b, 'share_percent', 40))));
  v_tour := (v_res ->> 'id')::uuid;
  v_offer := (v_res -> 'offers' -> 0 ->> 'offer_id')::uuid;
  v_offer2 := (v_res -> 'offers' -> 1 ->> 'offer_id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  v_res := public.accept_offer(v_offer);
  v_log := v_log || format('pair A accept started=%s; ', v_res ->> 'started');
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  v_res := public.accept_offer(v_offer2);
  v_log := v_log || format('pair B accept started=%s; ', v_res ->> 'started');
  v_res := public.complete_tour(v_tour);
  v_log := v_log || format('B done tour_completed=%s; ', v_res ->> 'tour_completed');
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  v_res := public.complete_tour(v_tour);
  v_log := v_log || format('A done tour_completed=%s split=%s; ', v_res ->> 'tour_completed',
    (select string_agg(earned_amount::text, '/' order by share_percent desc) from public.tour_assignments where tour_id = v_tour));

  -- Khách chỉ định C (chưa vào ca) → chờ; C vào ca → tự có offer; C từ chối → báo admin
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_res := public.create_tour(jsonb_build_object('customer_name', 'Khách 3', 'service_ids', jsonb_build_array(v_s1),
    'assign_mode', 'requested', 'requested_technician_id', v_c));
  v_tour := (v_res ->> 'id')::uuid;
  v_log := v_log || format('requested queued=%s; ', v_res -> 'offers' -> 0 ->> 'queued');
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  perform public.check_in('afternoon');
  select id into v_offer from public.tour_offers where tour_id = v_tour and technician_id = v_c and status = 'pending';
  v_log := v_log || format('auto-offer on check-in=%s; ', v_offer is not null);
  perform public.decline_offer(v_offer, 'Sức khỏe');
  v_log := v_log || format('decline → tour=%s alert=%s; ', (select status from public.tours where id = v_tour),
    (select count(*) from public.admin_alerts where tour_id = v_tour and kind = 'requested_failed'));

  -- Hết giờ: offer cho B quá hạn → expire_offers xử lý
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_res := public.create_tour(jsonb_build_object('customer_name', 'Khách 4', 'service_ids', jsonb_build_array(v_s1),
    'assign_mode', 'auto', 'offers', jsonb_build_array(jsonb_build_object('technician_id', v_b))));
  v_tour := (v_res ->> 'id')::uuid;
  update public.tour_offers set expires_at = now() - interval '1 second' where tour_id = v_tour;
  v_n := public.expire_offers();
  v_log := v_log || format('expired=%s tour=%s queued_dispatch=%s; ', v_n, (select status from public.tours where id = v_tour),
    (select count(*) from net.http_request_queue where url like '%/dispatch'));
  v_res := public.assignment_snapshot(array[v_s1], v_tour);
  v_log := v_log || format('B excluded=%s; ', (select t ->> 'excluded' from jsonb_array_elements(v_res -> 'technicians') t where (t ->> 'id')::uuid = v_b));

  -- Huỷ tour cần lý do
  begin
    perform public.cancel_tour(v_tour, '');
    v_log := v_log || 'LỖI: huỷ không lý do; ';
  exception when others then
    v_log := v_log || 'cancel-needs-reason ok; ';
  end;
  perform public.cancel_tour(v_tour, 'Khách đổi ý');

  -- Dashboard + thu nhập + chốt sổ
  v_res := public.dashboard_snapshot();
  v_log := v_log || format('dashboard techs=%s tours=%s alerts=%s; ', jsonb_array_length(v_res -> 'technicians'),
    jsonb_array_length(v_res -> 'tours'), jsonb_array_length(v_res -> 'alerts'));
  v_log := v_log || format('earnings A today=%s; ', public.technician_earnings(v_a, public.vn_today(), public.vn_today()));
  perform public.lock_month(public.vn_today());
  v_ok := public._is_month_locked(date_trunc('month', public.vn_today())::date);
  v_log := v_log || format('locked=%s; ', v_ok);
  begin
    perform public.edit_tour((select id from public.tours where customer_name = 'Khách 2' and code like 'T-%' order by created_at desc limit 1),
      '{"note":"x"}'::jsonb, 'thử sửa');
    v_log := v_log || 'LỖI: sửa được tour tháng đã chốt; ';
  exception when others then
    v_log := v_log || 'lock-blocks-edit ok; ';
  end;
  perform public.unlock_month(public.vn_today(), 'mở lại để test');

  -- Thông báo
  perform public.send_announcement('Họp', 'Họp lúc 9h', null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  v_log := v_log || format('unread A=%s; ', (public.my_snapshot() ->> 'unreadAnnouncements'));
  perform public.mark_announcement_read(null);
  v_log := v_log || format('unread A after=%s; ', (public.my_snapshot() ->> 'unreadAnnouncements'));

  -- KTV không dùng được hàm admin
  begin
    perform public.dashboard_snapshot();
    v_log := v_log || 'LỖI: KTV xem dashboard; ';
  exception when others then
    v_log := v_log || 'tech-no-dashboard ok; ';
  end;

  raise exception 'SMOKE RESULT: %', v_log;
end $$;
