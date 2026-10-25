import { describe, expect, it } from "vitest";
import { formatDateRange, formatPayPeriod, payPeriodOf, payPeriodRange, shiftPeriod } from "../pay-period";

describe("kỳ lương 21 → 20", () => {
  it("ngày 20 thuộc kỳ tháng này, ngày 21 sang kỳ tháng sau", () => {
    expect(payPeriodOf("2026-10-20", 21)).toBe("2026-10-01");
    expect(payPeriodOf("2026-10-21", 21)).toBe("2026-11-01");
    expect(payPeriodOf("2026-10-01", 21)).toBe("2026-10-01");
  });

  it("qua năm: 21/12 thuộc kỳ tháng 1 năm sau", () => {
    expect(payPeriodOf("2026-12-21", 21)).toBe("2027-01-01");
    expect(payPeriodRange("2027-01-01", 21)).toEqual({ from: "2026-12-21", to: "2027-01-20" });
  });

  it("khoảng ngày của kỳ", () => {
    expect(payPeriodRange("2026-11-01", 21)).toEqual({ from: "2026-10-21", to: "2026-11-20" });
    expect(payPeriodRange("2026-03-01", 21)).toEqual({ from: "2026-02-21", to: "2026-03-20" });
  });

  it("các kỳ liền nhau không chồng / không hở", () => {
    let p = "2026-01-01";
    for (let i = 0; i < 24; i++) {
      const next = shiftPeriod(p, 1);
      const a = payPeriodRange(p, 21);
      const b = payPeriodRange(next, 21);
      const dayAfter = new Date(`${a.to}T00:00:00Z`);
      dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
      expect(b.from).toBe(dayAfter.toISOString().slice(0, 10));
      expect(payPeriodOf(a.from, 21)).toBe(p);
      expect(payPeriodOf(a.to, 21)).toBe(p);
      p = next;
    }
  });

  it("ngày bắt đầu 1 = tháng lịch", () => {
    expect(payPeriodOf("2026-10-31", 1)).toBe("2026-10-01");
    expect(payPeriodRange("2026-02-01", 1)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(formatPayPeriod("2026-10-01", 1)).toBe("Tháng 10/2026");
  });

  it("nhãn hiển thị", () => {
    expect(formatPayPeriod("2026-11-01", 21)).toBe("Kỳ 21/10 – 20/11/2026");
    expect(formatPayPeriod("2027-01-01", 21)).toBe("Kỳ 21/12/2026 – 20/01/2027");
    expect(formatDateRange("2026-10-05", "2026-10-05")).toBe("05/10 – 05/10/2026");
  });
});
