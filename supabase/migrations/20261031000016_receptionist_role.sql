-- Vai trò Lễ tân (dùng ở migration kế tiếp – giá trị enum mới phải commit trước khi dùng)
alter type public.user_role add value if not exists 'receptionist';
