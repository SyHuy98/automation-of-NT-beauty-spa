// Edge Function `dispatch`: tự gửi offer cho người phù hợp tiếp theo với tour ở
// chế độ Tự động / Random cân bằng. Được Postgres gọi qua pg_net khi KTV từ
// chối / hết giờ / có KTV vừa rảnh (và pg_cron mỗi phút làm lưới an toàn).
import { json, loadConfig, serviceClient, verifyInternalSecret } from "../_shared/internal.ts";
import { type AssignmentSnapshot, pickAuto, pickWeightedRandom, rankTechnicians } from "../_shared/score.ts";

interface QueueItem {
  id: string;
  code: string;
  assignMode: "auto" | "random";
  serviceIds: string[];
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const sb = serviceClient();
  const config = await loadConfig(sb);
  if (!verifyInternalSecret(req, config.internal_secret)) return json({ error: "Unauthorized" }, 401);

  const { data: queue, error } = await sb.rpc("system_dispatch_queue");
  if (error) return json({ error: error.message }, 500);

  const results: Array<Record<string, unknown>> = [];
  for (const tour of (queue ?? []) as QueueItem[]) {
    const { data: snap, error: snapError } = await sb.rpc("assignment_snapshot", {
      p_service_ids: tour.serviceIds,
      p_tour_id: tour.id,
    });
    if (snapError) {
      results.push({ tour: tour.code, error: snapError.message });
      continue;
    }
    const snapshot = snap as AssignmentSnapshot;
    const ranked = rankTechnicians(snapshot);
    if (ranked.candidates.length === 0) {
      await sb.rpc("system_no_candidate", { p_tour_id: tour.id });
      results.push({ tour: tour.code, sent: false, reason: ranked.message });
      continue;
    }

    // Người được chọn đầu tiên; nếu gửi lỗi (vừa bị người khác giành) thì thử
    // lần lượt các ứng viên còn lại theo thứ hạng.
    const first =
      tour.assignMode === "random"
        ? pickWeightedRandom(ranked, snapshot.settings.randomPoolSize)
        : pickAuto(ranked);
    const order = [first!, ...ranked.candidates.filter((c) => c.technicianId !== first!.technicianId)];
    let sent = false;
    for (const candidate of order) {
      const { error: offerError } = await sb.rpc("system_send_offer", {
        p_tour_id: tour.id,
        p_technician_id: candidate.technicianId,
      });
      if (!offerError) {
        results.push({ tour: tour.code, sent: true, technician: candidate.fullName, score: candidate.score });
        sent = true;
        break;
      }
    }
    if (!sent) {
      await sb.rpc("system_no_candidate", { p_tour_id: tour.id });
      results.push({ tour: tour.code, sent: false });
    }
  }

  return json({ processed: results.length, results });
});
