/**
 * Định dạng hiển thị – luôn theo giờ Asia/Ho_Chi_Minh và kiểu vi-VN,
 * không phụ thuộc múi giờ của máy chủ hay điện thoại.
 */
export const VN_TZ = "Asia/Ho_Chi_Minh";

const moneyFmt = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });

/** 150000 → "150.000 ₫" */
export function formatMoney(amount: number | null | undefined): string {
  return moneyFmt.format(amount ?? 0).replace(/ /g, " ");
}

/** Rút gọn cho biểu đồ: 1.250.000 → "1,25tr" */
export function formatMoneyShort(amount: number): string {
  if (Math.abs(amount) >= 1_000_000) return `${(amount / 1_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 2 })}tr`;
  if (Math.abs(amount) >= 1_000) return `${Math.round(amount / 1_000)}k`;
  return `${amount}`;
}

const timeFmt = new Intl.DateTimeFormat("vi-VN", { timeZone: VN_TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const dateFmt = new Intl.DateTimeFormat("vi-VN", { timeZone: VN_TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("vi-VN", {
  timeZone: VN_TZ,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const weekdayFmt = new Intl.DateTimeFormat("vi-VN", { timeZone: VN_TZ, weekday: "short", day: "2-digit", month: "2-digit" });

export function formatTime(iso: string | null | undefined): string {
  return iso ? timeFmt.format(new Date(iso)) : "—";
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  // Chuỗi YYYY-MM-DD (ngày thuần) → hiểu là ngày VN
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00+07:00`) : new Date(iso);
  return dateFmt.format(d);
}

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTimeFmt.format(new Date(iso)) : "—";
}

export function formatWeekday(isoDate: string): string {
  return weekdayFmt.format(new Date(`${isoDate}T12:00:00+07:00`));
}

/** Ngày hôm nay theo giờ VN: "YYYY-MM-DD" */
export function vnToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

/** Tháng hiện tại theo giờ VN: "YYYY-MM-01" */
export function vnMonthStart(now: Date = new Date()): string {
  return `${vnToday(now).slice(0, 7)}-01`;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(monthStart: string, months: number): string {
  const d = new Date(`${monthStart}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months, 1);
  return d.toISOString().slice(0, 10);
}

/** "2026-10-01" → "Tháng 10/2026" */
export function formatMonth(monthStart: string): string {
  return `Tháng ${Number(monthStart.slice(5, 7))}/${monthStart.slice(0, 4)}`;
}

/** Số giây → "m:ss" hoặc "h:mm:ss" */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(Math.abs(totalSeconds)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} phút`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const last = parts[parts.length - 1] ?? "";
  return last.slice(0, 2).toUpperCase() || "?";
}

export const SHIFT_LABEL: Record<string, string> = {
  morning: "Ca sáng",
  afternoon: "Ca chiều",
  full: "Ca full",
  off: "Nghỉ",
};

export const GENDER_LABEL: Record<"male" | "female", string> = { male: "Nam", female: "Nữ" };

export const ROLE_LABEL: Record<string, string> = {
  owner: "Chủ spa",
  manager: "Quản lý ca",
  technician: "Kỹ thuật viên",
};

export const TOUR_STATUS_LABEL: Record<string, string> = {
  waiting: "Chờ phân",
  offered: "Đang mời",
  in_progress: "Đang làm",
  completed: "Hoàn thành",
  cancelled: "Đã huỷ",
};

export const ASSIGN_MODE_LABEL: Record<string, string> = {
  suggest: "Gợi ý",
  auto: "Tự động",
  random: "Random cân bằng",
  requested: "Khách chỉ định",
};

/** Lấy thông báo lỗi tiếng Việt từ lỗi Supabase / JS */
export function errorMessage(err: unknown): string {
  if (!err) return "Đã có lỗi xảy ra";
  if (typeof err === "string") return err;
  const e = err as { message?: string; error?: string; context?: unknown };
  const msg = e.message ?? e.error ?? "Đã có lỗi xảy ra";
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return "Mất kết nối mạng – vui lòng thử lại";
  if (/JWT|session|refresh token/i.test(msg)) return "Phiên đăng nhập đã hết hạn – vui lòng đăng nhập lại";
  return msg;
}
