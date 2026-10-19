import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type AssignmentSnapshot,
  type TechnicianSnapshot,
  formatVndPlain,
  pickAuto,
  pickWeightedRandom,
  rankTechnicians,
} from "../score";

// 15:00 giờ VN ngày 20/10/2026
const NOW = "2026-10-20T08:00:00.000Z";

function tech(overrides: Partial<TechnicianSnapshot> & { id: string }): TechnicianSnapshot {
  return {
    fullName: overrides.id.toUpperCase(),
    isActive: true,
    checkedIn: true,
    isFree: true,
    shift: "morning",
    checkInAt: "2026-10-20T02:00:00.000Z", // 09:00 VN
    skillServiceIds: [],
    excluded: false,
    todayEarnings: 0,
    monthEarnings: 1_000_000,
    monthRequestedEarnings: 0,
    lastTourEndedAt: "2026-10-20T07:30:00.000Z", // rảnh 30 phút
    declinesToday: 0,
    ...overrides,
  };
}

function snapshot(technicians: TechnicianSnapshot[], extra: Partial<AssignmentSnapshot> = {}): AssignmentSnapshot {
  return {
    now: NOW,
    durationMinutes: 60,
    requiredSkillServiceIds: [],
    settings: {
      weights: {},
      requestedThresholdPercent: 20,
      shiftHours: {},
      randomPoolSize: 3,
    },
    technicians,
    ...extra,
  };
}

describe("rankTechnicians – lọc ứng viên", () => {
  it("loại KTV khoá, chưa vào ca, đang bận, đã từ chối tour này", () => {
    const result = rankTechnicians(
      snapshot([
        tech({ id: "a" }),
        tech({ id: "locked", isActive: false }),
        tech({ id: "off", checkedIn: false }),
        tech({ id: "busy", isFree: false, busyReason: "Đang làm tour khác" }),
        tech({ id: "declined", excluded: true }),
      ]),
    );
    expect(result.candidates.map((c) => c.technicianId)).toEqual(["a"]);
    expect(Object.fromEntries(result.excluded.map((e) => [e.technicianId, e.reason]))).toEqual({
      locked: "Tài khoản đã khoá",
      off: "Chưa vào ca",
      busy: "Đang làm tour khác",
      declined: "Đã từ chối / không phản hồi tour này",
    });
  });

  it("lọc theo kỹ năng: phải có đủ mọi dịch vụ cần kỹ năng riêng", () => {
    const result = rankTechnicians(
      snapshot(
        [
          tech({ id: "hifu-only", skillServiceIds: ["hifu"] }),
          tech({ id: "both", skillServiceIds: ["hifu", "tiem"] }),
          tech({ id: "none" }),
        ],
        { requiredSkillServiceIds: ["hifu", "tiem"] },
      ),
    );
    expect(result.candidates.map((c) => c.technicianId)).toEqual(["both"]);
    expect(result.excluded.find((e) => e.technicianId === "none")?.reason).toBe("Thiếu kỹ năng cho dịch vụ của tour");
  });

  it("dịch vụ không cần kỹ năng thì mọi KTV đều làm được", () => {
    const result = rankTechnicians(snapshot([tech({ id: "a" }), tech({ id: "b" })]));
    expect(result.candidates).toHaveLength(2);
  });

  it("không còn ai rảnh → trả về rỗng + thông báo cho admin", () => {
    const result = rankTechnicians(
      snapshot([tech({ id: "a", isFree: false }), tech({ id: "b", checkedIn: false })]),
    );
    expect(result.candidates).toEqual([]);
    expect(result.message).toBe("Hiện không có KTV nào rảnh và phù hợp cho tour này");
    expect(pickAuto(result)).toBeNull();
    expect(pickWeightedRandom(result, 3)).toBeNull();
  });
});

