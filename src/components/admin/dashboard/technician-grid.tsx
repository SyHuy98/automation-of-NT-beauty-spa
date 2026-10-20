"use client";

import { Clock, LogIn, LogOut, Star } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/form";
import { Avatar, Money, StatusBadge } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { errorMessage, formatDuration, formatTime, SHIFT_LABEL } from "@/lib/format";
import { useQuery } from "@/lib/hooks/use-query";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { techStatus, TECH_STATUS_LABEL, type DashboardTechnician, type TechStatus } from "@/types/app";

const ORDER: TechStatus[] = ["free", "pending", "busy", "off"];

export function TechnicianGrid({
  technicians,
  now,
  onRefresh,
  onOpenTour,
}: {
  technicians: DashboardTechnician[];
  now: number;
  onRefresh: () => void;
  onOpenTour: (tourId: string) => void;
}) {
  const [checkInFor, setCheckInFor] = useState<DashboardTechnician | null>(null);
  const toast = useToast();
  // Ảnh đại diện (tải riêng, tải lại khi danh sách KTV thay đổi)
  const avatars = useQuery(async () => {
    const { data } = await getSupabaseBrowser().from("profiles").select("id, avatar_url").eq("role", "technician");
    return new Map((data ?? []).map((p) => [p.id, p.avatar_url]));
  }, [technicians.map((t) => t.id).join(",")]).data;

  const groups = ORDER.map((status) => ({
    status,
    items: technicians.filter((t) => techStatus(t) === status),
  }));

  const checkOut = async (t: DashboardTechnician) => {
    const { error } = await getSupabaseBrowser().rpc("admin_check_out", { p_technician_id: t.id });
    if (error) toast.error(errorMessage(error));
    else {
      toast.success(`${t.fullName} đã ra ca`);
      onRefresh();
    }
  };

  if (technicians.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-champagne bg-white/50 p-8 text-center text-mocha">
        Chưa có Kỹ thuật viên nào. Vào mục <strong>Kỹ thuật viên</strong> để tạo tài khoản.
      </div>
    );
  }

  return (
    <section aria-labelledby="tech-grid-title" className="space-y-4">
      <h2 id="tech-grid-title" className="sr-only">
        Trạng thái Kỹ thuật viên
      </h2>
      <div className="flex flex-wrap gap-2 text-sm">
        {groups.map((g) => (
          <span key={g.status} className="inline-flex items-center gap-2">
            <StatusBadge status={g.status} label={`${TECH_STATUS_LABEL[g.status]}: ${g.items.length}`} />
          </span>
        ))}
      </div>
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <div key={g.status}>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-mocha">{TECH_STATUS_LABEL[g.status]}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {g.items.map((t) => (
                <TechCard
                  key={t.id}
                  t={t}
                  avatarUrl={avatars?.get(t.id) ?? null}
                  status={g.status}
                  now={now}
                  onCheckIn={() => setCheckInFor(t)}
                  onCheckOut={() => checkOut(t)}
                  onOpenTour={onOpenTour}
                />
              ))}
            </div>
          </div>
        ))}
      <CheckInDialog tech={checkInFor} onClose={() => setCheckInFor(null)} onDone={onRefresh} />
    </section>
  );
}

