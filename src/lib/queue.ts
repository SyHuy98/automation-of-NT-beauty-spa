import type { DashboardTechnician, DashboardTour, Gender } from "@/types/app";

const MINUTE = 60_000;

export interface QueueEntry {
  tour: DashboardTour;
  /** Thứ tự trong hàng chờ (1 = đến trước nhất) */
  position: number;
  /** Số phút khách đã chờ */
  waitedMinutes: number;
  /** Còn thiếu mấy KTV (tour 2 KTV có thể thiếu 2) */
  openSlots: number;
  /** Giờ dự kiến có KTV (ms); null = chưa ước tính được (KTV chỉ định chưa vào ca…) */
  etaMs: number | null;
}

/** Tour còn chờ người: chưa đủ người nhận + lời mời đang chờ */
export function openSlots(t: DashboardTour): number {
  if (t.status !== "waiting" && t.status !== "offered") return 0;
  return Math.max(0, t.teamSize - t.members.length - t.pendingOffers.length);
}

/**
 * Hàng chờ: các tour chưa đủ KTV, đến trước đứng trước. Ước tính giờ có KTV bằng cách
 * "xếp thử" lần lượt từng khách vào KTV xong sớm nhất (đúng như thứ tự hệ thống tự
 * gửi): KTV đang làm → xong lúc bắt đầu + thời lượng dịch vụ; KTV rảnh → ngay.
 * Khách chỉ định chờ đúng KTV đó. Chỉ là ước tính (không tính kỹ năng riêng, khách
 * có thể đến sớm / muộn).
 */
export function buildQueue(tours: DashboardTour[], technicians: DashboardTechnician[], nowMs: number): QueueEntry[] {
  const durationOf = new Map(tours.map((t) => [t.id, t.durationMinutes]));
  // KTV đang trong ca và lúc dự kiến rảnh
  const slots = technicians
    .filter((t) => t.checkin && !t.checkin.checkOutAt)
    .map((t) => {
      let freeAt = nowMs;
      if (t.work?.status === "working" && t.work.startedAt) {
        freeAt = Math.max(nowMs, Date.parse(t.work.startedAt) + t.work.durationMinutes * MINUTE);
      } else if (t.work) {
        // đã nhận, đang chờ người làm cùng → sắp bắt đầu
        freeAt = nowMs + t.work.durationMinutes * MINUTE;
      } else if (t.offer) {
        // đang được mời tour khác → nếu nhận thì bận thêm thời lượng tour đó
        freeAt = nowMs + (durationOf.get(t.offer.tourId) ?? 0) * MINUTE;
      }
      return { id: t.id, gender: (t.gender === "male" ? "male" : "female") as Gender, freeAt };
    });

  const waiting = tours
    .filter((t) => openSlots(t) > 0)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  return waiting.map((tour, i) => {
    const need = openSlots(tour);
    const dur = tour.durationMinutes * MINUTE;
    let etaMs: number | null = null;
    if (tour.isRequested && tour.requestedTechnicianId && !tour.members.some((m) => m.technicianId === tour.requestedTechnicianId)) {
      const s = slots.find((x) => x.id === tour.requestedTechnicianId);
      if (s) {
        etaMs = s.freeAt;
        s.freeAt += dur;
      }
    } else {
      // khách nữ chỉ KTV nữ (trừ khi khách nam đồng ý / dịch vụ chuyên môn – ước tính bỏ qua)
      const womenOnly = tour.customerGender === "female";
      const pool = slots
        .filter((s) => !womenOnly || s.gender === "female")
        .filter((s) => !tour.members.some((m) => m.technicianId === s.id))
        .sort((a, b) => a.freeAt - b.freeAt)
        .slice(0, need);
      if (pool.length === need) {
        etaMs = Math.max(...pool.map((s) => s.freeAt));
        for (const s of pool) s.freeAt = etaMs + dur;
      }
    }
    return {
      tour,
      position: i + 1,
      waitedMinutes: Math.max(0, Math.floor((nowMs - Date.parse(tour.createdAt)) / MINUTE)),
      openSlots: need,
      etaMs,
    };
  });
}
