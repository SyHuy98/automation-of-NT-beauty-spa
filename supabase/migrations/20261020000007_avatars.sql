-- =============================================================================
-- Ảnh đại diện: mỗi người tự đổi ảnh của mình; chủ spa đổi được ảnh của mọi người.
-- Ảnh lưu ở Supabase Storage, bucket công khai `avatars`, đường dẫn <user_id>/<tên file>.
-- =============================================================================

alter table public.profiles add column avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Ghi / xoá / liệt kê: chỉ trong thư mục của chính mình (owner được mọi thư mục).
-- Đọc ảnh đi qua URL công khai nên không cần policy SELECT cho người xem.
create policy avatars_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_owner()));
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_owner()));
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_owner()))
  with check (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_owner()));
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_owner()));

-- Lưu link ảnh vào hồ sơ (profiles không cho người dùng update trực tiếp).
-- p_avatar_url = null để xoá ảnh.
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
     and p_avatar_url !~ ('^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/avatars/'
                          || p_user_id::text || '/[A-Za-z0-9._-]+$') then
    raise exception 'Ảnh không hợp lệ';
  end if;
  update public.profiles set avatar_url = p_avatar_url where id = p_user_id;
  if not found then
    raise exception 'Không tìm thấy tài khoản';
  end if;
end $$;

revoke execute on function public.set_avatar(uuid, text) from public, anon;
grant execute on function public.set_avatar(uuid, text) to authenticated;
