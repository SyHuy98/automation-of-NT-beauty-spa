"use client";

import * as RD from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  dismissible?: boolean;
}) {
  const width = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" }[size];
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-espresso/40 backdrop-blur-[2px] animate-fade-in" />
        <RD.Content
          onPointerDownOutside={(e) => !dismissible && e.preventDefault()}
          onEscapeKeyDown={(e) => {
            // Ô có danh sách xổ xuống đang mở (data-esc-local) tự xử lý Esc – không đóng cả hộp thoại
            const local = document.activeElement?.closest?.('[data-esc-local="true"]');
            if (!dismissible || local) e.preventDefault();
          }}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] w-full overflow-hidden rounded-t-3xl border border-champagne bg-ivory shadow-lift animate-slide-up",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl",
            width,
          )}
        >
          <div className="flex max-h-[92dvh] flex-col">
            <div className="flex items-start justify-between gap-4 border-b border-champagne/60 px-5 py-4">
              <div>
                <RD.Title className="font-serif text-xl font-semibold text-espresso">{title}</RD.Title>
                {description ? (
                  <RD.Description className="mt-0.5 text-sm text-mocha">{description}</RD.Description>
                ) : (
                  <RD.Description className="sr-only">{typeof title === "string" ? title : "Hộp thoại"}</RD.Description>
                )}
              </div>
              {dismissible ? (
                <RD.Close className="rounded-lg p-1.5 text-mocha hover:bg-cream" aria-label="Đóng">
                  <X className="h-5 w-5" />
                </RD.Close>
              ) : null}
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer ? (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-champagne/60 bg-cream/40 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                {footer}
              </div>
            ) : null}
          </div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
