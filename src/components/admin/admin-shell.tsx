"use client";

import {
  BookOpenText,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Settings,
  Sparkles,
  Users,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { logoutAction } from "@/app/actions/auth";
import { cn } from "@/components/ui/cn";
import { Dialog } from "@/components/ui/dialog";
import { Avatar, Logo } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { playAlert } from "@/lib/alerts";
import { ROLE_LABEL } from "@/lib/format";
import { useRealtime } from "@/lib/hooks/use-realtime";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { AvatarUploader } from "../shared/avatar-uploader";
import { useSession } from "../shared/session-context";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  ownerOnly?: boolean;
  /** lễ tân cũng thấy (lễ tân chỉ phân tour) */
  receptionist?: boolean;
  /** tên ngắn trên thanh điều hướng dưới (điện thoại) */
  short?: string;
  /** hiện thẳng trên thanh dưới của điện thoại (còn lại nằm trong "Thêm") */
  tab?: boolean;
}

const NAV: NavItem[] = [
  { href: "/admin", label: "Bảng điều phối", short: "Điều phối", icon: LayoutDashboard, receptionist: true, tab: true },
  { href: "/admin/ky-thuat-vien", label: "Kỹ thuật viên", short: "KTV", icon: Users, tab: true },
  { href: "/admin/lich-ca", label: "Lịch ca", icon: CalendarDays, tab: true },
  { href: "/admin/bang-gia", label: "Bảng giá dịch vụ", icon: Sparkles },
  { href: "/admin/thong-bao", label: "Thông báo", icon: Megaphone },
  { href: "/admin/chot-luong", label: "Chốt lương", icon: Wallet, tab: true },
  { href: "/admin/nhat-ky", label: "Nhật ký thao tác", icon: ClipboardList },
  { href: "/admin/cai-dat", label: "Cài đặt", icon: Settings, ownerOnly: true },
  { href: "/huong-dan", label: "Hướng dẫn", icon: BookOpenText, receptionist: true, tab: true },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const profile = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const toast = useToast();
  const lastAlertId = useRef<number | null>(null);

  // Cảnh báo cho admin (KTV từ chối / hết giờ / không còn ai rảnh): toast + âm thanh
  const checkAlerts = useCallback(async () => {
    const { data } = await getSupabaseBrowser()
      .from("admin_alerts")
      .select("id, message")
      .is("resolved_at", null)
      .order("id", { ascending: false })
      .limit(5);
    if (!data || data.length === 0) return;
    const newest = data[0].id;
    if (lastAlertId.current === null) {
      lastAlertId.current = newest; // lần đầu chỉ ghi nhận, không kêu
      return;
    }
    const fresh = data.filter((a) => a.id > (lastAlertId.current ?? 0));
    if (fresh.length > 0) {
      lastAlertId.current = newest;
      playAlert();
      fresh.reverse().forEach((a) => toast.warning(a.message));
    }
  }, [toast]);

  // cảnh báo nhỏ gọn → vẫn kiểm tra khi tab ẩn để chuông không bị lỡ
  useRealtime("admin-alerts", [{ table: "admin_alerts" }], checkAlerts, { pollMs: 20_000, pollHidden: true });

  const items = NAV.filter((i) =>
    profile.role === "receptionist" ? i.receptionist : !i.ownerOnly || profile.role === "owner",
  );

  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));
  // thanh dưới (điện thoại): tối đa 4 mục + "Thêm"
  const tabs = items.filter((i) => i.tab).slice(0, 4);
  const moreActive = items.some((i) => !tabs.includes(i) && isActive(i.href));

  const nav = (
    <nav aria-label="Điều hướng quản trị" className="flex flex-1 flex-col gap-1">
      {items.map((item) => {
        const active = isActive(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            onClick={() => setOpen(false)}
            className={cn(
              "relative flex items-center gap-3 rounded-xl px-4 py-3 text-[15px] transition-colors lg:py-2.5",
              active ? "bg-white/8 font-semibold text-champagne" : "text-cream/80 hover:bg-white/5 hover:text-cream",
            )}
          >
            {active ? <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-gold" aria-hidden="true" /> : null}
            <Icon className={cn("h-5 w-5", active ? "text-gold" : "text-cream/60")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="mt-6 border-t border-white/10 pt-4">
      <button
        type="button"
        onClick={() => setAccountOpen(true)}
        className="flex w-full items-center gap-3 rounded-xl px-1 py-1 text-left hover:bg-white/5"
        aria-label="Tài khoản của tôi – đổi ảnh đại diện"
      >
        <Avatar name={profile.fullName} src={profile.avatarUrl} size="sm" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-cream">{profile.fullName}</span>
          <span className="block text-xs text-cream/60">{ROLE_LABEL[profile.role]}</span>
        </span>
      </button>
      <form action={logoutAction} className="mt-3">
        <button
          type="submit"
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-cream/80 hover:bg-white/5 hover:text-cream"
        >
          <LogOut className="h-4 w-4" /> Đăng xuất
        </button>
      </form>
    </div>
  );

  return (
    <div className="min-h-dvh lg:flex">
      {/* Sidebar desktop */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-espresso px-4 py-6 lg:flex">
        <Link href="/admin" className="mb-8 px-2">
          <Logo tone="gold" />
        </Link>
        {nav}
        {footer}
      </aside>

      {/* Điện thoại / tablet: thanh trên chỉ có logo; điều hướng nằm ở thanh dưới để bấm
          bằng ngón cái (màn hình lớn như iPhone Pro Max khó với tới góc trên) */}
      <header className="flex items-center justify-between bg-espresso px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:hidden">
        <Link href="/admin">
          <span className="font-serif text-xl font-semibold text-gold">NT Beauty Spa</span>
        </Link>
        <button
          type="button"
          onClick={() => setAccountOpen(true)}
          className="rounded-full"
          aria-label="Tài khoản của tôi – đổi ảnh đại diện"
        >
          <Avatar name={profile.fullName} src={profile.avatarUrl} size="sm" />
        </button>
      </header>

      <nav
        aria-label="Điều hướng nhanh"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-champagne bg-ivory/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <ul className="mx-auto flex max-w-2xl">
          {tabs.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex flex-col items-center gap-1 py-2.5 text-xs font-medium",
                    active ? "text-gold-strong" : "text-mocha",
                  )}
                >
                  {active ? <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-gold" aria-hidden="true" /> : null}
                  <Icon className="h-6 w-6" />
                  {item.short ?? item.label}
                </Link>
              </li>
            );
          })}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-expanded={open}
              className={cn(
                "relative flex w-full flex-col items-center gap-1 py-2.5 text-xs font-medium",
                moreActive ? "text-gold-strong" : "text-mocha",
              )}
            >
              {moreActive ? <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-gold" aria-hidden="true" /> : null}
              <Menu className="h-6 w-6" />
              Thêm
            </button>
          </li>
        </ul>
      </nav>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="absolute inset-0 bg-espresso/50" onClick={() => setOpen(false)} aria-label="Đóng menu" />
          {/* mở từ dưới lên: mục nào cũng trong tầm ngón cái */}
          <aside className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col overflow-y-auto rounded-t-3xl bg-espresso px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 animate-slide-up">
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-cream/30" aria-hidden="true" />
            {nav}
            {footer}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-3 flex h-12 items-center justify-center gap-2 rounded-xl bg-white/10 text-[15px] font-semibold text-cream"
            >
              <X className="h-5 w-5" /> Đóng
            </button>
          </aside>
        </div>
      ) : null}

      {/* chừa chỗ cho thanh điều hướng dưới trên điện thoại */}
      <main className="min-w-0 flex-1 px-4 pb-28 pt-6 md:px-8 md:pt-8 lg:py-8">{children}</main>

      <Dialog open={accountOpen} onOpenChange={setAccountOpen} title="Tài khoản của tôi" description={`@${profile.username}`} size="sm">
        <AvatarUploader userId={profile.id} name={profile.fullName} url={profile.avatarUrl} />
      </Dialog>
    </div>
  );
}
