"use client";

import { Check, Sparkle } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Money } from "@/components/ui/misc";
import { formatMinutes } from "@/lib/format";
import type { ServiceRow } from "@/types/app";

/** Chọn 1 hoặc nhiều dịch vụ, tự cộng tổng tiền tour + thời lượng */
export function ServicePicker({
  services,
  selected,
  onChange,
  error,
}: {
  services: ServiceRow[];
  selected: string[];
  onChange: (ids: string[]) => void;
  error?: string;
}) {
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  const chosen = services.filter((s) => selected.includes(s.id));
  const total = chosen.reduce((sum, s) => sum + s.tour_fee, 0);
  const minutes = chosen.reduce((sum, s) => sum + s.duration_minutes, 0);

  if (services.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-champagne p-4 text-sm text-mocha">
        Chưa có dịch vụ nào. Chủ spa cần nhập bảng giá ở mục <strong>Bảng giá dịch vụ</strong> trước.
      </p>
    );
  }

  return (
    <div>
      <div role="group" aria-label="Dịch vụ" className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        {services.map((s) => {
          const on = selected.includes(s.id);
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(s.id)}
              className={cn(
                "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                on ? "border-gold-strong bg-champagne/30" : "border-champagne bg-white/80 hover:border-gold",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                  on ? "border-gold-strong bg-gold-strong text-white" : "border-taupe",
                )}
                aria-hidden="true"
              >
                {on ? <Check className="h-3.5 w-3.5" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium text-espresso">
                  {s.name}
                  {s.requires_skill ? <Sparkle className="ml-1 inline h-3.5 w-3.5 text-gold-strong" aria-label="Cần kỹ năng riêng" /> : null}
                </span>
                <span className="block text-sm text-mocha">
                  <Money value={s.tour_fee} /> · {s.duration_minutes} phút
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-cream/70 px-4 py-2.5">
        <span className="text-sm text-mocha">
          {chosen.length} dịch vụ · {minutes ? formatMinutes(minutes) : "0 phút"}
        </span>
        <span className="text-sm text-mocha">
          Tổng tiền tour: <Money value={total} className="text-base font-semibold text-espresso" />
        </span>
      </div>
      {error ? <p className="mt-1 text-sm text-busy-ink">{error}</p> : null}
      <p className="mt-1 text-xs text-mocha">
        <Sparkle className="inline h-3 w-3 text-gold-strong" /> = dịch vụ cần kỹ năng riêng (chỉ KTV được gán mới được gợi ý)
      </p>
    </div>
  );
}
