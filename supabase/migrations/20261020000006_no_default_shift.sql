-- =============================================================================
-- Bỏ "ca mặc định" của KTV: ca làm thay đổi theo từng ngày nên chỉ xác định
-- bằng Lịch ca (shift_schedules, admin xếp) hoặc khi KTV bấm "Vào ca"
-- (shift_checkins). profiles.shift để null = chưa có ca cố định.
-- Các function dashboard_snapshot / my_snapshot dùng coalesce(lịch, profiles.shift)
-- nên tự trả về null ("Chưa xếp ca") khi ngày đó chưa được xếp.
-- =============================================================================

alter table public.profiles alter column shift drop not null;
alter table public.profiles alter column shift drop default;

update public.profiles set shift = null where shift is not null;
