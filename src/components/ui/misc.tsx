import type { ReactNode } from "react";
import { formatMoney, initials } from "@/lib/format";
import { TECH_STATUS_LABEL, type TechStatus } from "@/types/app";
import { cn } from "./cn";

export function Money({ value, className }: { value: number | null | undefined; className?: string }) {
  return <span className={cn("tabular whitespace-nowrap", className)}>{formatMoney(value)}</span>;
}

const statusDot: Record<TechStatus, string> = {
  free: "bg-free",
  pending: "bg-pending",
  busy: "bg-busy",
  off: "bg-off",
};
const statusInk: Record<TechStatus, string> = {
  free: "text-free-ink bg-free/12 border-free/40",
  pending: "text-pending-ink bg-pending/12 border-pending/50",
  busy: "text-busy-ink bg-busy/10 border-busy/40",
  off: "text-off-ink bg-off/10 border-off/40",
};

export function StatusDot({ status, pulse }: { status: TechStatus; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5" aria-hidden="true">
      {pulse ? <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", statusDot[status])} /> : null}
      <span className={cn("relative inline-block h-2.5 w-2.5 rounded-full", statusDot[status])} />
    </span>
  );
}

export function StatusBadge({ status, label }: { status: TechStatus; label?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold", statusInk[status])}>
      <StatusDot status={status} />
      {label ?? TECH_STATUS_LABEL[status]}
    </span>
  );
}

type BadgeTone = "gold" | "neutral" | "free" | "pending" | "busy" | "off";
const badgeTone: Record<BadgeTone, string> = {
  gold: "border-gold/60 bg-champagne/40 text-gold-stronger",
  neutral: "border-champagne bg-cream text-mocha",
  free: statusInk.free,
  pending: statusInk.pending,
  busy: statusInk.busy,
  off: statusInk.off,
};

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold", badgeTone[tone], className)}>
      {children}
    </span>
  );
}

export function Avatar({ name, status, size = "md" }: { name: string; status?: TechStatus; size?: "sm" | "md" | "lg" }) {
  const dims = { sm: "h-9 w-9 text-xs", md: "h-12 w-12 text-sm", lg: "h-16 w-16 text-lg" }[size];
  return (
    <span className="relative inline-flex shrink-0">
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-full border-2 border-gold bg-cream font-serif font-semibold text-gold-stronger",
          dims,
        )}
        aria-hidden="true"
      >
        {initials(name)}
      </span>
      {status ? (
        <span className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-ivory">
          <StatusDot status={status} pulse={status === "pending"} />
        </span>
      ) : null}
    </span>
  );
}

/** Logo chữ serif vàng */
export function Logo({ className, tone = "gold" }: { className?: string; tone?: "gold" | "light" }) {
  return (
    <span className={cn("inline-flex flex-col leading-none", className)}>
      <span className={cn("font-serif text-2xl font-semibold tracking-wide", tone === "gold" ? "text-gold" : "text-champagne")}>
        NT Beauty Spa
      </span>
      <span className={cn("mt-1 text-[10px] uppercase tracking-[0.3em]", tone === "gold" ? "text-mocha" : "text-cream/70")}>
        Phân tour · Kỹ thuật viên
      </span>
    </span>
  );
}

/** Họa tiết lá / đường cong mảnh màu vàng rất nhạt cho góc màn hình */
export function LeafOrnament({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 240 240" fill="none" aria-hidden="true">
      <path d="M10 230C40 140 110 70 230 10" stroke="#C9A96E" strokeOpacity="0.35" strokeWidth="1.2" />
      <path d="M40 230C70 160 130 100 230 50" stroke="#C9A96E" strokeOpacity="0.22" strokeWidth="1" />
      <path d="M95 140c-6-26 6-48 32-60-2 28-12 48-32 60z" stroke="#C9A96E" strokeOpacity="0.4" strokeWidth="1.2" />
      <path d="M135 100c-2-24 12-42 36-50-4 24-16 40-36 50z" stroke="#C9A96E" strokeOpacity="0.35" strokeWidth="1.2" />
      <path d="M60 180c-4-22 8-40 30-48-2 22-12 38-30 48z" stroke="#C9A96E" strokeOpacity="0.3" strokeWidth="1.2" />
      <circle cx="182" cy="40" r="3" fill="#C9A96E" fillOpacity="0.35" />
      <circle cx="120" cy="150" r="2" fill="#C9A96E" fillOpacity="0.3" />
    </svg>
  );
}

/** Vòng đếm ngược màu vàng chạy quanh */
export function CountdownRing({
  remainingMs,
  totalMs,
  size = 120,
  children,
}: {
  remainingMs: number;
  totalMs: number;
  size?: number;
  children?: ReactNode;
}) {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const ratio = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
  const urgent = remainingMs < 20_000;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#E8D5A8" strokeWidth="6" fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={urgent ? "#B5523B" : "#C9A96E"}
          strokeWidth="6"
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
          style={{ transition: "stroke-dashoffset 1s linear, stroke 300ms" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

export function ConnectionBanner({ state }: { state: "connecting" | "online" | "offline" }) {
  if (state === "online") return null;
  return (
    <div
      role="status"
      className={cn(
        "flex items-center justify-center gap-2 px-3 py-1.5 text-center text-sm font-medium",
        state === "offline" ? "bg-busy-ink text-white" : "bg-pending/20 text-pending-ink",
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", state === "offline" ? "bg-white" : "animate-pulse bg-pending")} />
      {state === "offline" ? "Mất kết nối – đang thử kết nối lại…" : "Đang kết nối…"}
    </div>
  );
}

export function Stat({ label, value, hint, className }: { label: string; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-champagne/70 bg-white/70 px-4 py-3 shadow-soft", className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-mocha">{label}</p>
      <p className="mt-1 font-serif text-2xl font-semibold text-espresso tabular">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-mocha">{hint}</p> : null}
    </div>
  );
}
