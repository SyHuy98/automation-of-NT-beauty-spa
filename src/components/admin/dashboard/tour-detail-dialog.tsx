"use client";

import { CheckCircle2, Pencil, Repeat, Send, Star, Undo2, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Segmented, Select, Textarea } from "@/components/ui/form";
import { Badge, Money } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import type { RankedCandidate } from "@/lib/assignment";
import {
  ASSIGN_MODE_LABEL,
  errorMessage,
  formatDateTime,
  formatDuration,
  formatTime,
  GENDER_LABEL,
  TOUR_STATUS_LABEL,
} from "@/lib/format";
import { useQuery } from "@/lib/hooks/use-query";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { reasonSchema } from "@/lib/validation/schemas";
import { techStatus, TECH_STATUS_LABEL, type DashboardTechnician, type DashboardTour, type Gender } from "@/types/app";
import type { Json } from "@/types/database";
import { useServices } from "../use-dashboard";
import { CandidateList } from "./candidate-list";
import { ServicePicker } from "./service-picker";
import { TOUR_STATUS_TONE } from "./tour-list";
import { useRanking } from "./use-ranking";

const ACTION_LABEL: Record<string, string> = {
  create: "Tạo tour",
  offer: "Gửi lời mời",
  accept: "KTV nhận",
  decline: "KTV từ chối",
  expire: "Hết giờ phản hồi",
  withdraw: "Thu hồi lời mời",
  complete: "Hoàn thành",
  edit: "Sửa tour",
  cancel: "Huỷ tour",
  reassign: "Đổi KTV",
};

interface LogRow {
  id: number;
  action: string;
  reason: string | null;
  created_at: string;
  after: Json | null;
  actor: { full_name: string } | null;
}

