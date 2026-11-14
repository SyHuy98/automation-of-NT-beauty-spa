"use client";

import { ChevronRight, Hourglass, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { errorMessage, formatMinutes, formatTime } from "@/lib/format";
import { buildQueue, type QueueEntry } from "@/lib/queue";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { DashboardTechnician, DashboardTour } from "@/types/app";

/**
 * Hàng chờ: khách đang đợi vì mọi KTV phù hợp đều bận. Tour Tự động / Random tự gửi
 * cho KTV rảnh phù hợp nhất theo thứ tự đến; khách chỉ định chờ đúng KTV đó; tour Gợi ý
 * cần quản lý chọn (hoặc bấm "Tự động" để đưa vào hàng chờ tự phân).
 */
export function QueuePanel({
  tours,
  technicians,
  now,
  onOpen,
  onChanged,
}: {
  tours: DashboardTour[];
  technicians: DashboardTechnician[];
  now: number;
  onOpen: (tourId: string) => void;
  onChanged: () => void;
}) {
  const queue = useMemo(() => buildQueue(tours, technicians, now), [tours, technicians, now]);
  if (queue.length === 0) return null;

  return (
    <Card className="border-gold/60">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Hourglass className="h-5 w-5 text-gold-strong" /> Hàng chờ ({queue.length} khách)
          </span>
        }
        subtitle="Đến trước phục vụ trước · có KTV rảnh là tự gửi cho người phù hợp nhất (chia công bằng) · khách chỉ định chờ đúng KTV đó"
      />
      <CardBody className="space-y-2">
        {queue.map((e) => (
          <QueueRow key={e.tour.id} entry={e} now={now} onOpen={onOpen} onChanged={onChanged} />
        ))}
      </CardBody>
    </Card>
  );
}

function QueueRow({
  entry,
  now,
  onOpen,
  onChanged,
}: {
  entry: QueueEntry;
  now: number;
  onOpen: (tourId: string) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const t = entry.tour;
  const manual = !t.isRequested && t.assignMode === "suggest";

  const toAuto = async () => {
    setBusy(true);
    const { error } = await getSupabaseBrowser().rpc("set_auto_dispatch", { p_tour_id: t.id });
    setBusy(false);
    if (error) toast.error(errorMessage(error));
    else {
      toast.success(`Tour ${t.code} đã vào hàng chờ tự động`);
      onChanged();
    }
  };

  const mode = t.isRequested ? (
    <Badge tone="gold">Chờ {t.requestedTechnicianName ?? "KTV chỉ định"}</Badge>
  ) : manual ? (
    <Badge tone="pending">Chờ chọn KTV</Badge>
  ) : (
    <Badge tone="free">Tự phân</Badge>
  );
  const etaMin = entry.etaMs === null ? null : Math.max(0, Math.round((entry.etaMs - now) / 60_000));

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-champagne bg-white/80 px-3 py-2">
      <button type="button" onClick={() => onOpen(t.id)} className="flex min-w-[16rem] flex-1 items-center gap-3 text-left">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-espresso font-semibold text-cream">
          {entry.position}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-espresso">{t.customerName}</span>
            {mode}
            {t.teamSize === 2 ? <Badge>{entry.openSlots === 2 ? "2 KTV" : "thiếu 1 KTV"}</Badge> : null}
          </span>
          <span className="block text-sm text-mocha">
            {t.code} · {t.items.map((i) => i.name).join(", ")} · đã chờ {formatMinutes(entry.waitedMinutes)}
          </span>
          <span className="block text-sm font-medium text-espresso">
            {etaMin === null
              ? t.isRequested
                ? "KTV chỉ định chưa vào ca – chưa ước tính được"
                : "Chưa có KTV phù hợp trong ca"
              : etaMin <= 1
                ? "Sắp có KTV"
                : `Dự kiến có KTV ~${formatTime(new Date(entry.etaMs!).toISOString())} (khoảng ${formatMinutes(etaMin)} nữa)`}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-taupe" aria-hidden="true" />
      </button>
      {manual ? (
        <Button size="sm" variant="secondary" onClick={toAuto} loading={busy} className="ml-12 sm:ml-0">
          <Zap className="h-4 w-4" /> Tự động
        </Button>
      ) : null}
    </div>
  );
}