function TechCard({
  t,
  avatarUrl,
  status,
  now,
  onCheckIn,
  onCheckOut,
  onOpenTour,
}: {
  t: DashboardTechnician;
  avatarUrl: string | null;
  status: TechStatus;
  now: number;
  onCheckIn: () => void;
  onCheckOut: () => void;
  onOpenTour: (id: string) => void;
}) {
  const shiftLabel = t.checkin
    ? SHIFT_LABEL[t.checkin.shift]
    : t.scheduledShift
      ? `Lịch: ${SHIFT_LABEL[t.scheduledShift].toLowerCase()}`
      : "Chưa xếp ca";
  const checkedOut = t.checkin?.checkOutAt;

  let detail: React.ReactNode = null;
  if (t.offer) {
    const left = Date.parse(t.offer.expiresAt) - now;
    detail = (
      <button type="button" onClick={() => onOpenTour(t.offer!.tourId)} className="w-full text-left">
        <p className="text-sm text-espresso">
          Đang mời <strong>{t.offer.code}</strong> · {t.offer.customerName}
        </p>
        <p className={cn("tabular text-sm font-semibold", left < 20_000 ? "text-busy-ink" : "text-pending-ink")}>
          Còn {formatDuration(left / 1000)}
        </p>
      </button>
    );
  } else if (t.work) {
    const startedMs = t.work.startedAt ? Date.parse(t.work.startedAt) : null;
    const remaining = startedMs ? startedMs + t.work.durationMinutes * 60_000 - now : null;
    detail = (
      <button type="button" onClick={() => onOpenTour(t.work!.tourId)} className="w-full text-left">
        <p className="truncate text-sm text-espresso">
          <strong>{t.work.code}</strong> · {t.work.services}
          {t.work.isRequested ? <Star className="ml-1 inline h-3.5 w-3.5 fill-gold text-gold" aria-label="Chỉ định" /> : null}
        </p>
        {t.work.status === "accepted" ? (
          <p className="text-sm text-pending-ink">Đã nhận – chờ KTV còn lại</p>
        ) : remaining !== null ? (
          <p className={cn("tabular flex items-center gap-1 text-sm font-semibold", remaining < 0 ? "text-busy-ink" : "text-mocha")}>
            <Clock className="h-3.5 w-3.5" />
            Bắt đầu {formatTime(t.work.startedAt)} ·{" "}
            {remaining < 0 ? `Quá giờ ${formatDuration(-remaining / 1000)}` : `Còn ${formatDuration(remaining / 1000)}`}
          </p>
        ) : null}
      </button>
    );
  } else if (status === "free" && t.checkin) {
    const since = Math.max(Date.parse(t.checkin.checkInAt), t.lastTourEndedAt ? Date.parse(t.lastTourEndedAt) : 0);
    detail = <p className="text-sm text-free-ink">Rảnh {Math.max(0, Math.floor((now - since) / 60_000))} phút</p>;
  } else if (status === "off") {
    detail = (
      <p className="text-sm text-mocha">
        {checkedOut ? `Đã ra ca lúc ${formatTime(checkedOut)}` : t.scheduledShift === "off" ? "Lịch: nghỉ hôm nay" : "Chưa vào ca"}
      </p>
    );
  }

  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-2xl border bg-white/80 p-4 shadow-soft transition-shadow hover:shadow-lift",
        status === "busy" && "border-busy/30",
        status === "pending" && "border-pending/50",
        status === "free" && "border-free/40",
        status === "off" && "border-champagne/70 opacity-90",
      )}
    >
      <div className="flex items-center gap-3">
        <Avatar name={t.fullName} src={avatarUrl} status={status} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-espresso">{t.fullName}</p>
          <p className="text-xs text-mocha">{shiftLabel}</p>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="min-h-10">{detail}</div>
      <div className="flex items-center justify-between border-t border-champagne/60 pt-2 text-sm">
        <span className="text-mocha">
          Hôm nay <Money value={t.todayAmount} className="font-semibold text-espresso" /> · {t.todayTours} tour
        </span>
        {status === "off" ? (
          <Button size="sm" variant="ghost" onClick={onCheckIn} aria-label={`Vào ca thay cho ${t.fullName}`}>
            <LogIn className="h-4 w-4" /> Vào ca
          </Button>
        ) : status === "free" ? (
          <Button size="sm" variant="ghost" onClick={onCheckOut} aria-label={`Ra ca thay cho ${t.fullName}`}>
            <LogOut className="h-4 w-4" /> Ra ca
          </Button>
        ) : null}
      </div>
    </article>
  );
}

type WorkShift = "morning" | "afternoon" | "full";

function CheckInDialog({ tech, onClose, onDone }: { tech: DashboardTechnician | null; onClose: () => void; onDone: () => void }) {
  if (!tech) return null;
  return <CheckInBody key={tech.id} tech={tech} onClose={onClose} onDone={onDone} />;
}

function CheckInBody({ tech, onClose, onDone }: { tech: DashboardTechnician; onClose: () => void; onDone: () => void }) {
  // chọn sẵn theo Lịch ca hôm nay nếu đã xếp; chưa xếp thì admin chọn
  const [shift, setShift] = useState<WorkShift | null>(
    tech.scheduledShift && tech.scheduledShift !== "off" ? tech.scheduledShift : null,
  );
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async () => {
    if (!shift) return;
    setBusy(true);
    const { error } = await getSupabaseBrowser().rpc("admin_check_in", { p_technician_id: tech.id, p_shift: shift });
    setBusy(false);
    if (error) toast.error(errorMessage(error));
    else {
      toast.success(`${tech.fullName} đã vào ca`);
      onDone();
      onClose();
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Vào ca thay cho ${tech.fullName}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Huỷ bỏ
          </Button>
          <Button onClick={submit} loading={busy} disabled={!shift}>
            Vào ca
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-mocha">Dùng khi KTV quên điện thoại. Chọn ca làm hôm nay:</p>
      <Segmented<WorkShift>
        ariaLabel="Ca làm"
        value={shift}
        onChange={setShift}
        options={[
          { value: "morning", label: SHIFT_LABEL.morning },
          { value: "afternoon", label: SHIFT_LABEL.afternoon },
          { value: "full", label: SHIFT_LABEL.full },
        ]}
      />
    </Dialog>
  );
}
