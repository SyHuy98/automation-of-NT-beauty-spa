import { describe, expect, it } from "vitest";
import { splitFee, summarizeEarnings, technicianAmount, tourTotal, validateShares } from "..";

describe("tiền tour", () => {
  it("tổng tiền = tổng giá các dịch vụ đã chụp", () => {
    expect(tourTotal([{ fee: 150_000 }, { fee: 80_000 }])).toBe(230_000);
    expect(tourTotal([])).toBe(0);
  });

  it("1 KTV nhận 100%", () => {
    expect(splitFee(230_000, [100])).toEqual([230_000]);
  });

  it("2 KTV 50/50", () => {
    expect(splitFee(200_000, [50, 50])).toEqual([100_000, 100_000]);
  });

  it("chia lẻ: phần dư dồn cho người tỷ lệ lớn nhất, tổng luôn khớp", () => {
    const amounts = splitFee(100_001, [60, 40]);
    expect(amounts).toEqual([60_001, 40_000]);
    expect(amounts[0] + amounts[1]).toBe(100_001);
  });

  it("bằng tỷ lệ thì người đứng trước nhận phần dư", () => {
    expect(splitFee(100_001, [50, 50])).toEqual([50_001, 50_000]);
  });

  it("người tỷ lệ lớn đứng sau vẫn nhận phần dư", () => {
    expect(splitFee(100_001, [30, 70])).toEqual([30_000, 70_001]);
  });

  it("ước tính tiền 1 KTV", () => {
    expect(technicianAmount(300_000, 100)).toBe(300_000);
    expect(technicianAmount(100_001, 40, [60, 40])).toBe(40_000);
    expect(technicianAmount(100_001, 60, [40, 60])).toBe(60_001);
  });

  it("kiểm tra tỷ lệ chia", () => {
    expect(validateShares([50, 50])).toBeNull();
    expect(validateShares([60, 30])).toBe("Tổng tỷ lệ chia phải bằng 100%");
    expect(validateShares([100, 0])).toBe("Tỷ lệ mỗi KTV phải từ 1% đến 100%");
    expect(validateShares([])).toBe("Chưa có KTV");
  });

  it("tổng hợp thu nhập", () => {
    expect(
      summarizeEarnings([
        { amount: 100_000, is_requested: true },
        { amount: 50_000, is_requested: false },
      ]),
    ).toEqual({ tours: 2, amount: 150_000, requestedTours: 1, requestedAmount: 100_000 });
  });
});
