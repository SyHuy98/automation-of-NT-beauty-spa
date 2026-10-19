"use client";

import { BellRing, Star, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Textarea } from "@/components/ui/form";
import { CountdownRing, Money } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { technicianAmount } from "@/lib/earnings";
import { playChime, vibrate } from "@/lib/alerts";
import { errorMessage, formatDuration, formatMinutes } from "@/lib/format";
import { useNow } from "@/lib/hooks/use-now";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { MySnapshot } from "@/types/app";
import { useKtvData } from "./ktv-data";

/**
 * Popup toàn màn hình khi có tour mới: chuông + rung, đếm ngược,
 * Chấp nhận / Từ chối (bắt buộc chọn lý do).
 */
export function OfferPopup() {
  const { data, refetch } = useKtvData();
  const offer = data?.offer ?? null;
  if (!data || !offer) return null;
  // key theo offer: offer mới → state (lý do từ chối, lỗi…) tự làm mới
  return <OfferCard key={offer.id} data={data} offer={offer} refetch={refetch} />;
}

function OfferCard({
  data,
  offer,
  refetch,
}: {
  data: MySnapshot;
  offer: NonNullable<MySnapshot["offer"]>;
  refetch: () => Promise<void>;
}) {
  const toast = useToast();
  const now = useNow(data.now, 250);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const expiredSent = useRef<string | null>(null);

  const remaining = Date.parse(offer.expiresAt) - now;
  const total = Date.parse(offer.expiresAt) - Date.parse(offer.offeredAt);

  // nhắc chuông mỗi 8 giây khi chưa phản hồi
  useEffect(() => {
    const id = setInterval(() => {
      playChime(1);
      vibrate([300, 120, 300]);
    }, 8000);
    return () => clearInterval(id);
  }, []);

  // Đếm về 0 → báo server xử lý hết giờ ngay (pg_cron cũng xử lý nếu điện thoại tắt)
  useEffect(() => {
    if (remaining > 0 || expiredSent.current === offer.id) return;
    expiredSent.current = offer.id;
    void getSupabaseBrowser()
      .rpc("expire_offer", { p_offer_id: offer.id })
      .then(() => {
        toast.warning("Lời mời đã hết giờ");
        void refetch();
      });
  }, [offer, remaining, refetch, toast]);

  const t = offer.tour;
  const myAmount = technicianAmount(t.totalFee, offer.sharePercent);
  const reasons = data.settings.declineReasons;
  const isOther = reason?.startsWith("Khác") ?? false;

  const accept = async () => {
    setBusy("accept");
    setError(null);
    const { data: res, error: err } = await getSupabaseBrowser().rpc("accept_offer", { p_offer_id: offer.id });
    setBusy(null);
    const r = res as { ok?: boolean; error?: string; started?: boolean } | null;
    if (err || !r?.ok) {
      setError(err ? errorMessage(err) : (r?.error ?? "Không nhận được tour"));
      void refetch();
      return;
    }
    toast.success(r.started ? `Đã nhận tour ${t.code} – bắt đầu làm!` : `Đã nhận tour ${t.code} – chờ KTV còn lại`);
    void refetch();
  };

  const decline = async () => {
    const finalReason = isOther ? `Khác: ${other.trim()}` : reason;
    if (!reason || (isOther && other.trim().length < 3)) {
      setError(isOther ? "Vui lòng ghi rõ lý do" : "Vui lòng chọn lý do từ chối");
      return;
    }
    setBusy("decline");
    const { error: err } = await getSupabaseBrowser().rpc("decline_offer", { p_offer_id: offer.id, p_reason: finalReason! });
    setBusy(null);
    if (err) {
      setError(errorMessage(err));
      return;
    }
    toast.show("Đã từ chối tour");
    void refetch();
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="offer-title"
      className="fixed inset-0 z-[60] flex items-end justify-center bg-espresso/55 backdrop-blur-sm sm:items-center"
    >
      <div className="flex max-h-dvh w-full max-w-lg animate-slide-up flex-col overflow-y-auto rounded-t-[2rem] border-2 border-gold bg-cream px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6 shadow-lift sm:rounded-[2rem]">
        <div className="flex items-center justify-center gap-2 text-gold-strong">
          <BellRing className="h-6 w-6 animate-bounce" />
          <p className="text-sm font-semibold uppercase tracking-[0.2em]">Tour mới</p>
        </div>

        <div className="mt-4 flex flex-col items-center text-center">
          <CountdownRing remainingMs={remaining} totalMs={total} size={128}>
            <span className={cn("tabular font-serif text-3xl font-semibold", remaining < 20_000 ? "text-busy-ink" : "text-espresso")}>
              {formatDuration(remaining / 1000)}
            </span>
            <span className="text-xs text-mocha">còn lại</span>
          </CountdownRing>

          <h2 id="offer-title" className="mt-4 font-serif text-2xl font-semibold text-espresso">
            {t.customerName}
          </h2>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2 text-sm text-mocha">
            <span>{t.code}</span>
            {t.isRequested ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-gold bg-champagne/50 px-2 py-0.5 font-semibold text-gold-stronger">
                <Star className="h-3.5 w-3.5 fill-gold-strong" /> Chỉ định
              </span>
            ) : null}
            {t.teamSize === 2 ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-champagne bg-white px-2 py-0.5">
                <Users className="h-3.5 w-3.5" /> 2 KTV · bạn {offer.sharePercent}%
              </span>
            ) : null}
          </div>
        </div>

        <ul className="mt-4 divide-y divide-champagne rounded-2xl border border-champagne bg-white/80">
          {t.items.map((i, idx) => (
            <li key={idx} className="flex justify-between px-4 py-2.5 text-[15px]">
              <span>{i.name}</span>
              <span className="text-mocha">{i.duration} phút</span>
            </li>
          ))}
        </ul>
        {t.note ? <p className="mt-2 rounded-xl bg-white/60 px-3 py-2 text-sm text-mocha">Ghi chú: {t.note}</p> : null}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white/80 px-4 py-3 text-center">
            <p className="text-xs text-mocha">Tiền tour của bạn</p>
            <Money value={myAmount} className="font-serif text-xl font-semibold text-espresso" />
          </div>
          <div className="rounded-2xl bg-white/80 px-4 py-3 text-center">
            <p className="text-xs text-mocha">Thời lượng</p>
            <p className="font-serif text-xl font-semibold text-espresso">{formatMinutes(t.durationMinutes)}</p>
          </div>
        </div>

        {error ? (
          <p role="alert" className="mt-3 rounded-xl border border-busy/40 bg-busy/5 px-3 py-2 text-sm text-busy-ink">
            {error}
          </p>
        ) : null}

        {declining ? (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-semibold text-espresso">Lý do từ chối</p>
            <div className="grid gap-2">
              {reasons.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  aria-pressed={reason === r}
                  className={cn(
                    "min-h-12 rounded-xl border px-4 text-left text-[15px]",
                    reason === r ? "border-gold-strong bg-gold-strong text-white" : "border-champagne bg-white",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            {isOther ? (
              <Textarea
                value={other}
                onChange={(e) => setOther(e.target.value)}
                placeholder="Ghi rõ lý do…"
                aria-label="Lý do khác"
                className="min-h-16"
                autoFocus
              />
            ) : null}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <Button size="xl" variant="ghost" onClick={() => setDeclining(false)} disabled={!!busy}>
                Quay lại
              </Button>
              <Button size="xl" variant="danger" onClick={decline} loading={busy === "decline"}>
                Gửi từ chối
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Button size="xl" variant="secondary" onClick={() => setDeclining(true)} disabled={!!busy}>
              Từ chối
            </Button>
            <Button size="xl" onClick={accept} loading={busy === "accept"} className="animate-pulse-ring">
              Chấp nhận
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
