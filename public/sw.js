/* Service worker – NT Beauty Spa
 * - Nhận Web Push (offer mới, thông báo mới) và hiện thông báo hệ thống.
 * - Bấm vào thông báo → mở/đưa app lên trước.
 * - Không cache dữ liệu nghiệp vụ (luôn cần dữ liệu realtime mới nhất);
 *   chỉ có trang offline đơn giản khi mất mạng.
 */
const VERSION = "ntspa-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll([OFFLINE_URL, "/icons/icon-192.png"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// Chỉ xử lý điều hướng trang: mất mạng thì hiện trang offline
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cache = await caches.open(VERSION);
      return (await cache.match(OFFLINE_URL)) || Response.error();
    }),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "NT Beauty Spa", body: event.data ? event.data.text() : "" };
  }
  const isOffer = data.kind === "offer";
  const title = data.title || "NT Beauty Spa";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: data.tag || undefined,
    renotify: true,
    requireInteraction: isOffer,
    vibrate: isOffer ? [400, 150, 400, 150, 400] : [200],
    data: { url: data.url || "/" },
  };
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      // Báo cho tab đang mở để làm mới ngay
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      clients.forEach((c) => c.postMessage({ type: "push", kind: data.kind }));
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of clients) {
        if ("focus" in c) {
          await c.focus();
          if ("navigate" in c && !c.url.endsWith(url)) await c.navigate(url).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
