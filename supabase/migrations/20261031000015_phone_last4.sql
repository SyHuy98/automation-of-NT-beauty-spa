-- Tour chỉ lưu 4 số cuối SĐT khách (đủ để nhận ra khách, ít lộ thông tin hơn)
alter table public.tours drop constraint tours_customer_phone_check;
alter table public.tours add constraint tours_customer_phone_check
  check (customer_phone is null or customer_phone ~ '^[0-9]{4}$');