describe("rankTechnicians – chấm điểm", () => {
  it("ưu tiên người có thu nhập hôm nay thấp hơn", () => {
    const result = rankTechnicians(
      snapshot([tech({ id: "rich", todayEarnings: 900_000 }), tech({ id: "poor", todayEarnings: 150_000 })]),
    );
    expect(result.candidates[0].technicianId).toBe("poor");
    expect(result.candidates[0].reasons).toContain("Hôm nay 150.000 ₫ (thấp nhất)");
  });

  it("trừ điểm người có thu nhập tháng cao hơn trung bình nhóm", () => {
    const result = rankTechnicians(
      snapshot([tech({ id: "high", monthEarnings: 2_000_000 }), tech({ id: "low", monthEarnings: 1_000_000 })]),
    );
    expect(result.candidates[0].technicianId).toBe("low");
    const low = result.candidates[0];
    expect(low.breakdown.month).toBeGreaterThan(0);
    expect(low.reasons).toContain("Tháng dưới TB 33%");
    expect(result.candidates[1].breakdown.month).toBeLessThan(0);
  });

  it("gần hết ca: còn ít thời gian hơn thời lượng tour → trừ mạnh + cảnh báo", () => {
    // 17:30 VN, ca sáng hết lúc 18:00 → còn 30 phút < tour 60 phút
    const result = rankTechnicians(
      snapshot([tech({ id: "morning" }), tech({ id: "full", shift: "full" })], { now: "2026-10-20T10:30:00.000Z" }),
    );
    expect(result.candidates[0].technicianId).toBe("full");
    const morning = result.candidates.find((c) => c.technicianId === "morning")!;
    expect(morning.breakdown.shiftEnd).toBe(-50);
    expect(morning.warnings).toContain("Sắp hết ca (còn 30 phút)");
    // vẫn hiển thị, không bị loại
    expect(result.candidates).toHaveLength(2);
  });

  it("phạt lệch do tour chỉ định khi vượt TB nhóm quá ngưỡng 20%", () => {
    const techs = [
      // TB nhóm = 1.200.000; ngưỡng = 1.440.000
      tech({ id: "star", monthEarnings: 2_000_000, monthRequestedEarnings: 900_000 }),
      tech({ id: "b", monthEarnings: 800_000 }),
      tech({ id: "c", monthEarnings: 800_000 }),
    ];
    const result = rankTechnicians(snapshot(techs));
    const star = result.candidates.find((c) => c.technicianId === "star")!;
    // overshoot = 2.000.000 − 1.440.000 = 560.000 (< 900.000 tiền chỉ định) → 560/1200 ≈ 0,467 × 15
    expect(star.breakdown.requested).toBeCloseTo(-7, 0);
    expect(star.warnings).toContain("Tiền tour chỉ định đang vượt TB nhóm");
  });

  it("không phạt tour chỉ định khi chưa vượt ngưỡng", () => {
    const techs = [
      tech({ id: "a", monthEarnings: 1_300_000, monthRequestedEarnings: 500_000 }),
      tech({ id: "b", monthEarnings: 1_100_000 }),
    ];
    const a = rankTechnicians(snapshot(techs)).candidates.find((c) => c.technicianId === "a")!;
    expect(a.breakdown.requested).toBe(0);
  });

  it("chuẩn hoá ca chiều: vừa vào ca, 0đ không bị thiệt so với ca sáng có ít tour", () => {
    // 13:00 VN: ca sáng đã làm 4 giờ được 200.000 (50.000/giờ); ca chiều vừa vào 12:00 được 0
    const result = rankTechnicians(
      snapshot(
        [
          tech({ id: "sang", todayEarnings: 200_000, lastTourEndedAt: "2026-10-20T05:50:00.000Z" }),
          tech({
            id: "chieu",
            shift: "afternoon",
            checkInAt: "2026-10-20T05:00:00.000Z",
            lastTourEndedAt: null,
            todayEarnings: 0,
          }),
        ],
        { now: "2026-10-20T06:00:00.000Z" },
      ),
    );
    expect(result.candidates[0].technicianId).toBe("chieu");
  });

  it("chuẩn hoá theo giờ làm: ca chiều kiếm cùng số tiền trong ít giờ hơn thì bị coi là cao hơn", () => {
    // 15:00 VN: ca sáng làm 6 giờ được 300.000 (50k/giờ); ca chiều làm 3 giờ được 300.000 (100k/giờ)
    const result = rankTechnicians(
      snapshot([
        tech({ id: "sang", todayEarnings: 300_000 }),
        tech({ id: "chieu", shift: "afternoon", checkInAt: "2026-10-20T05:00:00.000Z", todayEarnings: 300_000 }),
      ]),
    );
    const sang = result.candidates.find((c) => c.technicianId === "sang")!;
    const chieu = result.candidates.find((c) => c.technicianId === "chieu")!;
    expect(sang.breakdown.today).toBeGreaterThan(chieu.breakdown.today);
    expect(chieu.breakdown.today).toBe(0);
  });

  it("rảnh lâu hơn được ưu tiên khi các yếu tố khác bằng nhau", () => {
    const result = rankTechnicians(
      snapshot([
        tech({ id: "just", lastTourEndedAt: "2026-10-20T07:55:00.000Z" }),
        tech({ id: "long", lastTourEndedAt: "2026-10-20T06:00:00.000Z" }),
      ]),
    );
    expect(result.candidates[0].technicianId).toBe("long");
    expect(result.candidates[0].reasons[0]).toBe("Rảnh 120 phút");
  });

  it("từ chối nhiều hôm nay → trừ nhẹ", () => {
    const result = rankTechnicians(snapshot([tech({ id: "a", declinesToday: 3 }), tech({ id: "b" })]));
    expect(result.candidates[0].technicianId).toBe("b");
    expect(result.candidates[1].breakdown.declines).toBe(-5);
  });

  it("dùng trọng số cấu hình trong settings", () => {
    const result = rankTechnicians(
      snapshot([tech({ id: "a", todayEarnings: 100_000 }), tech({ id: "b" })], {
        settings: {
          weights: { today: 0, month: 0, idle: 0 },
          requestedThresholdPercent: 20,
          shiftHours: {},
          randomPoolSize: 3,
        },
      }),
    );
    expect(result.candidates.every((c) => c.score === 0)).toBe(true);
  });
});

