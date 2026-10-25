"use client";

import { Flag, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { Badge, Money } from "@/components/ui/misc";
import { LoadingBlock } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { summarizeEarnings } from "@/lib/earnings";
import { errorMessage, formatTime, formatWeekday, vnToday } from "@/lib/format";
import { usePayPeriodSettings } from "@/lib/hooks/use-pay-period";
import { useQuery } from "@/lib/hooks/use-query";
import { useRealtime } from "@/lib/hooks/use-realtime";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { disputeSchema } from "@/lib/validation/schemas";
import type { Database } from "@/types/database";
import type { EarningLine } from "@/types/app";
import { PeriodPicker, selectionLabel, selectionRange, type PeriodSelection } from "../shared/period-picker";
import { useSession } from "../shared/session-context";

type Dispute = Database["public"]["Tables"]["earning_disputes"]["Row"];
const NO_DISPUTES: Dispute[] = [];

const DISPUTE_LABEL: Record<string, { label: string; tone: "pending" | "free" | "off" }> = {
  open: { label: "Đang chờ xử lý", tone: "pending" },
  resolved: { label: "Đã xử lý", tone: "free" },
  rejected: { label: "Không chấp nhận", tone: "off" },
};

export function KtvEarnings() {
  const pp = usePayPeriodSettings();
  if (!pp) return <LoadingBlock />;
  return <KtvEarningsBody startDay={pp.startDay} currentPeriod={pp.currentPeriod} />;
}

function KtvEarningsBody({ startDay, currentPeriod }: { startDay: number; currentPeriod: string }) {
  const me = useSession();
  const toast = useToast();
  const [sel, setSel] = useState<PeriodSelection>({ mode: "period", period: currentPeriod });
  const [reportFor, setReportFor] = useState<{ tourId: string | null; label: string } | null>(null);
  // Báo sai gắn với kỳ lương; khi xem khoảng ngày tự chọn thì báo sai theo từng tour
  const period = sel.mode === "period" ? sel.period : null;
  const { from, to } = selectionRange(sel, startDay);
  const label = selectionLabel(sel, startDay);

  const query = useQuery(async () => {
    const supabase = getSupabaseBrowser();
    let lq = supabase.from("earning_lines").select("*").eq("technician_id", me.id);
    lq = period ? lq.eq("month", period) : lq.gte("work_date", from).lte("work_date", to);
    const [l, d] = await Promise.all([
      lq.order("completed_at", { ascending: false }),
      period
        ? supabase.from("earning_disputes").select("*").eq("technician_id", me.id).eq("month", period).order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as Dispute[] }),
    ]);
    if (l.error) throw l.error;
    return { lines: l.data as EarningLine[], disputes: (d.data ?? []) as Dispute[] };
  }, [me.id, period, from, to]);
  const { error, refetch: load } = query;
  const lines = query.data?.lines ?? null;
  const disputes = query.data?.disputes ?? NO_DISPUTES;

  useRealtime(`ktv-earn-${me.id}`, [{ table: "tour_assignments", filter: `technician_id=eq.${me.id}` }, { table: "earning_disputes", filter: `technician_id=eq.${me.id}` }], load, {
    pollMs: 60_000,
  });

  const today = vnToday();
  const summary = useMemo(() => summarizeEarnings((lines ?? []).map((l) => ({ amount: l.amount ?? 0, is_requested: !!l.is_requested }))), [lines]);
  const todaySum = useMemo(
    () => (lines ?? []).filter((l) => l.work_date === today).reduce((s, l) => s + (l.amount ?? 0), 0),
    [lines, today],
  );
  const byDay = useMemo(() => {
    const map = new Map<string, EarningLine[]>();
    for (const l of lines ?? []) {
      const k = l.work_date ?? "";
      map.set(k, [...(map.get(k) ?? []), l]);
    }
    return [...map.entries()];
  }, [lines]);

  const isCurrent = period === currentPeriod;
  const disputeByTour = new Map(disputes.filter((d) => d.tour_id).map((d) => [d.tour_id!, d]));

  return (
    <div className="space-y-5">
      <h1 className="font-serif text-2xl font-semibold text-espresso">Thu nhập</h1>

      <PeriodPicker value={sel} onChange={setSel} startDay={startDay} currentPeriod={currentPeriod} />

      <div className="grid grid-cols-2 gap-3">
        {isCurrent ? (
          <div className="rounded-3xl border border-champagne bg-white/80 p-4">
            <p className="text-sm text-mocha">Hôm nay</p>
            <Money value={todaySum} className="mt-1 block font-serif text-2xl font-semibold" />
          </div>
        ) : null}
        <div className={isCurrent ? "rounded-3xl border border-gold/60 bg-champagne/30 p-4" : "col-span-2 rounded-3xl border border-gold/60 bg-champagne/30 p-4"}>
          <p className="text-sm text-mocha">{isCurrent ? (startDay > 1 ? "Kỳ này" : "Tháng này") : label}</p>
          <Money value={summary.amount} className="mt-1 block font-serif text-2xl font-semibold" />
          <p className="text-xs text-mocha">
            {summary.tours} tour · {summary.requestedTours} chỉ định
          </p>
        </div>
      </div>

      {period ? (
        <Button variant="secondary" className="w-full" onClick={() => setReportFor({ tourId: null, label })}>
          <Flag className="h-4 w-4" /> Báo sai cả kỳ
        </Button>
      ) : null}

      {disputes.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-mocha">Yêu cầu báo sai</h2>
          {disputes.map((d) => (
            <div key={d.id} className="rounded-2xl border border-champagne bg-white/80 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-mocha">{d.tour_id ? "Theo tour" : "Cả kỳ"}</span>
                <Badge tone={DISPUTE_LABEL[d.status].tone}>{DISPUTE_LABEL[d.status].label}</Badge>
              </div>
              <p className="mt-1 text-espresso">{d.message}</p>
              {d.admin_reply ? <p className="mt-1 text-mocha">Trả lời: {d.admin_reply}</p> : null}
            </div>
          ))}
        </section>
      ) : null}

      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {!lines ? (
        <LoadingBlock />
      ) : lines.length === 0 ? (
        <EmptyState title="Chưa có tour hoàn thành trong khoảng thời gian này" />
      ) : (
        <section className="space-y-4">
          {byDay.map(([day, items]) => (
            <div key={day}>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold capitalize text-mocha">{formatWeekday(day)}</h2>
                <Money value={items.reduce((s, l) => s + (l.amount ?? 0), 0)} className="text-sm font-semibold" />
              </div>
              <ul className="space-y-2">
                {items.map((l) => {
                  const d = l.tour_id ? disputeByTour.get(l.tour_id) : undefined;
                  return (
                    <li key={l.assignment_id} className="rounded-2xl border border-champagne bg-white/80 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-espresso">
                            {l.customer_name}
                            {l.is_requested ? <Star className="ml-1 inline h-4 w-4 fill-gold text-gold" aria-label="Chỉ định" /> : null}
                          </p>
                          <p className="text-sm text-espresso">{l.services}</p>
                          <p className="text-xs text-mocha">
                            {formatTime(l.completed_at)} · {l.code}
                            {(l.team_size ?? 1) > 1 ? ` · chia ${l.share_percent}% của ${(l.tour_total ?? 0).toLocaleString("vi-VN")} ₫` : ""}
                          </p>
                        </div>
                        <Money value={l.amount} className="font-semibold text-espresso" />
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        {d ? <Badge tone={DISPUTE_LABEL[d.status].tone}>{DISPUTE_LABEL[d.status].label}</Badge> : <span />}
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-sm font-medium text-gold-strong"
                          onClick={() => setReportFor({ tourId: l.tour_id, label: `${l.code} – ${l.customer_name}` })}
                        >
                          <Flag className="h-3.5 w-3.5" /> Báo sai
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      )}

      <DisputeDialog
        target={reportFor}
        month={period ?? currentPeriod}
        onClose={() => setReportFor(null)}
        onSent={() => {
          toast.success("Đã gửi báo sai – quản lý sẽ kiểm tra");
          load();
        }}
      />
    </div>
  );
}

type DisputeTarget = { tourId: string | null; label: string };

function DisputeDialog(props: { target: DisputeTarget | null; month: string; onClose: () => void; onSent: () => void }) {
  if (!props.target) return null;
  return <DisputeBody key={`${props.target.tourId ?? "month"}`} {...props} target={props.target} />;
}

function DisputeBody({
  target,
  month,
  onClose,
  onSent,
}: {
  target: DisputeTarget;
  month: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const parsed = disputeSchema.safeParse({ message });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    const { error: err } = await getSupabaseBrowser().rpc("create_dispute", {
      p_tour_id: target.tourId ?? (null as unknown as string),
      p_month: month,
      p_message: parsed.data.message,
    });
    setBusy(false);
    if (err) {
      setError(errorMessage(err));
      return;
    }
    onClose();
    onSent();
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Báo sai thu nhập"
      description={target.label}
      size="sm"
      footer={
        <Button size="lg" className="w-full" onClick={send} loading={busy}>
          Gửi
        </Button>
      }
    >
      <Field label="Mô tả chỗ sai" required error={error} hint="Vd: Tour này em làm 1 mình nhưng bị chia 50%">
        {(p) => <Textarea {...p} value={message} onChange={(e) => setMessage(e.target.value)} autoFocus />}
      </Field>
    </Dialog>
  );
}
