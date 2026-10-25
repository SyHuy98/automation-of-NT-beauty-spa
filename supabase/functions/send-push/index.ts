// Edge Function `send-push`: gửi Web Push (VAPID) cho offer mới, thông báo mới và
// nhắc tour quá giờ (check_overdue_tours).
// Được trigger Postgres gọi qua pg_net (xem _notify_push) nên cả offer do hệ
// thống tự tạo cũng có push.
// Lần đầu chạy tự sinh cặp khoá VAPID và lưu vào private.config.
import webpush from "npm:web-push@3.6.7";
import { json, loadConfig, serviceClient, verifyInternalSecret } from "../_shared/internal.ts";

interface PushTargets {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  subscriptions: Array<{ endpoint: string; p256dh: string; auth: string }>;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const sb = serviceClient();
  const config = await loadConfig(sb);
  if (!verifyInternalSecret(req, config.internal_secret)) return json({ error: "Unauthorized" }, 401);

  let publicKey = config.vapid_public;
  let privateKey = config.vapid_private;
  const subject = config.vapid_subject ?? "mailto:admin@ntbeautyspa.local";
  if (!publicKey || !privateKey) {
    const keys = webpush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    await sb.rpc("internal_set_config", { p_key: "vapid_public", p_value: publicKey });
    await sb.rpc("internal_set_config", { p_key: "vapid_private", p_value: privateKey });
  }

  const payload = (await req.json().catch(() => ({}))) as { kind?: string; id?: string };
  if (payload.kind === "init") return json({ ok: true, publicKey });
  if (payload.kind !== "offer" && payload.kind !== "announcement" && payload.kind !== "overdue") {
    return json({ error: "kind không hợp lệ" }, 400);
  }

  const { data, error } = await sb.rpc("push_targets", { p_kind: payload.kind, p_id: payload.id });
  if (error) return json({ error: error.message }, 500);
  const targets = data as PushTargets;

  const message = JSON.stringify({
    title: targets.title,
    body: targets.body,
    url: targets.url,
    tag: targets.tag,
    kind: payload.kind,
  });

  let sent = 0;
  let removed = 0;
  await Promise.all(
    targets.subscriptions.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          message,
          {
            TTL: payload.kind === "offer" ? 180 : payload.kind === "overdue" ? 3600 : 86400,
            urgency: payload.kind === "announcement" ? "normal" : "high",
            vapidDetails: { subject, publicKey: publicKey!, privateKey: privateKey! },
          },
        );
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // Thiết bị đã huỷ đăng ký → xoá
        if (status === 404 || status === 410) {
          await sb.rpc("system_remove_push_subscription", { p_endpoint: s.endpoint });
          removed++;
        } else {
          console.error("push failed", status, (err as Error).message);
        }
      }
    }),
  );

  return json({ sent, removed, total: targets.subscriptions.length });
});
