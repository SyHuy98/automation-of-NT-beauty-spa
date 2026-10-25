/**
 * Kỳ lương (kỳ chốt tour) – bản TypeScript của các hàm pay_period_* trong Postgres
 * (migration 20261025000011_pay_period.sql), dùng để điều hướng / hiển thị.
 *
 * Kỳ được đặt tên theo tháng KẾT THÚC: với ngày bắt đầu 21, kỳ "2026-11-01"
 * = 21/10/2026 → 20/11/2026. Ngày bắt đầu 1 → đúng tháng lịch.
 * Ngày dạng "YYYY-MM-DD" (giờ VN).
 */

function ymd(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}

/** Kỳ lương chứa ngày `date` */
export function payPeriodOf(date: string, startDay: number): string {
  const [y, m, d] = parts(date);
  if (startDay <= 1 || d < startDay) return ymd(y, m, 1);
  return ymd(y, m + 1, 1);
}

/** Ngày đầu / cuối (tính cả 2 đầu) của kỳ */
export function payPeriodRange(period: string, startDay: number): { from: string; to: string } {
  const [y, m] = parts(period);
  if (startDay <= 1) return { from: ymd(y, m, 1), to: ymd(y, m + 1, 0) };
  return { from: ymd(y, m - 1, startDay), to: ymd(y, m, startDay - 1) };
}

/** Kỳ trước / sau */
export function shiftPeriod(period: string, months: number): string {
  const [y, m] = parts(period);
  return ymd(y, m + months, 1);
}

/** "21/10/2026" */
export function formatDayMonthYear(date: string): string {
  const [y, m, d] = parts(date);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

/** "21/10 – 20/11/2026" (cùng năm) hoặc "21/12/2026 – 20/01/2027" */
export function formatDateRange(from: string, to: string): string {
  const [fy, fm, fd] = parts(from);
  const sameYear = fy === parts(to)[0];
  const head = sameYear ? `${String(fd).padStart(2, "0")}/${String(fm).padStart(2, "0")}` : formatDayMonthYear(from);
  return `${head} – ${formatDayMonthYear(to)}`;
}

/** Nhãn kỳ: "Kỳ 21/10 – 20/11/2026"; ngày bắt đầu 1 → "Tháng 11/2026" */
export function formatPayPeriod(period: string, startDay: number): string {
  if (startDay <= 1) return `Tháng ${Number(period.slice(5, 7))}/${period.slice(0, 4)}`;
  const { from, to } = payPeriodRange(period, startDay);
  return `Kỳ ${formatDateRange(from, to)}`;
}
