"use client";

import { AlertTriangle, ChevronDown, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Avatar } from "@/components/ui/misc";
import { Spinner } from "@/components/ui/spinner";
import type { RankedCandidate, RankResult } from "@/lib/assignment";

/**
 * Danh sách KTV gợi ý (top 3 mặc định) kèm lý do ngắn bằng tiếng Việt.
 * - single: mỗi dòng có nút hành động (vd "Gửi")
 * - multi: chọn tối đa `max` người (tour 2 KTV)
 */
export function CandidateList({
  result,
  loading,
  error,
  onReload,
  actionLabel,
  onAction,
  actionBusyId,
  selectable,
  selected = [],
  max = 1,
  onToggle,
}: {
  result: RankResult | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  actionLabel?: string;
  onAction?: (c: RankedCandidate) => void;
  actionBusyId?: string | null;
  selectable?: boolean;
  selected?: string[];
  max?: number;
  onToggle?: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);

  if (error) return <p className="text-sm text-busy-ink">{error}</p>;
  if (!result) {
    return loading ? (
      <div className="flex items-center gap-2 py-4 text-sm text-mocha">
        <Spinner className="h-4 w-4" /> Đang tính gợi ý…
      </div>
    ) : (
      <p className="py-3 text-sm text-mocha">Chọn dịch vụ để xem gợi ý KTV.</p>
    );
  }

  const list = showAll ? result.candidates : result.candidates.slice(0, 3);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-mocha">
          {result.candidates.length > 0 ? `${result.candidates.length} KTV phù hợp` : "Không có KTV phù hợp"}
        </p>
        <button type="button" onClick={onReload} className="inline-flex items-center gap-1 text-sm text-gold-strong hover:underline">
          {loading ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />} Làm mới
        </button>
      </div>

      {result.genderFree ? (
        <p className="rounded-xl border border-champagne bg-cream/60 px-3 py-2 text-sm text-mocha">
          Tour này không áp dụng quy tắc giới tính (dịch vụ chuyên môn hoặc khách nam đồng ý KTV nữ) – KTV nam và nữ đều
          được gợi ý.
        </p>
      ) : null}
      {result.genderFallback ? (
        <p className="flex items-start gap-2 rounded-xl border border-pending/50 bg-pending/10 px-3 py-2 text-sm text-pending-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Khách nam nhưng hiện không còn KTV nam nào rảnh – đang gợi ý KTV nữ.
        </p>
      ) : null}
      {result.message ? (
        <p className="rounded-xl border border-pending/50 bg-pending/10 px-3 py-2 text-sm text-pending-ink">{result.message}</p>
      ) : null}

      <ul className="space-y-2">
        {list.map((c, idx) => {
          const isSel = selected.includes(c.technicianId);
          const disabled = selectable && !isSel && selected.length >= max;
          return (
            <li
              key={c.technicianId}
              className={cn(
                "flex items-center gap-3 rounded-2xl border bg-white/90 p-3",
                isSel ? "border-gold-strong ring-2 ring-gold/30" : "border-champagne",
              )}
            >
              <Avatar name={c.fullName} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold text-espresso">
                  {idx === 0 && !showAll ? <span className="text-xs font-semibold text-gold-strong">#1</span> : null}
                  {c.fullName}
                  <span className="tabular rounded-full bg-cream px-2 text-xs font-semibold text-mocha">{c.score} điểm</span>
                </p>
                <p className="text-sm text-mocha">{c.reasons.join(" · ")}</p>
                {c.warnings.length > 0 ? (
                  <p className="mt-0.5 flex items-start gap-1 text-sm text-pending-ink">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {c.warnings.join(" · ")}
                  </p>
                ) : null}
              </div>
              {selectable ? (
                <Button
                  size="sm"
                  variant={isSel ? "primary" : "secondary"}
                  disabled={disabled}
                  onClick={() => onToggle?.(c.technicianId)}
                  aria-pressed={isSel}
                >
                  {isSel ? "Đã chọn" : "Chọn"}
                </Button>
              ) : onAction ? (
                <Button size="sm" onClick={() => onAction(c)} loading={actionBusyId === c.technicianId} disabled={!!actionBusyId}>
                  {actionLabel ?? "Chọn"}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>

      {result.candidates.length > 3 ? (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="text-sm font-medium text-gold-strong hover:underline">
          {showAll ? "Chỉ hiện top 3" : `Xem tất cả ${result.candidates.length} KTV phù hợp`}
        </button>
      ) : null}

      {result.excluded.length > 0 ? (
        <div>
          <button
            type="button"
            onClick={() => setShowExcluded((v) => !v)}
            className="inline-flex items-center gap-1 text-sm text-mocha hover:underline"
            aria-expanded={showExcluded}
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", showExcluded && "rotate-180")} />
            Không phù hợp ({result.excluded.length})
          </button>
          {showExcluded ? (
            <ul className="mt-1 space-y-0.5 pl-5 text-sm text-mocha">
              {result.excluded.map((e) => (
                <li key={e.technicianId}>
                  {e.fullName}: {e.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
