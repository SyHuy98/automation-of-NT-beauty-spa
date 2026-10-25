"use client";

import { Download, Lock, Star, Unlock } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, ErrorState, PageHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { Badge, Money } from "@/components/ui/misc";
import { LoadingBlock } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { exportPayrollExcel, type PayrollSummaryRow } from "@/lib/export-excel";
import { errorMessage, formatDate, formatDateTime, formatTime } from "@/lib/format";
import { usePayPeriodSettings } from "@/lib/hooks/use-pay-period";
import { useQuery } from "@/lib/hooks/use-query";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { Database } from "@/types/database";
import type { EarningLine } from "@/types/app";
import { PeriodPicker, selectionLabel, selectionRange, type PeriodSelection } from "../shared/period-picker";
import { useSession } from "../shared/session-context";
import { useTourLookup } from "./tour-lookup";

type SummaryRow = PayrollSummaryRow & { technician_id: string; is_active: boolean; open_disputes: number };
type Dispute = Database["public"]["Tables"]["earning_disputes"]["Row"] & {
  technician: { full_name: string } | null;
  tour: { code: string; customer_name: string } | null;
};

export function PayrollPage() {
  const pp = usePayPeriodSettings();
  if (!pp) return <LoadingBlock />;
  return <PayrollBody startDay={pp.startDay} currentPeriod={pp.currentPeriod} />;
}

