"use client";

import { getSupabaseBrowser } from "@/lib/supabase/client";

export type PushSupport = "supported" | "unsupported" | "needs-install";

/** Thiết bị có nhận được Web Push không (iOS cần cài PWA ra màn hình chính, iOS 16.4+) */
export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return isIos && !standalone ? "needs-install" : "unsupported";
  }
  if (isIos && !standalone) return "needs-install";
  return "supported";
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "supported") return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Xin quyền + đăng ký push + lưu vào bảng push_subscriptions */
export async function enablePush(): Promise<void> {
  const support = pushSupport();
  if (support === "needs-install") {
    throw new Error("Trên iPhone, hãy thêm app vào Màn hình chính rồi mở từ biểu tượng đó để bật thông báo");
  }
  if (support === "unsupported") throw new Error("Trình duyệt này không hỗ trợ thông báo đẩy");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Bạn chưa cho phép thông báo. Hãy bật lại trong Cài đặt của trình duyệt/điện thoại");
  }

  const supabase = getSupabaseBrowser();
  const { data: publicKey, error } = await supabase.rpc("get_vapid_public_key");
  if (error || !publicKey) throw new Error("Máy chủ chưa sẵn sàng gửi thông báo – vui lòng thử lại sau");

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  const json = sub.toJSON();
  // RPC upsert theo endpoint: thiết bị từng đăng nhập tài khoản khác sẽ chuyển sang tài khoản này
  const { error: saveError } = await supabase.rpc("register_push_subscription", {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh ?? "",
    p_auth: json.keys?.auth ?? "",
    p_user_agent: navigator.userAgent.slice(0, 300),
  });
  if (saveError) throw new Error("Không lưu được đăng ký thông báo – vui lòng thử lại");
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await getSupabaseBrowser().from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}