export function TourDetailDialog({
  tour,
  open,
  onOpenChange,
  technicians,
  now,
  onChanged,
}: {
  tour: DashboardTour | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  technicians: DashboardTechnician[];
  now: number;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<null | "complete" | "cancel">(null);
  const [offerOpen, setOfferOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [reassign, setReassign] = useState<DashboardTour["members"][number] | null>(null);

  const tourId = tour?.id ?? null;
  // Nhật ký của tour – tải lại khi trạng thái / người / lời mời thay đổi
  const logsQuery = useQuery(async () => {
    if (!open || !tourId) return [] as LogRow[];
    const { data } = await getSupabaseBrowser()
      .from("tour_audit_logs")
      .select("id, action, reason, created_at, after, actor:profiles!tour_audit_logs_actor_id_fkey(full_name)")
      .eq("tour_id", tourId)
      .order("created_at", { ascending: true });
    return (data as unknown as LogRow[]) ?? [];
  }, [open, tourId, tour?.status, tour?.members.length, tour?.pendingOffers.length]);
  const logs = logsQuery.data ?? [];

  if (!tour) return null;

  const done = () => {
    onChanged();
    logsQuery.refetch();
  };

  const rpc = async (fn: () => PromiseLike<{ error: unknown }>, success: string) => {
    const { error } = await fn();
    if (error) throw new Error(errorMessage(error));
    toast.success(success);
    done();
  };

  const supabase = getSupabaseBrowser();
  const isOpenTour = tour.status === "waiting" || tour.status === "offered";
  const canSendMore = isOpenTour && tour.members.length + tour.pendingOffers.length < tour.teamSize;
  const techName = (id: string) => technicians.find((t) => t.id === id)?.fullName ?? "KTV";

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        size="lg"
        title={
          <span className="flex flex-wrap items-center gap-2">
            Tour {tour.code}
            <Badge tone={TOUR_STATUS_TONE[tour.status]}>{TOUR_STATUS_LABEL[tour.status]}</Badge>
            {tour.isRequested ? (
              <Badge tone="gold">
                <Star className="h-3 w-3 fill-gold-strong" /> Chỉ định
              </Badge>
            ) : null}
          </span>
        }
        description={`${ASSIGN_MODE_LABEL[tour.assignMode]} · tạo lúc ${formatTime(tour.createdAt)}`}
        footer={
          <div className="flex w-full flex-wrap justify-end gap-2">
            {tour.status !== "cancelled" ? (
              <Button variant="ghost" onClick={() => setConfirm("cancel")}>
                <XCircle className="h-4 w-4" /> Huỷ tour
              </Button>
            ) : null}
            {tour.status !== "cancelled" ? (
              <Button variant="secondary" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" /> Sửa
              </Button>
            ) : null}
            {canSendMore ? (
              <Button onClick={() => setOfferOpen(true)}>
                <Send className="h-4 w-4" /> Gửi cho KTV
              </Button>
            ) : null}
            {tour.status === "in_progress" ? (
              <Button variant="success" onClick={() => setConfirm("complete")}>
                <CheckCircle2 className="h-4 w-4" /> Hoàn thành thay
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="space-y-5">
          <section className="grid gap-3 sm:grid-cols-2">
            <Info
              label="Khách"
              value={`${tour.customerName} · khách ${GENDER_LABEL[tour.customerGender].toLowerCase()}${
                tour.allowAnyGender ? " (đồng ý KTV nữ)" : ""
              }`}
            />
            <Info label="Điện thoại" value={tour.customerPhone ?? "—"} />
            {tour.note ? <Info label="Ghi chú" value={tour.note} className="sm:col-span-2" /> : null}
            {tour.cancelledReason ? <Info label="Lý do huỷ" value={tour.cancelledReason} className="sm:col-span-2" /> : null}
            {tour.status === "waiting" && tour.requestedTechnicianName ? (
              <Info label="Đang chờ" value={`${tour.requestedTechnicianName} rảnh để tự gửi lời mời`} className="sm:col-span-2" />
            ) : null}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-mocha">Dịch vụ</h3>
            <ul className="divide-y divide-champagne/60 rounded-xl border border-champagne bg-white/70">
              {tour.items.map((i, idx) => (
                <li key={idx} className="flex justify-between px-3 py-2 text-sm">
                  <span>
                    {i.name} <span className="text-mocha">· {i.duration} phút</span>
                  </span>
                  <Money value={i.fee} />
                </li>
              ))}
              <li className="flex justify-between bg-cream/60 px-3 py-2 text-sm font-semibold">
                <span>Tổng ({tour.durationMinutes} phút)</span>
                <Money value={tour.totalFee} />
              </li>
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-mocha">Kỹ thuật viên</h3>
            {tour.members.length === 0 && tour.pendingOffers.length === 0 ? (
              <p className="text-sm text-mocha">Chưa có ai – bấm “Gửi cho KTV”.</p>
            ) : null}
            <ul className="space-y-2">
              {tour.members.map((m) => (
                <li key={m.assignmentId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-champagne bg-white/80 px-3 py-2">
                  <div className="text-sm">
                    <span className="font-semibold">{m.name}</span>
                    <span className="text-mocha">
                      {" "}
                      · {m.sharePercent}% · {m.status === "accepted" ? "đã nhận, chờ người còn lại" : m.status === "working" ? "đang làm" : "đã xong"}
                    </span>
                    {tour.status === "completed" ? (
                      <span className="text-mocha">
                        {" "}
                        · <Money value={m.amount} className="font-semibold text-espresso" />
                      </span>
                    ) : null}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setReassign(m)}>
                    <Repeat className="h-4 w-4" /> Đổi KTV
                  </Button>
                </li>
              ))}
              {tour.pendingOffers.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-pending/50 bg-pending/5 px-3 py-2">
                  <span className="text-sm">
                    Đang mời <strong>{o.name}</strong> ({o.sharePercent}%) · còn{" "}
                    <span className="tabular font-semibold">{formatDuration((Date.parse(o.expiresAt) - now) / 1000)}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      rpc(() => supabase.rpc("withdraw_offer", { p_offer_id: o.id }), `Đã thu hồi lời mời của ${o.name}`).catch((e) =>
                        toast.error((e as Error).message),
                      )
                    }
                  >
                    <Undo2 className="h-4 w-4" /> Thu hồi
                  </Button>
                </li>
              ))}
            </ul>
            {tour.startedAt ? (
              <p className="mt-2 text-sm text-mocha">
                Bắt đầu {formatTime(tour.startedAt)}
                {tour.completedAt ? ` · hoàn thành ${formatTime(tour.completedAt)}` : ""}
              </p>
            ) : null}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-mocha">Nhật ký</h3>
            <ol className="space-y-1.5 border-l-2 border-champagne pl-4">
              {logs.map((l) => (
                <li key={l.id} className="text-sm">
                  <span className="text-mocha">{formatDateTime(l.created_at)}</span> ·{" "}
                  <strong>{ACTION_LABEL[l.action] ?? l.action}</strong>
                  {logTarget(l, techName)}
                  {l.actor ? <span className="text-mocha"> · bởi {l.actor.full_name}</span> : <span className="text-mocha"> · hệ thống</span>}
                  {l.reason ? <span className="block text-mocha">Lý do: {l.reason}</span> : null}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirm === "complete"}
        onOpenChange={(v) => !v && setConfirm(null)}
        title="Hoàn thành tour thay KTV?"
        description={`Tour ${tour.code} sẽ chuyển sang Hoàn thành và tiền tour được cộng cho KTV.`}
        confirmLabel="Hoàn thành"
        tone="success"
        onConfirm={() => rpc(() => supabase.rpc("complete_tour", { p_tour_id: tour.id }), `Đã hoàn thành tour ${tour.code}`)}
      />
      <ConfirmDialog
        open={confirm === "cancel"}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={`Huỷ tour ${tour.code}?`}
        description="Lời mời đang chờ sẽ bị thu hồi, KTV đang làm được giải phóng. Thao tác được ghi vào nhật ký."
        confirmLabel="Huỷ tour"
        tone="danger"
        requireReason
        onConfirm={(reason) =>
          rpc(() => supabase.rpc("cancel_tour", { p_tour_id: tour.id, p_reason: reason }), `Đã huỷ tour ${tour.code}`)
        }
      />
      <SendOfferDialog
        open={offerOpen}
        onOpenChange={setOfferOpen}
        tour={tour}
        onSent={() => {
          setOfferOpen(false);
          done();
        }}
      />
      <EditTourDialog open={editOpen} onOpenChange={setEditOpen} tour={tour} onSaved={done} />
      <ReassignDialog member={reassign} onClose={() => setReassign(null)} tour={tour} technicians={technicians} onSaved={done} />
    </>
  );
}

function logTarget(l: LogRow, techName: (id: string) => string) {
  const after = l.after as { technician_id?: string; technicians?: string[] } | null;
  if (after?.technician_id) return <span> · {techName(after.technician_id)}</span>;
  return null;
}

function Info({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <p className="text-xs font-medium uppercase tracking-wide text-mocha">{label}</p>
      <p className="text-[15px] text-espresso">{value}</p>
    </div>
  );
}

function SendOfferDialog({
  open,
  onOpenChange,
  tour,
  onSent,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tour: DashboardTour;
  onSent: () => void;
}) {
  const toast = useToast();
  const serviceIds = tour.items.map((i) => i.serviceId).filter(Boolean) as string[];
  const ranking = useRanking(serviceIds, tour.id, open);
  const [busy, setBusy] = useState<string | null>(null);
  const openShare = 100 - tour.members.reduce((s, m) => s + m.sharePercent, 0) - tour.pendingOffers.reduce((s, o) => s + o.sharePercent, 0);

  const send = async (c: RankedCandidate) => {
    setBusy(c.technicianId);
    const { data, error } = await getSupabaseBrowser().rpc("send_offer", {
      p_tour_id: tour.id,
      p_technician_id: c.technicianId,
      p_share_percent: tour.teamSize === 1 ? 100 : openShare,
    });
    setBusy(null);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    const res = data as { queued?: boolean; reason?: string };
    if (res?.queued) toast.warning(`${c.fullName} đang bận (${res.reason}) – sẽ tự gửi khi rảnh`);
    else toast.success(`Đã gửi lời mời cho ${c.fullName}`);
    onSent();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Gửi tour ${tour.code} cho KTV`} size="md">
      {tour.teamSize === 2 ? <p className="mb-3 text-sm text-mocha">Phần chia tiền còn lại: {openShare}%</p> : null}
      <CandidateList
        result={ranking.result}
        loading={ranking.loading}
        error={ranking.error}
        onReload={ranking.reload}
        actionLabel="Gửi"
        onAction={send}
        actionBusyId={busy}
      />
    </Dialog>
  );
}

function EditTourDialog(props: Parameters<typeof EditTourBody>[0]) {
  if (!props.open) return null;
  return <EditTourBody key={props.tour.id} {...props} />;
}

function EditTourBody({
  open,
  onOpenChange,
  tour,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tour: DashboardTour;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { services } = useServices();
  const [name, setName] = useState(tour.customerName);
  const [phone, setPhone] = useState(tour.customerPhone ?? "");
  const [gender, setGender] = useState<Gender>(tour.customerGender);
  const [allowFemale, setAllowFemale] = useState(tour.allowAnyGender);
  const [note, setNote] = useState(tour.note ?? "");
  const [serviceIds, setServiceIds] = useState<string[]>(() => tour.items.map((i) => i.serviceId).filter(Boolean) as string[]);
  const [shares, setShares] = useState<Record<string, number>>(() =>
    Object.fromEntries(tour.members.map((m) => [m.technicianId, m.sharePercent])),
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const r = reasonSchema.safeParse(reason);
    if (!r.success) {
      setError(r.error.issues[0].message);
      return;
    }
    if (serviceIds.length === 0) {
      setError("Tour phải có ít nhất 1 dịch vụ");
      return;
    }
    const p: Record<string, unknown> = { customer_name: name, customer_phone: phone, note };
    if (gender !== tour.customerGender) p.customer_gender = gender;
    const allowAny = gender === "male" && allowFemale;
    if (allowAny !== tour.allowAnyGender) p.allow_any_gender = allowAny;
    const original = (tour.items.map((i) => i.serviceId) as string[]).join(",");
    if (serviceIds.join(",") !== original) p.service_ids = serviceIds;
    if (tour.members.length > 1) {
      const total = Object.values(shares).reduce((a, b) => a + b, 0);
      if (total !== 100) {
        setError("Tổng tỷ lệ chia phải bằng 100%");
        return;
      }
      p.shares = Object.entries(shares).map(([technician_id, share_percent]) => ({ technician_id, share_percent }));
    }
    setBusy(true);
    const { error: err } = await getSupabaseBrowser().rpc("edit_tour", { p_tour_id: tour.id, p: p as Json, p_reason: r.data });
    setBusy(false);
    if (err) {
      setError(errorMessage(err));
      return;
    }
    toast.success(`Đã sửa tour ${tour.code}`);
    onOpenChange(false);
    onSaved();
  };

  // dịch vụ đã ẩn nhưng đang có trong tour vẫn phải hiện để giữ nguyên
  const pickerServices = (services ?? []).concat(
    tour.items
      .filter((i) => i.serviceId && !(services ?? []).some((s) => s.id === i.serviceId))
      .map((i) => ({
        id: i.serviceId!,
        name: `${i.name} (đã ẩn)`,
        tour_fee: i.fee,
        duration_minutes: i.duration,
        requires_skill: false,
        any_gender: false,
        is_active: false,
        sort_order: 9999,
        created_at: "",
        updated_at: "",
      })),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Sửa tour ${tour.code}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Huỷ bỏ
          </Button>
          <Button onClick={save} loading={busy}>
            Lưu thay đổi
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tên khách" required>
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Số điện thoại">
            {(p) => <Input {...p} value={phone} onChange={(e) => setPhone(e.target.value)} />}
          </Field>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-mocha">Khách</p>
          <Segmented<Gender>
            ariaLabel="Giới tính khách"
            value={gender}
            onChange={setGender}
            options={[
              { value: "female", label: "Khách nữ" },
              { value: "male", label: "Khách nam" },
            ]}
          />
          {gender === "male" ? (
            <div className="mt-2">
              <Checkbox checked={allowFemale} onChange={setAllowFemale} label="Khách đồng ý để KTV nữ làm" />
            </div>
          ) : null}
        </div>
        <Field label="Ghi chú">{(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-16" />}</Field>
        <div>
          <p className="mb-2 text-sm font-medium text-mocha">Dịch vụ (dịch vụ cũ giữ giá đã chụp, dịch vụ thêm mới lấy giá hiện tại)</p>
          <ServicePicker services={services ? pickerServices : null} selected={serviceIds} onChange={setServiceIds} />
        </div>
        {tour.members.length > 1 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {tour.members.map((m) => (
              <Field key={m.technicianId} label={`Tỷ lệ của ${m.name} (%)`}>
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min={1}
                    max={99}
                    value={shares[m.technicianId] ?? 0}
                    onChange={(e) => setShares((s) => ({ ...s, [m.technicianId]: Number(e.target.value) || 0 }))}
                  />
                )}
              </Field>
            ))}
          </div>
        ) : null}
        <Field label="Lý do sửa" required error={error}>
          {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-16" />}
        </Field>
      </div>
    </Dialog>
  );
}

type Member = DashboardTour["members"][number];

function ReassignDialog(props: Omit<Parameters<typeof ReassignBody>[0], "member"> & { member: Member | null }) {
  if (!props.member) return null;
  return <ReassignBody key={props.member.assignmentId} {...props} member={props.member} />;
}

function ReassignBody({
  member,
  onClose,
  tour,
  technicians,
  onSaved,
}: {
  member: Member;
  onClose: () => void;
  tour: DashboardTour;
  technicians: DashboardTechnician[];
  onSaved: () => void;
}) {
  const toast = useToast();
  const [newId, setNewId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const active = member.status === "accepted" || member.status === "working";

  const options = technicians.filter((t) => !tour.members.some((m) => m.technicianId === t.id));
  // khách nữ chỉ KTV nữ (trừ tour khách chỉ định / tour chỉ gồm dịch vụ không phân biệt giới tính)
  const { services } = useServices();
  const genderFree =
    tour.items.length > 0 && tour.items.every((i) => (services ?? []).some((s) => s.id === i.serviceId && s.any_gender));
  const womenOnly = tour.customerGender === "female" && !tour.isRequested && !genderFree;

  const save = async () => {
    if (!newId) {
      setError("Chọn KTV mới");
      return;
    }
    const r = reasonSchema.safeParse(reason);
    if (!r.success) {
      setError(r.error.issues[0].message);
      return;
    }
    setBusy(true);
    const { error: err } = await getSupabaseBrowser().rpc("reassign_technician", {
      p_assignment_id: member.assignmentId,
      p_new_technician_id: newId,
      p_reason: r.data,
    });
    setBusy(false);
    if (err) {
      setError(errorMessage(err));
      return;
    }
    toast.success("Đã đổi KTV");
    onClose();
    onSaved();
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Đổi KTV thay cho ${member.name}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Huỷ bỏ
          </Button>
          <Button onClick={save} loading={busy}>
            Đổi KTV
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-mocha">
          {active
            ? "Tour đang chạy: KTV mới phải đang Rảnh và sẽ tiếp tục tour ngay (không cần xác nhận)."
            : "Sửa người thực hiện cho tour đã xong – tiền tour sẽ được tính lại cho KTV mới."}
        </p>
        <Field label="KTV mới" required>
          {(p) => (
            <Select {...p} value={newId} onChange={(e) => setNewId(e.target.value)}>
              <option value="">— Chọn KTV —</option>
              {options.map((t) => (
                <option
                  key={t.id}
                  value={t.id}
                  disabled={(active && techStatus(t) !== "free") || (womenOnly && t.gender === "male")}
                >
                  {t.fullName} · {GENDER_LABEL[t.gender]} ({TECH_STATUS_LABEL[techStatus(t)]})
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Lý do" required error={error}>
          {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-16" />}
        </Field>
      </div>
    </Dialog>
  );
}
