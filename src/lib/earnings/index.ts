/**
 * Tính tiền tour – logic thuần, giống hệt SQL `split_fee` / `_recompute_tour_earnings`.
 * Tiền luôn là số nguyên VND.
 */

export interface FeeItem {
  fee: number;
}

/** Tổng tiền tour = tổng giá đã chụp của các dịch vụ */
export function tourTotal(items: FeeItem[]): number {
  return items.reduce((sum, i) => sum + i.fee, 0);
}

/**
 * Chia tổng tiền theo tỷ lệ %. Làm tròn xuống từng phần; phần dư dồn cho người
 * có tỷ lệ lớn nhất (người đứng trước nếu bằng nhau) để tổng luôn khớp.
 * Chỉ dồn phần dư khi tổng tỷ lệ = 100.
 */
export function splitFee(total: number, shares: number[]): number[] {
  if (shares.length === 0) return [];
  const amounts = shares.map((s) => Math.floor((total * s) / 100));
  const shareSum = shares.reduce((a, b) => a + b, 0);
  if (shareSum === 100) {
    let big = 0;
    shares.forEach((s, i) => {
      if (s > shares[big]) big = i;
    });
    const used = amounts.reduce((a, b) => a + b, 0);
    amounts[big] += total - used;
  }
  return amounts;
}

/** Tiền của 1 KTV cho 1 tour (dùng để hiển thị ước tính trước khi tour hoàn thành) */
export function technicianAmount(total: number, sharePercent: number, allShares?: number[]): number {
  if (!allShares || allShares.length <= 1) return Math.floor((total * sharePercent) / 100);
  const sorted = [...allShares].sort((a, b) => b - a);
  const amounts = splitFee(total, sorted);
  return amounts[sorted.indexOf(sharePercent)];
}

/** Kiểm tra tỷ lệ chia hợp lệ: mỗi người ≥ 1%, tổng = 100 */
export function validateShares(shares: number[]): string | null {
  if (shares.length === 0) return "Chưa có KTV";
  if (shares.some((s) => !Number.isInteger(s) || s < 1 || s > 100)) return "Tỷ lệ mỗi KTV phải từ 1% đến 100%";
  if (shares.reduce((a, b) => a + b, 0) !== 100) return "Tổng tỷ lệ chia phải bằng 100%";
  return null;
}

export interface EarningLine {
  amount: number;
  is_requested: boolean;
}

export function summarizeEarnings(lines: EarningLine[]) {
  return lines.reduce(
    (acc, l) => {
      acc.tours += 1;
      acc.amount += l.amount;
      if (l.is_requested) {
        acc.requestedTours += 1;
        acc.requestedAmount += l.amount;
      }
      return acc;
    },
    { tours: 0, amount: 0, requestedTours: 0, requestedAmount: 0 },
  );
}