describe("chế độ phân", () => {
  const result = rankTechnicians(
    snapshot([
      tech({ id: "a", todayEarnings: 0 }),
      tech({ id: "b", todayEarnings: 300_000 }),
      tech({ id: "c", todayEarnings: 600_000 }),
      tech({ id: "d", todayEarnings: 900_000 }),
    ]),
  );

  it("Tự động chọn người điểm cao nhất", () => {
    expect(pickAuto(result)?.technicianId).toBe("a");
  });

  it("Random chỉ chọn trong nhóm top N, người điểm cao có xác suất cao hơn", () => {
    expect(pickWeightedRandom(result, 3, () => 0)?.technicianId).toBe("a");
    expect(pickWeightedRandom(result, 3, () => 0.9999)?.technicianId).toBe("c");
    const counts: Record<string, number> = {};
    let seed = 1;
    const rng = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < 3000; i++) {
      const id = pickWeightedRandom(result, 3, rng)!.technicianId;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    expect(counts.d).toBeUndefined();
    expect(counts.a).toBeGreaterThan(counts.b);
    expect(counts.b).toBeGreaterThan(counts.c);
  });
});

describe("tiện ích", () => {
  it("định dạng tiền vi-VN", () => {
    expect(formatVndPlain(150000)).toBe("150.000 ₫");
    expect(formatVndPlain(0)).toBe("0 ₫");
    expect(formatVndPlain(1234567)).toBe("1.234.567 ₫");
  });

  it("bản copy cho Edge Function giống hệt bản gốc (chạy npm run sync:edge nếu lệch)", () => {
    const src = readFileSync(resolve(__dirname, "../score.ts"), "utf8");
    const copy = readFileSync(resolve(__dirname, "../../../../supabase/functions/_shared/score.ts"), "utf8");
    expect(copy).toBe(src);
  });
});