function PayrollBody({ startDay, currentPeriod }: { startDay: number; currentPeriod: string }) {
  const me = useSession();
  const isOwner = me.role === "owner";
  const toast = useToast();
  const [sel, setSel] = useState<PeriodSelection>({ mode: "period", period: currentPeriod });
  // Chốt sổ / báo sai gắn với kỳ lương; khoảng ngày tự chọn chỉ để xem & xuất Excel
  const month = sel.mode === "period" ? sel.period : null;
  const { from, to } = selectionRange(sel, startDay);
  const label = selectionLabel(sel, startDay);
  const [detailFor, setDetailFor] = useState<SummaryRow | null>(null);
  const [confirmLock, setConfirmLock] = useState<"lock" | "unlock" | null>(null);
  const [resolving, setResolving] = useState<Dispute | null>(null);
  const [exporting, setExporting] = useState(false);
  const lookup = useTourLookup();

  const query = useQuery(async () => {
    const supabase = getSupabaseBrowser();
    if (!month) {
      // Khoảng ngày tự chọn
      const [s, l] = await Promise.all([
        supabase.rpc("earnings_summary", { p_from: from, p_to: to }),
        supabase.from("earning_lines").select("*").gte("work_date", from).lte("work_date", to).order("completed_at"),
      ]);
      if (s.error) throw s.error;
      return {
        summary: (s.data ?? []).map((r) => ({ ...r, open_disputes: 0 })) as SummaryRow[],
        lines: (l.data ?? []) as EarningLine[],
        disputes: [] as Dispute[],
        locked: null,
      };
    }
    const [s, l, d, p] = await Promise.all([
      supabase.rpc("payroll_summary", { p_month: month }),
      supabase.from("earning_lines").select("*").eq("month", month).order("completed_at"),
      supabase
        .from("earning_disputes")
        .select("*, technician:profiles!earning_disputes_technician_id_fkey(full_name), tour:tours(code, customer_name)")
        .eq("month", month)
        .order("created_at", { ascending: false }),
      supabase.from("payroll_periods").select("status, locked_at").eq("month", month).maybeSingle(),
    ]);
    if (s.error) throw s.error;
    return {
      summary: s.data as SummaryRow[],
      lines: (l.data ?? []) as EarningLine[],
      disputes: (d.data as unknown as Dispute[]) ?? [],
      locked: p.data ?? null,
    };
  }, [month, from, to]);
  const { error, refetch: load } = query;
  const summary = query.data?.summary ?? null;
  const lines = query.data?.lines ?? [];
  const disputes = query.data?.disputes ?? [];
  const locked = query.data?.locked ?? null;

  const isLocked = locked?.status === "locked";
  const totals = useMemo(
    () => (summary ?? []).reduce((a, r) => ({ tours: a.tours + r.tours, amount: a.amount + r.amount }), { tours: 0, amount: 0 }),
    [summary],
  );
  const openDisputes = disputes.filter((d) => d.status === "open");

  const doExport = async () => {
    if (!summary) return;
    setExporting(true);
    try {
      await exportPayrollExcel(label, `${from}_${to}`, summary, lines);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Chốt lương"
        subtitle={
          startDay > 1
            ? `Kỳ chốt tour từ ngày ${startDay} tháng này đến ngày ${startDay - 1} tháng sau (đổi ở Cài đặt) · có thể xem khoảng ngày bất kỳ`
            : "Tổng tiền tour mỗi KTV theo tháng · có thể xem khoảng ngày bất kỳ"
        }
        action={
          <>
            <Button variant="secondary" onClick={doExport} loading={exporting} disabled={!summary}>
              <Download className="h-4 w-4" /> Xuất Excel
            </Button>
            {isOwner && month ? (
              isLocked ? (
                <Button variant="dark" onClick={() => setConfirmLock("unlock")}>
                  <Unlock className="h-4 w-4" /> Mở sổ
                </Button>
              ) : (
                <Button onClick={() => setConfirmLock("lock")}>
                  <Lock className="h-4 w-4" /> Chốt sổ
                </Button>
              )
            ) : null}
          </>
        }
      />

      <PeriodPicker value={sel} onChange={setSel} startDay={startDay} currentPeriod={currentPeriod} className="mb-4 max-w-md" />

      {isLocked ? (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-gold/60 bg-champagne/30 px-4 py-2 text-sm text-gold-stronger">
          <Lock className="h-4 w-4" /> Kỳ đã chốt sổ lúc {formatDateTime(locked?.locked_at)} – không sửa / huỷ được tour của kỳ này.
        </p>
      ) : null}
      {!month ? (
        <p className="mb-4 rounded-xl border border-champagne bg-cream/60 px-4 py-2 text-sm text-mocha">
          Đang xem {label}. Chốt sổ và báo sai tính theo kỳ lương – chuyển sang “{startDay > 1 ? "Theo kỳ lương" : "Theo tháng"}” để chốt.
        </p>
      ) : null}

      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {!summary ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="border-b border-champagne bg-cream/60 text-mocha">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Kỹ thuật viên</th>
                      <th className="px-4 py-3 text-right font-semibold">Số tour</th>
                      <th className="px-4 py-3 text-right font-semibold">Tour chỉ định</th>
                      <th className="px-4 py-3 text-right font-semibold">Tổng tiền tour</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-champagne/60">
                    {summary.length === 0 ? (
                      <tr>
                        <td colSpan={5}>
                          <EmptyState title="Chưa có dữ liệu" />
                        </td>
                      </tr>
                    ) : (
                      summary.map((r) => (
                        <tr key={r.technician_id}>
                          <td className="px-4 py-3">
                            <span className="font-medium text-espresso">{r.full_name}</span>
                            {!r.is_active ? <Badge tone="off" className="ml-2">Đã khoá</Badge> : null}
                            {r.open_disputes > 0 ? <Badge tone="pending" className="ml-2">{r.open_disputes} báo sai</Badge> : null}
                          </td>
                          <td className="px-4 py-3 text-right tabular">{r.tours}</td>
                          <td className="px-4 py-3 text-right tabular">
                            {r.requested_tours}
                            {r.requested_amount ? <span className="block text-xs text-mocha"><Money value={r.requested_amount} /></span> : null}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Money value={r.amount} className="font-semibold text-espresso" />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button size="sm" variant="ghost" onClick={() => setDetailFor(r)}>
                              Chi tiết
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot className="border-t border-champagne bg-cream/40 font-semibold">
                    <tr>
                      <td className="px-4 py-3">Tổng</td>
                      <td className="px-4 py-3 text-right tabular">{totals.tours}</td>
                      <td />
                      <td className="px-4 py-3 text-right">
                        <Money value={totals.amount} />
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardBody>
          </Card>

          {month ? (
          <Card>
            <CardHeader title={`Yêu cầu báo sai (${openDisputes.length} đang chờ)`} />
            <CardBody>
              {disputes.length === 0 ? (
                <EmptyState title="Không có yêu cầu báo sai trong kỳ" />
              ) : (
                <ul className="space-y-2">
                  {disputes.map((d) => (
                    <li key={d.id} className="rounded-2xl border border-champagne bg-white/80 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-espresso">
                          {d.technician?.full_name} · {d.tour ? `${d.tour.code} (${d.tour.customer_name})` : "Cả kỳ"}
                        </span>
                        <Badge tone={d.status === "open" ? "pending" : d.status === "resolved" ? "free" : "off"}>
                          {d.status === "open" ? "Đang chờ" : d.status === "resolved" ? "Đã xử lý" : "Không chấp nhận"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-espresso">{d.message}</p>
                      <p className="text-xs text-mocha">{formatDateTime(d.created_at)}</p>
                      {d.admin_reply ? <p className="mt-1 text-mocha">Trả lời: {d.admin_reply}</p> : null}
                      {d.status === "open" && isOwner ? (
                        <Button size="sm" variant="secondary" className="mt-2" onClick={() => setResolving(d)}>
                          Xử lý
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          ) : null}
        </div>
      )}

      <Dialog open={!!detailFor} onOpenChange={(v) => !v && setDetailFor(null)} title={`Chi tiết – ${detailFor?.full_name ?? ""}`} size="lg">
        <ul className="divide-y divide-champagne/60">
          {lines
            .filter((l) => l.technician_id === detailFor?.technician_id)
            .map((l) => (
              <li key={l.assignment_id} className="flex items-start justify-between gap-3 py-2 text-sm">
                <div>
                  <p className="font-medium text-espresso">
                    {formatDate(l.work_date)} {formatTime(l.completed_at)} · {l.code} · {l.customer_name}
                    {l.is_requested ? <Star className="ml-1 inline h-3.5 w-3.5 fill-gold text-gold" /> : null}
                  </p>
                  <p className="text-mocha">
                    {l.services}
                    {(l.team_size ?? 1) > 1 ? ` · ${l.share_percent}% của ${(l.tour_total ?? 0).toLocaleString("vi-VN")} ₫` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <Money value={l.amount} className="font-semibold" />
                  <button
                    type="button"
                    className="block text-xs font-medium text-gold-strong hover:underline"
                    onClick={() => l.tour_id && lookup.open({ id: l.tour_id })}
                  >
                    Mở tour
                  </button>
                </div>
              </li>
            ))}
        </ul>
      </Dialog>

      <ConfirmDialog
        open={confirmLock === "lock"}
        onOpenChange={(v) => !v && setConfirmLock(null)}
        title={`Chốt sổ ${label}?`}
        description={
          openDisputes.length > 0
            ? `Còn ${openDisputes.length} yêu cầu báo sai chưa xử lý. Sau khi chốt, tour của kỳ không sửa/huỷ được nữa.`
            : "Sau khi chốt, tour của kỳ không sửa/huỷ được nữa (chỉ chủ spa mở lại sổ)."
        }
        confirmLabel="Chốt sổ"
        onConfirm={async () => {
          if (!month) return;
          const { error: err } = await getSupabaseBrowser().rpc("lock_month", { p_month: month });
          if (err) throw new Error(errorMessage(err));
          toast.success(`Đã chốt sổ ${label}`);
          load();
        }}
      />
      <ConfirmDialog
        open={confirmLock === "unlock"}
        onOpenChange={(v) => !v && setConfirmLock(null)}
        title={`Mở lại sổ ${label}?`}
        description="Thao tác được ghi vào nhật ký."
        confirmLabel="Mở sổ"
        tone="danger"
        requireReason
        onConfirm={async (reason) => {
          if (!month) return;
          const { error: err } = await getSupabaseBrowser().rpc("unlock_month", { p_month: month, p_reason: reason });
          if (err) throw new Error(errorMessage(err));
          toast.success("Đã mở lại sổ");
          load();
        }}
      />
      <ResolveDisputeDialog dispute={resolving} onClose={() => setResolving(null)} onDone={load} />
      {lookup.dialog(() => void load())}
    </div>
  );
}

function ResolveDisputeDialog({ dispute, onClose, onDone }: { dispute: Dispute | null; onClose: () => void; onDone: () => void }) {
  if (!dispute) return null;
  return <ResolveDisputeBody key={dispute.id} dispute={dispute} onClose={onClose} onDone={onDone} />;
}

function ResolveDisputeBody({ dispute, onClose, onDone }: { dispute: Dispute; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState<"resolved" | "rejected" | null>(null);

  const act = async (status: "resolved" | "rejected") => {
    setBusy(status);
    const { error } = await getSupabaseBrowser().rpc("resolve_dispute", { p_id: dispute.id, p_status: status, p_reply: reply });
    setBusy(null);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    toast.success("Đã cập nhật yêu cầu");
    onClose();
    onDone();
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Xử lý báo sai"
      description={`${dispute.technician?.full_name}: ${dispute.message}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => act("rejected")} loading={busy === "rejected"} disabled={!!busy}>
            Không chấp nhận
          </Button>
          <Button onClick={() => act("resolved")} loading={busy === "resolved"} disabled={!!busy}>
            Đã xử lý
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-mocha">
        Nếu cần chỉnh tiền: mở tour trên Bảng điều phối hoặc Nhật ký, dùng “Sửa” / “Đổi KTV” (có lý do) trước khi đánh dấu đã xử lý.
      </p>
      <Field label="Trả lời KTV">{(p) => <Textarea {...p} value={reply} onChange={(e) => setReply(e.target.value)} />}</Field>
    </Dialog>
  );
}
