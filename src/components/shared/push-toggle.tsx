"use client";

import { BellOff, BellRing } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { currentSubscription, disablePush, enablePush, pushSupport, type PushSupport } from "@/lib/push";

/** Bật / tắt thông báo đẩy cho thiết bị hiện tại */
export function PushToggle() {
  const toast = useToast();
  // null khi render ở server; trên trình duyệt đọc khả năng hỗ trợ của thiết bị
  const support = useSyncExternalStore<PushSupport | null>(noopSubscribe, pushSupport, () => null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    currentSubscription()
      .then((s) => setEnabled(!!s && Notification.permission === "granted"))
      .catch(() => undefined);
  }, []);

  const toggle = async () => {
    setBusy(true);
    try {
      if (enabled) {
        await disablePush();
        setEnabled(false);
        toast.show("Đã tắt thông báo trên thiết bị này");
      } else {
        await enablePush();
        setEnabled(true);
        toast.success("Đã bật thông báo – bạn sẽ nhận tour mới kể cả khi tắt màn hình");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (support === null) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        {enabled ? <BellRing className="mt-0.5 h-5 w-5 text-free-ink" /> : <BellOff className="mt-0.5 h-5 w-5 text-mocha" />}
        <div className="flex-1">
          <p className="font-medium text-espresso">{enabled ? "Đang bật thông báo đẩy" : "Thông báo đẩy đang tắt"}</p>
          <p className="text-sm text-mocha">
            {support === "needs-install"
              ? "Trên iPhone (iOS 16.4+), cần thêm app vào Màn hình chính rồi mở từ biểu tượng đó."
              : support === "unsupported"
                ? "Trình duyệt này chưa hỗ trợ. Hãy dùng Chrome (Android) hoặc Safari (iPhone, cài vào màn hình chính)."
                : "Nhận tour mới và thông báo kể cả khi đang tắt màn hình."}
          </p>
        </div>
      </div>
      {support === "supported" ? (
        <Button variant={enabled ? "secondary" : "primary"} className="w-full" onClick={toggle} loading={busy}>
          {enabled ? "Tắt thông báo" : "Bật thông báo"}
        </Button>
      ) : null}
      <Link href="/huong-dan#thong-bao" className="block text-center text-sm font-medium text-gold-strong underline underline-offset-2">
        Hướng dẫn bật thông báo trên iPhone / Android
      </Link>
    </div>
  );
}

function noopSubscribe() {
  return () => undefined;
}
