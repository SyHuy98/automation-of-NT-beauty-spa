-- Dọn nhật ký chạy của pg_cron (cron.job_run_details).
-- expire-offers chạy mỗi 20 giây + dispatch-waiting mỗi phút ghi ~5.800 dòng/ngày
-- (~1 MB/ngày); để nguyên thì khoảng 1 năm sẽ đầy 500 MB của gói Free.
-- Chỉ giữ 7 ngày gần nhất. Không đụng tới dữ liệu spa.
-- 02:30 giờ VN (19:30 UTC) mỗi đêm. cron.schedule cùng tên sẽ ghi đè → chạy lại an toàn.
select cron.schedule(
  'cleanup-cron-history',
  '30 19 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$
);
