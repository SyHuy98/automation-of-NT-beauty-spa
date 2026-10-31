"use client";

import { ChevronRight, Star, Users } from "lucide-react";
import { useState } from "react";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Segmented } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { Money } from "../../shared/money";
import { ASSIGN_MODE_LABEL, formatDuration, formatTime, TOUR_STATUS_LABEL } from "@/lib/format";
import type { DashboardTour, TourStatus } from "@/types/app";

type Filter = "all" | "active" | TourStatus;

export const TOUR_STATUS_TONE: Record<TourStatus, "gold" | "pending" | "busy" | "free" | "off"> = {
  waiting: "gold",
  offered: "pending",
  in_progress: "busy",
  completed: "free",
  cancelled: "off",
};

export function TourList({
  tours,
  now,
  onOpen,
}: {
  tours: DashboardTour[];
  today: string;
  now: number;
  onOpen: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const count = (f: Filter) =>
    f === "all" ? tours.length : f === "active" ? tours.filter(isActive).length : tours.filter((t) => t.status === f).length;
  const shown = tours.filter((t) => (filter === "all" ? true : filter === "active" ? isActive(t) : t.status === filter));

  return (
    <Card>
      <CardHeader title="Tour hôm nay" subtitle="Bấm vào tour để xem chi tiết, đổi KTV, sửa hoặc huỷ" />
      <CardBody className="space-y-4">
        <Segmented<Filter>
          ariaLabel="Lọc theo trạng thái"
          value={filter}
          onChange={setFilter}
          options={(["all", "active", "waiting", "offered", "in_progress", "completed", "cancelled"] as Filter[]).map((f) => ({
            value: f,
            label: `${f === "all" ? "Tất cả" : f === "active" ? "Chưa xong" : TOUR_STATUS_LABEL[f]} (${count(f)})`,
          }))}
        />
        {shown.length === 0 ? (
          <EmptyState title="Không có tour nào" hint="Bấm “Tạo tour” để bắt đầu phân tour cho KTV." />
        ) : (
          <ul className="divide-y divide-champagne/60">
            {shown.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onOpen(t.id)}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left hover:bg-cream/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-espresso">{t.code}</span>
                      <Badge tone={TOUR_STATUS_TONE[t.status]}>{TOUR_STATUS_LABEL[t.status]}</Badge>
                      {t.isRequested ? (
                        <Badge tone="gold">
                          <Star className="h-3 w-3 fill-gold-strong" /> Chỉ định
                        </Badge>
                      ) : null}
                      {t.teamSize === 2 ? (
                        <Badge>
                          <Users className="h-3 w-3" /> 2 KTV
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-espresso">
                      {t.customerName} · {t.items.map((i) => i.name).join(", ")}
                    </p>
                    <p className="text-xs text-mocha">
                      {formatTime(t.createdAt)} · {ASSIGN_MODE_LABEL[t.assignMode]}
                      {t.members.length > 0 ? ` · ${t.members.map((m) => m.name).join(" & ")}` : ""}
                      {t.pendingOffers.length > 0
                        ? ` · mời ${t.pendingOffers.map((o) => `${o.name} (${formatDuration((Date.parse(o.expiresAt) - now) / 1000)})`).join(", ")}`
                        : ""}
                      {t.status === "waiting" && t.requestedTechnicianName ? ` · chờ ${t.requestedTechnicianName}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <Money value={t.totalFee} className={cn("font-semibold", t.status === "cancelled" && "line-through opacity-60")} />
                    <p className="text-xs text-mocha">{t.durationMinutes} phút</p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-taupe" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function isActive(t: DashboardTour) {
  return t.status === "waiting" || t.status === "offered" || t.status === "in_progress";
}
