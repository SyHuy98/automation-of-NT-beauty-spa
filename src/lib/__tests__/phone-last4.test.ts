import { describe, expect, it } from "vitest";
import { toPhoneLast4, tourCreateSchema } from "../validation/schemas";

const base = {
  customer_name: "Chị Hương",
  customer_gender: "female",
  note: "",
  service_ids: ["4d8e65cc-c65e-4287-a624-d67c4e228723"],
  assign_mode: "suggest",
  team_size: 1,
  requested_technician_id: null,
  offers: [],
};

describe("4 số cuối SĐT khách", () => {
  it("chỉ giữ chữ số, dán cả số thì lấy 4 số cuối", () => {
    expect(toPhoneLast4("0903 123 456")).toBe("3456");
    expect(toPhoneLast4("+84-903-12-5678")).toBe("5678");
    expect(toPhoneLast4("12a")).toBe("12");
  });

  it("form tạo tour chấp nhận trống hoặc đúng 4 số", () => {
    expect(tourCreateSchema.safeParse({ ...base, customer_phone: "" }).success).toBe(true);
    expect(tourCreateSchema.safeParse({ ...base, customer_phone: "5678" }).success).toBe(true);
    expect(tourCreateSchema.safeParse({ ...base, customer_phone: "567" }).success).toBe(false);
    expect(tourCreateSchema.safeParse({ ...base, customer_phone: "0903123456" }).success).toBe(false);
  });
});
