"use client";

import { LogIn, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { getSupabaseBrowser } from "@/lib/supabase/client";

/**
 * Phát hiện phiên đăng nhập của tab này không còn khớp: đăng xuất ở tab khác,
 * hoặc đăng nhập tài khoản khác trên cùng trình duyệt (cookie dùng chung). Khi đó
 * mọi yêu cầu bị từ chối / trả rỗng nên phải báo rõ thay vì im lặng.
 */
export function SessionGuard({ userId }: { userId: string }) {
  const [lost, setLost] = useState<"signed_out" | "switched" | null>(null);
  const router = useRouter();

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let stopped = false;
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (stopped) return;
      const uid = data.session?.user.id ?? null;
      setLost(uid === userId ? null : uid ? "switched" : "signed_out");
    };
    const { data: sub } = supabase.auth.onAuthStateChange(() => void check());
    const onVisible = () => document.visibilityState === "visible" && void check();
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => void check(), 15_000);
    return () => {
      stopped = true;
      sub.subscription.unsubscribe();
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [userId]);

  if (!lost) return null;
  return (
    <Dialog
      open
      onOpenChange={() => {}}
      dismissible={false}
      title={lost === "switched" ? "Trình duyệt vừa đăng nhập tài khoản khác" : "Phiên đăng nhập đã kết thúc"}
      size="sm"
      footer={
        lost === "switched" ? (
          <Button onClick={() => window.location.reload()} className="w-full">
            <RefreshCw className="h-4 w-4" /> Tải lại trang
          </Button>
        ) : (
          <Button onClick={() => router.replace("/login")} className="w-full">
            <LogIn className="h-4 w-4" /> Đăng nhập lại
          </Button>
        )
      }
    >
      <div className="space-y-2 text-sm text-mocha">
        <p>
          {lost === "switched"
            ? "Tab này không còn dùng tài khoản ban đầu, nên dữ liệu không tải / lưu được nữa."
            : "Tab này đã bị đăng xuất (có thể do đăng xuất hoặc đăng nhập tài khoản khác ở tab khác), nên dữ liệu không tải / lưu được nữa."}
        </p>
        <p>
          Mỗi trình duyệt chỉ giữ <strong>1 tài khoản</strong> một lúc. Muốn mở cùng lúc tài khoản quản lý và tài khoản KTV, hãy mở
          tài khoản thứ hai trong <strong>cửa sổ ẩn danh</strong> hoặc trình duyệt khác.
        </p>
      </div>
    </Dialog>
  );
}
