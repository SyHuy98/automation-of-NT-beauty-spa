"use client";

import { Bell, Home, UserRound, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { ConnectionBanner } from "@/components/ui/misc";
import { KtvDataProvider, useKtvData } from "./ktv-data";
import { OfferPopup } from "./offer-popup";

const NAV = [
  { href: "/ktv", label: "Trang chính", icon: Home },
  { href: "/ktv/thu-nhap", label: "Thu nhập", icon: Wallet },
  { href: "/ktv/thong-bao", label: "Thông báo", icon: Bell },
  { href: "/ktv/tai-khoan", label: "Tài khoản", icon: UserRound },
];

export function KtvShell({ children }: { children: ReactNode }) {
  return (
    <KtvDataProvider>
      <Inner>{children}</Inner>
    </KtvDataProvider>
  );
}

function Inner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data, connection } = useKtvData();
  const unread = data?.unreadAnnouncements ?? 0;

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <div className="sticky top-0 z-30 pt-[env(safe-area-inset-top)]">
        <ConnectionBanner state={connection} />
      </div>
      <main className="flex-1 px-4 pb-28 pt-5">{children}</main>

      <nav
        aria-label="Điều hướng"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-champagne bg-ivory/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        <ul className="mx-auto grid max-w-lg grid-cols-4">
          {NAV.map((item) => {
            const active = item.href === "/ktv" ? pathname === "/ktv" : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex flex-col items-center gap-1 py-2.5 text-xs font-medium",
                    active ? "text-gold-strong" : "text-mocha",
                  )}
                >
                  {active ? <span className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-gold" aria-hidden="true" /> : null}
                  <span className="relative">
                    <Icon className="h-6 w-6" />
                    {item.href === "/ktv/thong-bao" && unread > 0 ? (
                      <span className="absolute -right-2.5 -top-1.5 min-w-5 rounded-full bg-busy-ink px-1.5 text-center text-[11px] font-bold leading-5 text-white">
                        {unread > 9 ? "9+" : unread}
                        <span className="sr-only"> thông báo chưa đọc</span>
                      </span>
                    ) : null}
                  </span>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <OfferPopup />
    </div>
  );
}
