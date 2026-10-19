"use client";

import type { EarningLine } from "@/types/app";

export interface PayrollSummaryRow {
  full_name: string;
  username: string;
  tours: number;
  requested_tours: number;
  amount: number;
  requested_amount: number;
}

/**
 * Xuất Excel chốt lương: sheet "Tổng hợp" + sheet "Chi tiết từng tour".
 * exceljs được tải động (chỉ khi bấm nút) để không làm nặng trang.
 */
export async function exportPayrollExcel(monthLabel: string, monthKey: string, summary: PayrollSummaryRow[], lines: EarningLine[]) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "NT Beauty Spa";
  wb.created = new Date();

  const header = { font: { bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF8C6D35" } } };
  const money = "#,##0 \"₫\"";

  const s1 = wb.addWorksheet("Tổng hợp");
  s1.addRow([`BẢNG TIỀN TOUR ${monthLabel.toUpperCase()} – NT BEAUTY SPA`]).font = { bold: true, size: 14 };
  s1.addRow([]);
  const h1 = s1.addRow(["STT", "Họ tên", "Tên đăng nhập", "Số tour", "Tour chỉ định", "Tiền tour chỉ định", "Tổng tiền tour"]);
  h1.eachCell((c) => Object.assign(c, { font: header.font, fill: header.fill }));
  summary.forEach((r, i) => s1.addRow([i + 1, r.full_name, r.username, r.tours, r.requested_tours, r.requested_amount, r.amount]));
  const total = s1.addRow(["", "TỔNG", "", summary.reduce((a, r) => a + r.tours, 0), summary.reduce((a, r) => a + r.requested_tours, 0), summary.reduce((a, r) => a + r.requested_amount, 0), summary.reduce((a, r) => a + r.amount, 0)]);
  total.font = { bold: true };
  s1.columns = [{ width: 6 }, { width: 28 }, { width: 18 }, { width: 10 }, { width: 14 }, { width: 20 }, { width: 20 }];
  s1.getColumn(6).numFmt = money;
  s1.getColumn(7).numFmt = money;

  const s2 = wb.addWorksheet("Chi tiết từng tour");
  const h2 = s2.addRow(["Ngày", "Giờ xong", "Mã tour", "KTV", "Khách", "Dịch vụ", "Tổng tiền tour", "Tỷ lệ chia (%)", "Tiền của KTV", "Chỉ định"]);
  h2.eachCell((c) => Object.assign(c, { font: header.font, fill: header.fill }));
  const fmtTime = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hour12: false });
  for (const l of lines) {
    s2.addRow([
      l.work_date ? l.work_date.split("-").reverse().join("/") : "",
      l.completed_at ? fmtTime.format(new Date(l.completed_at)) : "",
      l.code,
      l.technician_name,
      l.customer_name,
      l.services,
      l.tour_total,
      l.share_percent,
      l.amount,
      l.is_requested ? "Có" : "",
    ]);
  }
  s2.columns = [{ width: 12 }, { width: 10 }, { width: 18 }, { width: 24 }, { width: 22 }, { width: 40 }, { width: 16 }, { width: 14 }, { width: 16 }, { width: 10 }];
  s2.getColumn(7).numFmt = money;
  s2.getColumn(9).numFmt = money;
  s2.views = [{ state: "frozen", ySplit: 1 }];

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tien-tour-${monthKey.slice(0, 7)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
