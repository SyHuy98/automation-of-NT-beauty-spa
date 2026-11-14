import { describe, expect, it } from "vitest";
import type { DashboardTechnician, DashboardTour } from "@/types/app";
import { buildQueue } from "../queue";

const NOW = Date.parse("2026-11-14T08:00:00.000Z");
const min = (m: number) => new Date(NOW + m * 60_000).toISOString();

function tech(id: string, extra: Partial<DashboardTechnician> = {}): DashboardTechnician {
  return {
    id,
    fullName: id,
    username: id,
    gender: "female",
    scheduledShift: null,
    checkin: { shift: "full", checkInAt: min(-120), checkOutAt: null },
    offer: null,
    work: null,
    todayAmount: 0,
    monthAmount: 0,
    monthRequestedAmount: 0,
    todayRequestedAmount: 0,
    todayTours: 0,
    monthWorkedMinutes: 0,
    monthRequestedMinutes: 0,
    lastTourEndedAt: null,
    ...extra,
  };
}

/** KTV đang làm tour bắt đầu `startedMin` phút trước, dài `dur` phút */
function working(id: string, startedAgo: number, dur: number, extra: Partial<DashboardTechnician> = {}) {
  return tech(id, {
    work: { tourId: "w-" + id, code: "", customerName: "", status: "working", startedAt: min(-startedAgo), isRequested: false, durationMinutes: dur, services: "" },
    ...extra,
  });
}

function tour(id: string, createdAgo: number, extra: Partial<DashboardTour> = {}): DashboardTour {
  return {
    id,
    code: id,
    customerName: id,
    customerPhone: null,
    customerGender: "female",
    allowAnyGender: false,
    note: null,
    status: "waiting",
    assignMode: "auto",
    isRequested: false,
    requestedTechnicianId: null,
    requestedTechnicianName: null,
    teamSize: 1,
    createdAt: min(-createdAgo),
    startedAt: null,
    completedAt: null,
    cancelledReason: null,
    totalFee: 0,
    durationMinutes: 60,
    items: [],
    members: [],
    pendingOffers: [],
    ...extra,
  };
}

describe("hàng chờ", () => {
  it("đến trước xếp trước, mỗi khách vào KTV xong sớm nhất", () => {
    // A xong sau 10', B xong sau 40'
    const techs = [working("A", 50, 60), working("B", 20, 60)];
    const q = buildQueue([tour("t2", 5), tour("t1", 10), tour("t3", 1)], techs, NOW);
    expect(q.map((e) => e.tour.id)).toEqual(["t1", "t2", "t3"]);
    expect(q.map((e) => e.position)).toEqual([1, 2, 3]);
    expect(q[0].waitedMinutes).toBe(10);
    expect((q[0].etaMs! - NOW) / 60_000).toBe(10); // A
    expect((q[1].etaMs! - NOW) / 60_000).toBe(40); // B
    expect((q[2].etaMs! - NOW) / 60_000).toBe(70); // A lần 2: 10 + 60
  });

  it("khách chỉ định chờ đúng KTV đó, không giành KTV của người khác", () => {
    const techs = [working("A", 50, 60), working("B", 20, 60)];
    const q = buildQueue(
      [tour("req", 10, { isRequested: true, assignMode: "requested", requestedTechnicianId: "B" }), tour("t", 5)],
      techs,
      NOW,
    );
    expect((q[0].etaMs! - NOW) / 60_000).toBe(40); // chờ B
    expect((q[1].etaMs! - NOW) / 60_000).toBe(10); // A rảnh trước
  });

  it("khách nữ chỉ chờ KTV nữ; tour 2 KTV chờ đủ 2 người", () => {
    const techs = [working("M", 55, 60, { gender: "male" }), working("F1", 30, 60), working("F2", 10, 60)];
    const q = buildQueue([tour("f", 10), tour("pair", 5, { customerGender: "male", teamSize: 2 })], techs, NOW);
    expect((q[0].etaMs! - NOW) / 60_000).toBe(30); // F1, không lấy M (xong sau 5')
    // còn M (5') và F2 (50') → tour 2 KTV có đủ người lúc 50'
    expect((q[1].etaMs! - NOW) / 60_000).toBe(50);
    expect(q[1].openSlots).toBe(2);
  });

  it("KTV chỉ định chưa vào ca → chưa ước tính được; tour đang có lời mời không nằm trong hàng chờ", () => {
    const q = buildQueue(
      [
        tour("req", 10, { isRequested: true, assignMode: "requested", requestedTechnicianId: "X" }),
        tour("offered", 5, { status: "offered", pendingOffers: [{ id: "o", technicianId: "A", name: "A", expiresAt: min(1), sharePercent: 100 }] }),
      ],
      [tech("A")],
      NOW,
    );
    expect(q).toHaveLength(1);
    expect(q[0].etaMs).toBeNull();
  });
});
