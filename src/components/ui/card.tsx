import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-[var(--radius-card)] border border-champagne/70 bg-white/70 shadow-soft", className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 px-5 pt-5", className)}>
      <div className="min-w-0">
        <h2 className="font-serif text-lg font-semibold text-espresso">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-sm text-mocha">{subtitle}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-espresso md:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-mocha">{subtitle}</p> : null}
        <div className="mt-3 h-px w-16 bg-gold" aria-hidden="true" />
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function EmptyState({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      {icon ? <div className="mb-1 text-gold">{icon}</div> : null}
      <p className="font-medium text-espresso">{title}</p>
      {hint ? <p className="max-w-sm text-sm text-mocha">{hint}</p> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-busy/30 bg-busy/5 px-4 py-3 text-sm text-busy-ink">
      <p>{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-1 font-semibold underline underline-offset-2">
          Thử lại
        </button>
      ) : null}
    </div>
  );
}
