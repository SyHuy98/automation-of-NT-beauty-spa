-- =============================================================================
-- DỮ LIỆU DEMO – CHỈ DÙNG CHO MÔI TRƯỜNG DEV LOCAL (`supabase db reset`).
-- KHÔNG chạy trên production. Giá dưới đây là giá giả để thử nghiệm,
-- chủ spa tự nhập bảng giá thật trong app.
-- Tài khoản demo (mật khẩu đều là: demo123):
--   chu.spa (owner), le.tan (manager), lan, mai, hoa, cuc, dao, thu (KTV)
-- =============================================================================

insert into private.config (key, value) values
  ('functions_url', 'http://host.docker.internal:54321/functions/v1')
on conflict (key) do update set value = excluded.value;

do $$
declare
  r record;
  v_id uuid;
begin
  for r in
    select * from (values
      ('chu.spa', 'Chủ Spa Demo', 'owner', 'full'),
      ('le.tan', 'Lễ Tân Demo', 'manager', 'full'),
      ('lan', 'Nguyễn Thị Lan', 'technician', 'morning'),
      ('mai', 'Trần Thị Mai', 'technician', 'morning'),
      ('hoa', 'Lê Thị Hoa', 'technician', 'afternoon'),
      ('cuc', 'Phạm Thị Cúc', 'technician', 'afternoon'),
      ('dao', 'Võ Thị Đào', 'technician', 'full'),
      ('thu', 'Đặng Thị Thu', 'technician', 'morning')
    ) as t(username, full_name, role, shift)
  loop
    v_id := gen_random_uuid();
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      r.username || '@ntspa.local', extensions.crypt('demo123', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', r.full_name),
      now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
    values (gen_random_uuid(), v_id, v_id::text,
            jsonb_build_object('sub', v_id::text, 'email', r.username || '@ntspa.local', 'email_verified', true),
            'email', now(), now(), now());
    insert into public.profiles (id, full_name, username, role, shift)
    values (v_id, r.full_name, r.username, r.role::public.user_role, r.shift::public.shift_type);
  end loop;
end $$;

insert into public.services (name, tour_fee, duration_minutes, requires_skill, sort_order) values
  ('[Demo] Triệt lông nách Diode Laser', 40000, 30, false, 1),
  ('[Demo] Triệt lông chân Diode Laser', 80000, 60, false, 2),
  ('[Demo] Trị thâm nách', 60000, 45, false, 3),
  ('[Demo] Bio Peel vùng kín', 70000, 45, false, 4),
  ('[Demo] Trị mụn lưng', 90000, 75, false, 5),
  ('[Demo] HIFU nâng cơ', 150000, 90, true, 6),
  ('[Demo] Tiêm dưỡng chất', 120000, 30, true, 7);

-- KTV Lan, Đào có kỹ năng HIFU + tiêm
insert into public.technician_skills (technician_id, service_id)
select p.id, s.id from public.profiles p cross join public.services s
where p.username in ('lan', 'dao') and s.requires_skill;
