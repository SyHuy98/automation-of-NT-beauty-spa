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
    expect(result.candidates[0].reasons).toContain("Hôm nay 150.000 ₫ – thấp nhất");
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

  it("tour khách chỉ định KHÔNG tính vào cân bằng hôm nay", () => {
    // star: 500k hôm nay nhưng 400k là khách chỉ định → tour thường chỉ 100k
    const result = rankTechnicians(
      snapshot([
        tech({ id: "star", todayEarnings: 500_000, todayRequestedEarnings: 400_000 }),
        tech({ id: "b", todayEarnings: 200_000 }),
      ]),
    );
    expect(result.candidates[0].technicianId).toBe("star");
    expect(result.candidates[0].reasons).toContain("Hôm nay 100.000 ₫ (+400.000 ₫ chỉ định) – thấp nhất");
  });

  it("giờ làm tour chỉ định được trừ khỏi giờ có mặt", () => {
    // 15:00, cả 2 vào 09:00 (6 giờ). a: 300k tour thường nhưng mất 3 giờ làm khách chỉ định
    // → 300k / 3 giờ = 100k/giờ; b: 360k / 6 giờ = 60k/giờ → b được ưu tiên
    const result = rankTechnicians(
      snapshot([
        tech({ id: "a", todayEarnings: 300_000, todayRequestedMinutes: 180 }),
        tech({ id: "b", todayEarnings: 360_000 }),
      ]),
    );
    expect(result.candidates[0].technicianId).toBe("b");
  });

  it("tour khách chỉ định KHÔNG tính vào cân bằng tháng", () => {
    const result = rankTechnicians(
      snapshot([
        // tháng 3tr nhưng 2,5tr là khách chỉ định → tour thường 500k (thấp nhất)
        tech({ id: "star", monthEarnings: 3_000_000, monthRequestedEarnings: 2_500_000 }),
        tech({ id: "b", monthEarnings: 1_000_000 }),
      ]),
    );
    const star = result.candidates.find((c) => c.technicianId === "star")!;
    expect(star.breakdown.month).toBeGreaterThan(0);
    expect(result.candidates[0].technicianId).toBe("star");
  });

  it("tháng chia theo giờ có mặt: người nghỉ nhiều ngày không được ưu tiên quá đà", () => {
    // a làm 20 giờ được 1tr (50k/giờ); b làm 100 giờ được 5tr (50k/giờ) → ngang nhau
    const result = rankTechnicians(
      snapshot([
        tech({ id: "a", monthEarnings: 1_000_000, monthWorkedMinutes: 20 * 60 }),
        tech({ id: "b", monthEarnings: 5_000_000, monthWorkedMinutes: 100 * 60 }),
      ]),
    );
    for (const c of result.candidates) expect(c.breakdown.month).toBe(0);
  });

  it("KTV mới chưa có giờ làm trong tháng không kéo TB nhóm xuống", () => {
    const result = rankTechnicians(
      snapshot([
        tech({ id: "a", monthEarnings: 1_000_000, monthWorkedMinutes: 20 * 60 }),
        tech({ id: "b", monthEarnings: 2_000_000, monthWorkedMinutes: 40 * 60 }),
        tech({ id: "new", monthEarnings: 0, monthWorkedMinutes: 0 }),
      ]),
    );
    expect(result.groupMonthAverage).toBe(50_000);
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

describe("rankTechnicians – giới tính", () => {
  const team = () => [
    tech({ id: "nu1", gender: "female", monthEarnings: 3_000_000 }),
    tech({ id: "nu2", gender: "female", monthEarnings: 5_000_000 }),
    tech({ id: "nam1", gender: "male", monthEarnings: 1_000_000 }),
    tech({ id: "nam2", gender: "male", monthEarnings: 2_000_000 }),
  ];

  it("khách nữ: chỉ KTV nữ, KTV nam bị loại kèm lý do", () => {
    const r = rankTechnicians(snapshot(team(), { customerGender: "female" }));
    expect(r.candidates.map((c) => c.technicianId).sort()).toEqual(["nu1", "nu2"]);
    expect(r.excluded.find((e) => e.technicianId === "nam1")?.reason).toContain("Khách nữ");
    expect(r.genderFallback).toBe(false);
  });

  it("khách nam: chỉ KTV nam khi còn KTV nam rảnh", () => {
    const r = rankTechnicians(snapshot(team(), { customerGender: "male" }));
    expect(r.candidates.map((c) => c.technicianId).sort()).toEqual(["nam1", "nam2"]);
    expect(r.genderFallback).toBe(false);
  });

  it("khách nam: không còn KTV nam rảnh → chuyển KTV nữ + cảnh báo", () => {
    const techs = team().map((t) => (t.gender === "male" ? { ...t, isFree: false, busyReason: "Đang làm tour" } : t));
    const r = rankTechnicians(snapshot(techs, { customerGender: "male" }));
    expect(r.candidates.map((c) => c.technicianId).sort()).toEqual(["nu1", "nu2"]);
    expect(r.genderFallback).toBe(true);
    expect(r.candidates[0].warnings.join(" ")).toContain("không còn KTV nam");
  });

  it("khách nữ mà không còn KTV nữ rảnh → không chuyển KTV nam", () => {
    const techs = team().map((t) => (t.gender === "female" ? { ...t, checkedIn: false } : t));
    const r = rankTechnicians(snapshot(techs, { customerGender: "female" }));
    expect(r.candidates).toEqual([]);
    expect(r.message).toContain("KTV nữ");
  });

  it("trung bình tháng tính riêng từng nhóm giới tính", () => {
    const r = rankTechnicians(snapshot(team(), { customerGender: "male" }));
    expect(r.groupMonthAverages).toEqual({ male: 1_500_000, female: 4_000_000 });
    expect(r.groupMonthAverage).toBe(1_500_000);
    // nam1 1tr so với TB nam 1,5tr → dưới TB 33% (không bị so với nữ)
    const nam1 = r.candidates.find((c) => c.technicianId === "nam1")!;
    expect(nam1.monthDiffPercent).toBe(-33);
    expect(nam1.reasons.join(" ")).toContain("dưới TB nam 33%");
  });

  it("thiếu thông tin giới tính KTV → coi là nữ", () => {
    const r = rankTechnicians(snapshot([tech({ id: "x" }), tech({ id: "m", gender: "male" })], { customerGender: "female" }));
    expect(r.candidates.map((c) => c.technicianId)).toEqual(["x"]);
  });

  it("dịch vụ không phân biệt giới tính: khách nữ vẫn được KTV nam có kỹ năng", () => {
    const techs = [
      tech({ id: "nu", gender: "female", skillServiceIds: [] }),
      tech({ id: "nam-tiem", gender: "male", skillServiceIds: ["botox"] }),
      tech({ id: "nu-tiem", gender: "female", skillServiceIds: ["botox"] }),
    ];
    const r = rankTechnicians(
      snapshot(techs, { customerGender: "female", genderFree: true, requiredSkillServiceIds: ["botox"] }),
    );
    expect(r.genderFree).toBe(true);
    expect(r.candidates.map((c) => c.technicianId).sort()).toEqual(["nam-tiem", "nu-tiem"]);
    // KTV không có kỹ năng vẫn bị loại
    expect(r.excluded.find((e) => e.technicianId === "nu")?.reason).toContain("kỹ năng");
  });

  it("dịch vụ không phân biệt giới tính: mỗi KTV vẫn so tiền với nhóm cùng giới", () => {
    const r = rankTechnicians(snapshot(team(), { customerGender: "female", genderFree: true }));
    const nam1 = r.candidates.find((c) => c.technicianId === "nam1")!;
    expect(nam1.reasons.join(" ")).toContain("TB nam");
    expect(r.candidates).toHaveLength(4);
  });

  it("không có giới tính khách → không lọc (giữ hành vi cũ)", () => {
    const r = rankTechnicians(snapshot(team()));
    expect(r.candidates).toHaveLength(4);
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
