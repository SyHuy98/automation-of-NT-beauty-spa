"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Segmented } from "@/components/ui/form";
import { addDays, vnToday } from "@/lib/format";
import { formatDateRange, formatPayPeriod, payPeriodRange, shiftPeriod } from "@/lib/pay-period";

export type PeriodSelection = { mode: "period"; period: string } | { mode: "range"; from: string; to: string };

/** Khoảng ngày (tính cả 2 đầu) của lựa chọn */
export function selectionRange(sel: PeriodSelection, startDay: number): { from: string; to: string } {
  return sel.mode === "period" ? payPeriodRange(sel.period, startDay) : { from: sel.from, to: sel.to };
}

/** Nhãn ngắn: "Kỳ 21/10 – 20/11/2026" hoặc "05/10 – 12/10/2026" */
export function selectionLabel(sel: PeriodSelection, startDay: number): string {
  return sel.mode === "period" ? formatPayPeriod(sel.period, startDay) : formatDateRange(sel.from, sel.to);
}

/**
 * Chọn thời gian xem: theo kỳ lương (mặc định 21 → 20, đổi ở Cài đặt) hoặc
 * khoảng ngày bất kỳ "từ ngày … đến ngày …".
 */
export function PeriodPicker({
  value,
  onChange,
  startDay,
  currentPeriod,
  className,
}: {
  value: PeriodSelection;
  onChange: (v: PeriodSelection) => void;
  startDay: number;
  currentPeriod: string;
  className?: string;
}) {
  const today = vnToday();
  const current = payPeriodRange(currentPeriod, startDay);

  return (
    <div className={className}>
      <div className="space-y-2 rounded-2xl border border-champagne bg-white/80 p-2">
        <Segmented<"period" | "range">
          ariaLabel="Cách chọn thời gian"
          value={value.mode}
          onChange={(m) =>
            onChange(
              m === "period"
                ? { mode: "period", period: currentPeriod }
                : { mode: "range", ...selectionRange(value, startDay) },
            )
          }
          options={[
            { value: "period", label: startDay > 1 ? "Theo kỳ lương" : "Theo tháng" },
            { value: "range", label: "Chọn ngày" },
          ]}
        />

        {value.mode === "period" ? (
          <div className="flex items-center justify-between gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onChange({ mode: "period", period: shiftPeriod(value.period, -1) })}
              aria-label="Kỳ trước"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="text-center">
              <p className="font-semibold text-espresso">{formatPayPeriod(value.period, startDay)}</p>
              {value.period === currentPeriod ? <p className="text-xs text-mocha">Kỳ hiện tại</p> : null}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onChange({ mode: "period", period: shiftPeriod(value.period, 1) })}
              disabled={value.period >= currentPeriod}
              aria-label="Kỳ sau"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        ) : (
          <div className="space-y-2 px-1 pb-1">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-mocha">
                Từ ngày
                <Input
                  type="date"
                  value={value.from}
                  max={value.to}
                  onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
                  className="mt-1"
                />
              </label>
              <label className="text-xs text-mocha">
                Đến ngày
                <Input
                  type="date"
                  value={value.to}
                  min={value.from}
                  max={today}
                  onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
                  className="mt-1"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: "Hôm nay", from: today, to: today },
                { label: "7 ngày qua", from: addDays(today, -6), to: today },
                { label: startDay > 1 ? "Kỳ này" : "Tháng này", from: current.from, to: today },
              ].map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => onChange({ mode: "range", from: q.from, to: q.to })}
                  className="rounded-full border border-champagne px-3 py-1 text-xs font-medium text-mocha hover:bg-champagne/40"
                >
                  {q.label}
                </button>
              ))}
            </div>
            {value.from > value.to ? <p className="text-xs text-busy-ink">“Từ ngày” phải trước “Đến ngày”</p> : null}
          </div>
        )}
      </div>
    </div>
  );
}
