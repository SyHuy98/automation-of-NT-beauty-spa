/**
 * Schema Zod dùng chung client + server (Server Action / Edge Function có bản tương ứng).
 * Thông báo lỗi tiếng Việt để hiển thị thẳng dưới ô nhập.
 */
import { z } from "zod";

const phone = z
  .string()
  .trim()
  .refine((v) => v === "" || /^[0-9 +.-]{8,20}$/.test(v), "Số điện thoại không hợp lệ");

/** Tour chỉ lưu 4 số cuối SĐT khách */
const phoneLast4 = z
  .string()
  .trim()
  .refine((v) => v === "" || /^[0-9]{4}$/.test(v), "Nhập đúng 4 số cuối số điện thoại");

/** Ô nhập 4 số cuối: chỉ giữ chữ số; dán cả số điện thoại thì lấy 4 số cuối */
export const toPhoneLast4 = (v: string) => v.replace(/\D/g, "").slice(-4);

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, "3–32 ký tự: chữ thường không dấu, số, dấu . _ -");

export const passwordSchema = z.string().min(6, "Mật khẩu tối thiểu 6 ký tự").max(72, "Mật khẩu quá dài");

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, "Vui lòng nhập mật khẩu"),
});

export const shiftSchema = z.enum(["morning", "afternoon", "full", "off"]);

export const memberCreateSchema = z.object({
  full_name: z.string().trim().min(1, "Vui lòng nhập họ tên").max(100),
  username: usernameSchema,
  password: passwordSchema,
  phone,
  role: z.enum(["technician", "manager"]),
  gender: z.enum(["male", "female"]).optional(),
  skill_ids: z.array(z.string().uuid()),
});

export const memberUpdateSchema = z.object({
  full_name: z.string().trim().min(1, "Vui lòng nhập họ tên").max(100),
  phone,
  gender: z.enum(["male", "female"]).optional(),
  skill_ids: z.array(z.string().uuid()),
});

export const serviceSchema = z.object({
  name: z.string().trim().min(1, "Vui lòng nhập tên dịch vụ").max(120),
  tour_fee: z.coerce
    .number({ message: "Tiền tour phải là số" })
    .int("Tiền tour phải là số nguyên")
    .min(0, "Tiền tour không âm")
    .max(100_000_000, "Tiền tour quá lớn"),
  duration_minutes: z.coerce
    .number({ message: "Thời lượng phải là số" })
    .int("Thời lượng phải là số phút nguyên")
    .min(1, "Tối thiểu 1 phút")
    .max(600, "Tối đa 600 phút"),
  requires_skill: z.boolean(),
  any_gender: z.boolean(),
  sort_order: z.coerce.number().int().min(0).max(9999),
});

export const tourCreateSchema = z
  .object({
    customer_name: z.string().trim().min(1, "Vui lòng nhập tên khách").max(120),
    customer_phone: phoneLast4,
    customer_gender: z.enum(["male", "female"]),
    allow_any_gender: z.boolean().default(false),
    note: z.string().trim().max(1000, "Ghi chú tối đa 1000 ký tự"),
    service_ids: z.array(z.string().uuid()).min(1, "Chọn ít nhất 1 dịch vụ").max(10, "Tối đa 10 dịch vụ"),
    assign_mode: z.enum(["suggest", "auto", "random", "requested"]),
    team_size: z.union([z.literal(1), z.literal(2)]),
    requested_technician_id: z.string().uuid().nullable(),
    offers: z.array(z.object({ technician_id: z.string().uuid(), share_percent: z.number().int().min(1).max(100) })),
  })
  .superRefine((v, ctx) => {
    if (v.assign_mode === "requested" && !v.requested_technician_id) {
      ctx.addIssue({ code: "custom", path: ["requested_technician_id"], message: "Chọn KTV khách chỉ định" });
    }
    if (v.team_size === 2 && (v.assign_mode === "auto" || v.assign_mode === "random")) {
      ctx.addIssue({ code: "custom", path: ["assign_mode"], message: "Tour 2 KTV chỉ dùng chế độ Gợi ý hoặc Chỉ định" });
    }
    if (v.team_size === 2 && v.offers.length === 2) {
      const sum = v.offers.reduce((s, o) => s + o.share_percent, 0);
      if (sum !== 100) ctx.addIssue({ code: "custom", path: ["offers"], message: "Tổng tỷ lệ chia phải bằng 100%" });
      if (v.offers[0].technician_id === v.offers[1].technician_id) {
        ctx.addIssue({ code: "custom", path: ["offers"], message: "Chọn 2 KTV khác nhau" });
      }
    }
  });

export const reasonSchema = z.string().trim().min(3, "Vui lòng nhập lý do (ít nhất 3 ký tự)").max(500);

export const announcementSchema = z.object({
  title: z.string().trim().min(1, "Vui lòng nhập tiêu đề").max(150),
  body: z.string().trim().min(1, "Vui lòng nhập nội dung").max(4000),
  technician_ids: z.array(z.string().uuid()),
});

export const disputeSchema = z.object({
  message: z.string().trim().min(5, "Vui lòng mô tả rõ chỗ sai (ít nhất 5 ký tự)").max(1000),
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Giờ dạng HH:MM");

export const settingsSchema = z.object({
  offer_timeout_seconds: z.coerce.number().int().min(30, "Tối thiểu 30 giây").max(900, "Tối đa 900 giây"),
  shift_hours: z.object({
    morning: z.object({ start: hhmm, end: hhmm }),
    afternoon: z.object({ start: hhmm, end: hhmm }),
    full: z.object({ start: hhmm, end: hhmm }),
  }),
  weights: z.object({
    today: z.coerce.number().min(0).max(200),
    month: z.coerce.number().min(0).max(200),
    idle: z.coerce.number().min(0).max(200),
    shiftEnd: z.coerce.number().min(0).max(500),
    declines: z.coerce.number().min(0).max(200),
  }),
  overdue_alert_minutes: z.coerce.number().int().min(1, "Tối thiểu 1 phút").max(240, "Tối đa 240 phút"),
  payroll_start_day: z.coerce.number().int().min(1, "Từ 1 đến 28").max(28, "Từ 1 đến 28"),
  imbalance_threshold_percent: z.coerce.number().int().min(0).max(200),
  random_pool_size: z.coerce.number().int().min(1).max(10),
  decline_reasons: z.array(z.string().trim().min(1).max(100)).min(1, "Cần ít nhất 1 lý do").max(15),
});

/** Lỗi đầu tiên theo từng field: { full_name: "…", … } */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
