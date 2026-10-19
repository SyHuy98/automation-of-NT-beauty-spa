"use client";

import { CheckCircle2, Clock, LogIn, LogOut, Star, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/form";
import { Money, StatusBadge } from "@/components/ui/misc";
import { LoadingBlock } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { errorMessage, formatDate, formatDuration, formatTime, SHIFT_LABEL } from "@/lib/format";
import { useNow } from "@/lib/hooks/use-now";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { ShiftType, TechStatus } from "@/types/app";
import { useKtvData } from "./ktv-data";

type WorkShift = Exclude<ShiftType, "off">;

export function KtvHome() {
  const { data, error, refetch } = useKtvData();
  const now = useNow(data?.now);
  const toast = useToast();
  const [shiftOpen, setShiftOpen] = useState(false);
  const [shift, setShift] = useState<WorkShift>("morning");
  const [busy, setBusy] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const [confirmDone, setConfirmDone] = useState(false);

  if (error && !data) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return <LoadingBlock />;

  const onShift = !!data.checkin && !data.checkin.checkOutAt;
  const status: TechStatus = data.work
    ? data.work.assignmentStatus === "working"
      ? "busy"
      : "pending"
    : data.offer
      ? "pending"
      : onShift
        ? "free"
        : "off";

  // Mở hộp vào ca: chọn sẵn ca theo lịch hôm nay (hoặc ca mặc định)
  const openCheckIn = () => {
    const s = data.scheduledShift !== "off" ? data.scheduledShift : data.profile.defaultShift !== "off" ? data.profile.defaultShift : "morning";
    setShift(s as WorkShift);
    setShiftOpen(true);
  };

  const doCheckIn = async () => {
    setBusy(true);
    const { error: err } = await getSupabaseBrowser().rpc("check_in", { p_shift: shift });
    setBusy(false);
    if (err) toast.error(errorMessage(err));
    else {
      toast.success(`Đã vào ${SHIFT_LABEL[shift].toLowerCase()}`);
      setShiftOpen(false);
      void refetch();
    }
  };

  const doCheckOut = async () => {
    const { error: err } = await getSupabaseBrowser().rpc("check_out");
    if (err) throw new Error(errorMessage(err));
    toast.success("Đã ra ca. Hẹn gặp lại!");
    void refetch();
  };

  const doComplete = async () => {
    if (!data.work) return;
    const { data: res, error: err } = await getSupabaseBrowser().rpc("complete_tour", { p_tour_id: data.work.tour.id });
    if (err) throw new Error(errorMessage(err));
    const r = res as { tour_completed?: boolean };
    toast.success(r?.tour_completed ? "Đã hoàn thành tour – tiền tour đã được cộng!" : "Đã xong phần của bạn – chờ KTV còn lại");
    void refetch();
  };

  const work = data.work;
  const startedMs = work?.tour.startedAt ? Date.parse(work.tour.startedAt) : null;
  const remaining = startedMs && work ? startedMs + work.tour.durationMinutes * 60_000 - now : null;

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-mocha">Xin chào,</p>
          <h1 className="font-serif text-2xl font-semibold text-espresso">{data.profile.fullName}</h1>
          <p className="text-sm text-mocha">
            {formatDate(data.today)} · Lịch: {SHIFT_LABEL[data.scheduledShift]}
          </p>
        </div>
        <StatusBadge status={status} label={status === "off" ? (data.checkin?.checkOutAt ? "Đã ra ca" : "Chưa vào ca") : undefined} />
      </header>

      {/* Vào ca / Ra ca */}
      <section className="rounded-3xl border border-champagne bg-white/80 p-4 shadow-soft">
        {onShift ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-espresso">{SHIFT_LABEL[data.checkin!.shift]}</p>
              <p className="text-sm text-mocha">Vào ca lúc {formatTime(data.checkin!.checkInAt)}</p>
            </div>
            <Button variant="secondary" size="lg" onClick={() => setConfirmOut(true)} disabled={!!data.offer}>
              <LogOut className="h-5 w-5" /> Ra ca
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {data.checkin?.checkOutAt ? (
              <p className="text-sm text-mocha">Bạn đã ra ca lúc {formatTime(data.checkin.checkOutAt)}.</p>
            ) : null}
            <Button size="xl" className="w-full" onClick={openCheckIn}>
              <LogIn className="h-6 w-6" /> {data.checkin ? "Vào ca lại" : "Vào ca"}
            </Button>
          </div>
        )}
      </section>

      {/* Tour đang làm */}
      {work ? (
        <section
          className={cn(
            "rounded-3xl border-2 bg-white/90 p-5 shadow-lift",
            work.assignmentStatus === "working" ? "border-busy/40" : "border-pending/60",
          )}
          aria-label="Tour đang làm"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold uppercase tracking-wide text-mocha">
              {work.assignmentStatus === "working" ? "Đang làm" : "Đã nhận – chờ KTV còn lại"}
            </p>
            <span className="text-sm text-mocha">{work.tour.code}</span>
          </div>
          <h2 className="mt-1 font-serif text-2xl font-semibold text-espresso">
            {work.tour.customerName}
            {work.tour.isRequested ? <Star className="ml-2 inline h-5 w-5 fill-gold text-gold" aria-label="Chỉ định" /> : null}
          </h2>
          <p className="text-[15px] text-espresso">{work.tour.items.map((i) => i.name).join(", ")}</p>
          {work.tour.note ? <p className="mt-1 text-sm text-mocha">Ghi chú: {work.tour.note}</p> : null}
          {work.tour.partners.length > 0 ? (
            <p className="mt-1 flex items-center gap-1 text-sm text-mocha">
              <Users className="h-4 w-4" /> Làm cùng {work.tour.partners.map((p) => p.name).join(", ")} · bạn {work.sharePercent}%
            </p>
          ) : null}

          {remaining !== null ? (
            <div
              className={cn(
                "mt-4 flex items-center justify-between rounded-2xl px-4 py-3",
                remaining < 0 ? "bg-busy/10 text-busy-ink" : "bg-cream text-espresso",
              )}
            >
              <span className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4" /> Bắt đầu {formatTime(work.tour.startedAt)}
              </span>
              <span className="tabular font-serif text-2xl font-semibold">
                {remaining < 0 ? `+${formatDuration(-remaining / 1000)}` : formatDuration(remaining / 1000)}
              </span>
            </div>
          ) : null}
          {remaining !== null && remaining < 0 ? <p className="mt-1 text-sm text-busy-ink">Đã quá thời lượng dự kiến</p> : null}

          {work.assignmentStatus === "working" ? (
            <Button size="xl" variant="success" className="mt-4 w-full" onClick={() => setConfirmDone(true)}>
              <CheckCircle2 className="h-6 w-6" /> Hoàn thành
            </Button>
          ) : null}
        </section>
      ) : onShift && !data.offer ? (
        <section className="rounded-3xl border border-dashed border-free/60 bg-free/5 p-5 text-center">
          <p className="font-serif text-xl font-semibold text-free-ink">Bạn đang rảnh</p>
          <p className="mt-1 text-sm text-mocha">Giữ app mở hoặc bật thông báo để nhận tour mới ngay.</p>
        </section>
      ) : null}

      {/* Thu nhập */}
      <section className="grid grid-cols-2 gap-3" aria-label="Thu nhập">
        <div className="rounded-3xl border border-champagne bg-white/80 p-4 shadow-soft">
          <p className="text-sm text-mocha">Hôm nay</p>
          <Money value={data.todayAmount} className="mt-1 block font-serif text-2xl font-semibold text-espresso" />
          <p className="text-xs text-mocha">{data.todayTours} tour</p>
        </div>
        <div className="rounded-3xl border border-gold/60 bg-champagne/30 p-4 shadow-soft">
          <p className="text-sm text-mocha">Tháng này</p>
          <Money value={data.monthAmount} className="mt-1 block font-serif text-2xl font-semibold text-espresso" />
          <p className="text-xs text-mocha">{data.monthTours} tour</p>
        </div>
      </section>

      <Dialog
        open={shiftOpen}
        onOpenChange={setShiftOpen}
        title="Vào ca"
        size="sm"
        footer={
          <Button size="lg" className="w-full" onClick={doCheckIn} loading={busy}>
            Xác nhận vào ca
          </Button>
        }
      >
        {data.scheduledShift === "off" ? (
          <p className="mb-3 rounded-xl border border-pending/50 bg-pending/10 px-3 py-2 text-sm text-pending-ink">
            Lịch hôm nay của bạn là <strong>Nghỉ</strong>. Vẫn có thể vào ca nếu được quản lý đồng ý.
          </p>
        ) : null}
        <p className="mb-3 text-sm text-mocha">Chọn ca làm hôm nay:</p>
        <Segmented<WorkShift>
          ariaLabel="Ca làm"
          value={shift}
          onChange={setShift}
          options={(["morning", "afternoon", "full"] as WorkShift[]).map((s) => ({
            value: s,
            label: `${SHIFT_LABEL[s]} ${data.settings.shiftHours[s] ? `(${data.settings.shiftHours[s]!.start}–${data.settings.shiftHours[s]!.end})` : ""}`,
          }))}
        />
      </Dialog>

      <ConfirmDialog
        open={confirmOut}
        onOpenChange={setConfirmOut}
        title="Ra ca?"
        description={
          work
            ? "Bạn vẫn đang có tour – tour tiếp tục bình thường, chỉ là bạn sẽ không nhận thêm tour mới."
            : "Sau khi ra ca bạn sẽ không được gợi ý tour mới."
        }
        confirmLabel="Ra ca"
        onConfirm={doCheckOut}
      />
      <ConfirmDialog
        open={confirmDone}
        onOpenChange={setConfirmDone}
        title="Hoàn thành tour?"
        description={work ? `Xác nhận đã làm xong tour ${work.tour.code} cho ${work.tour.customerName}.` : undefined}
        confirmLabel="Đã hoàn thành"
        tone="success"
        onConfirm={doComplete}
      />
    </div>
  );
}
