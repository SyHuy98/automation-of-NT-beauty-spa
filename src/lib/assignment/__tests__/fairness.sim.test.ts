import { describe, expect, it } from "vitest";
import { type AssignmentSnapshot, type ShiftKey, type TechnicianSnapshot, pickAuto, rankTechnicians } from "../score";

/**
 * Mô phỏng nhiều ngày làm việc để kiểm chứng thuật toán chia tour công bằng:
 *  - 6 KTV: ca sáng / chiều / full, 1 người chỉ làm cách ngày, 1 người có nhiều
 *    khách quen (tour chỉ định), 1 người hay vào ca trễ 2 tiếng.
 *  - Dịch vụ giá & thời lượng khác nhau (60k–200k, 30–120 phút).
 *  - Khách đến ngẫu nhiên (có seed để lần nào chạy cũng ra cùng kết quả).
 * Thước đo công bằng: tiền tour THƯỜNG / giờ có mặt (đã trừ giờ làm tour chỉ định).
 */

const SERVICES = [
  { fee: 60_000, duration: 30 },
  { fee: 80_000, duration: 45 },
  { fee: 100_000, duration: 60 },
  { fee: 150_000, duration: 90 },
  { fee: 200_000, duration: 120 },
];
const SHIFT_HOURS: Record<ShiftKey, { start: string; end: string }> = {
  morning: { start: "09:00", end: "18:00" },
  afternoon: { start: "12:00", end: "21:00" },
  full: { start: "09:00", end: "21:00" },
};
const MIN = 60_000;

interface SimTech {
  id: string;
  shift: ShiftKey;
  /** làm ngày nào (theo chỉ số ngày) */
  works: (day: number) => boolean;
  /** vào ca trễ bao nhiêu phút */
  lateMinutes: number;
  busyUntil: number;
  lastEnd: number | null;
  // cộng dồn
  regular: number;
  requested: number;
  requestedMinutes: number;
  shiftMinutes: number;
  tours: number;
  // theo ngày
  today: number;
  todayRegular: number;
  todayShiftMinutes: number;
  todayRequested: number;
  todayRequestedMinutes: number;
  pending: Array<{ at: number; fee: number; requested: boolean; minutes: number }>;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function vnMs(date: string, hhmm: string) {
  return Date.parse(`${date}T${hhmm}:00+07:00`);
}

type Picker = (snap: AssignmentSnapshot, techs: SimTech[], now: number) => string | null;

/** Thuật toán của app (chế độ Tự động) */
const appPicker: Picker = (snap) => pickAuto(rankTechnicians(snap))?.technicianId ?? null;

/** Cách chia truyền thống để so sánh: xoay vòng theo SỐ tour hôm nay, hoà thì ai rảnh lâu hơn */
const countPicker: Picker = (_snap, techs, now) => {
  const free = techs.filter((t) => isOnShift(t, now) && t.busyUntil <= now);
  free.sort((a, b) => a.tours - b.tours || (a.lastEnd ?? 0) - (b.lastEnd ?? 0));
  return free[0]?.id ?? null;
};

let currentDate = "";
let currentDay = 0;
function shiftWindow(t: SimTech) {
  return {
    start: vnMs(currentDate, SHIFT_HOURS[t.shift].start) + t.lateMinutes * MIN,
    end: vnMs(currentDate, SHIFT_HOURS[t.shift].end),
  };
}
function isOnShift(t: SimTech, now: number) {
  if (!t.works(currentDay)) return false;
  const w = shiftWindow(t);
  return now >= w.start && now < w.end;
}

function simulate(picker: Picker, { days = 20, seed = 7, arrival = 0.3 } = {}) {
  const rng = mulberry32(seed);
  const mk = (id: string, shift: ShiftKey, works: (d: number) => boolean = () => true, lateMinutes = 0): SimTech => ({
    id, shift, works, lateMinutes, busyUntil: 0, lastEnd: null,
    regular: 0, requested: 0, requestedMinutes: 0, shiftMinutes: 0, tours: 0,
    today: 0, todayRegular: 0, todayShiftMinutes: 0, todayRequested: 0, todayRequestedMinutes: 0, pending: [],
  });
  const techs = [
    mk("sang1", "morning"),
    mk("sang2", "morning", () => true, 120), // hay vào trễ 2 tiếng
    mk("chieu1", "afternoon"),
    mk("chieu2", "afternoon", (d) => d % 2 === 0), // làm cách ngày
    mk("full", "full"),
    mk("khachquen", "morning"), // nhiều khách chỉ định
  ];

  const dailyCv: number[] = [];
  for (let day = 0; day < days; day++) {
    currentDay = day;
    currentDate = new Date(Date.UTC(2026, 9, 1 + day)).toISOString().slice(0, 10);
    for (const t of techs) {
      t.today = 0;
      t.todayRegular = 0;
      t.todayShiftMinutes = 0;
      t.todayRequested = 0;
      t.todayRequestedMinutes = 0;
      t.tours = 0;
    }
    const open = vnMs(currentDate, "09:00");
    const close = vnMs(currentDate, "21:00");
    const waiting: Array<{ fee: number; duration: number; since: number }> = [];
    // 4 khách chỉ định / ngày cho "khachquen" vào giờ ngẫu nhiên trong ca của họ
    const requestedAt = Array.from({ length: 4 }, () => open + Math.floor(rng() * 8 * 60) * MIN).sort((a, b) => a - b);
    const requestedQueue: Array<{ fee: number; duration: number; at: number }> = [];

    for (let now = open; now < close; now += 5 * MIN) {
      // ghi nhận tour hoàn thành (tiền cộng lúc hoàn thành)
      for (const t of techs) {
        t.pending = t.pending.filter((p) => {
          if (p.at > now) return true;
          if (p.requested) {
            t.requested += p.fee;
            t.todayRequested += p.fee;
            t.requestedMinutes += p.minutes;
            t.todayRequestedMinutes += p.minutes;
          } else {
            t.regular += p.fee;
            t.todayRegular += p.fee;
          }
          t.today += p.fee;
          return false;
        });
        if (isOnShift(t, now)) {
          t.shiftMinutes += 5;
          t.todayShiftMinutes += 5;
        }
      }

      while (requestedAt.length && requestedAt[0] <= now) {
        requestedAt.shift();
        const s = SERVICES[Math.floor(rng() * SERVICES.length)];
        requestedQueue.push({ fee: s.fee, duration: s.duration, at: now });
      }
      // khách đến: trung bình `arrival` khách / 5 phút
      if (rng() < arrival) {
        const s = SERVICES[Math.floor(rng() * SERVICES.length)];
        waiting.push({ fee: s.fee, duration: s.duration, since: now });
      }

      // tour chỉ định: KTV đó rảnh thì làm
      const star = techs.find((t) => t.id === "khachquen")!;
      if (requestedQueue.length && isOnShift(star, now) && star.busyUntil <= now) {
        const r = requestedQueue.shift()!;
        star.busyUntil = now + r.duration * MIN;
        star.lastEnd = star.busyUntil;
        star.pending.push({ at: star.busyUntil, fee: r.fee, requested: true, minutes: r.duration });
      }

      // phân tour thường theo thứ tự khách đến
      for (let i = 0; i < waiting.length; ) {
        const w = waiting[i];
        if (now - w.since > 60 * MIN) {
          waiting.splice(i, 1); // khách chờ quá lâu thì về
          continue;
        }
        const snap = snapshotOf(techs, now, w.duration);
        const id = picker(snap, techs, now);
        if (!id) break;
        const t = techs.find((x) => x.id === id)!;
        t.busyUntil = now + w.duration * MIN;
        t.lastEnd = t.busyUntil;
        t.tours++;
        t.pending.push({ at: t.busyUntil, fee: w.fee, requested: false, minutes: w.duration });
        waiting.splice(i, 1);
      }
    }
    // cuối ngày: tour đang dở coi như hoàn thành
    for (const t of techs) {
      for (const p of t.pending) {
        if (p.requested) {
          t.requested += p.fee;
          t.requestedMinutes += p.minutes;
          t.todayRequestedMinutes += p.minutes;
        } else {
          t.regular += p.fee;
          t.todayRegular += p.fee;
        }
      }
      t.pending = [];
      t.busyUntil = 0;
    }
    // độ lệch trong ngày giữa những người có đi làm
    const worked = techs.filter((t) => t.todayShiftMinutes > 0);
    const dayRates = worked.map((t) => t.todayRegular / Math.max(1, (t.todayShiftMinutes - t.todayRequestedMinutes) / 60));
    dailyCv.push(spread(dayRates).cv);
  }

  const rows = techs.map((t) => ({
    id: t.id,
    regular: t.regular,
    requested: t.requested,
    /** đ tour thường / giờ có mặt (trừ giờ làm tour chỉ định) */
    rate: t.regular / Math.max(1, (t.shiftMinutes - t.requestedMinutes) / 60),
  }));
  return Object.assign(rows, { dailyCv: dailyCv.reduce((a, b) => a + b, 0) / dailyCv.length });
}

function snapshotOf(techs: SimTech[], now: number, duration: number): AssignmentSnapshot {
  const technicians: TechnicianSnapshot[] = techs.map((t) => {
    const onShift = isOnShift(t, now);
    const w = shiftWindow(t);
    return {
      id: t.id,
      fullName: t.id,
      gender: "female",
      isActive: true,
      checkedIn: onShift,
      isFree: onShift && t.busyUntil <= now,
      shift: t.shift,
      checkInAt: t.works(currentDay) ? new Date(w.start).toISOString() : null,
      skillServiceIds: [],
      excluded: false,
      todayEarnings: t.today,
      todayRequestedEarnings: t.todayRequested,
      todayRequestedMinutes: t.todayRequestedMinutes,
      monthEarnings: t.regular + t.requested,
      monthRequestedEarnings: t.requested,
      monthRequestedMinutes: t.requestedMinutes,
      monthWorkedMinutes: t.shiftMinutes,
      lastTourEndedAt: t.lastEnd ? new Date(Math.min(t.lastEnd, now)).toISOString() : null,
      declinesToday: 0,
    };
  });
  return {
    now: new Date(now).toISOString(),
    durationMinutes: duration,
    requiredSkillServiceIds: [],
    customerGender: "female",
    settings: { weights: {}, shiftHours: SHIFT_HOURS, randomPoolSize: 3 },
    technicians,
  };
}

function spread(rates: number[]) {
  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
  const sd = Math.sqrt(rates.reduce((a, b) => a + (b - avg) ** 2, 0) / rates.length);
  return { avg, cv: sd / avg, maxOverMin: Math.max(...rates) / Math.min(...rates) };
}

const LEVELS = [
  { arrival: 0.12, label: "vắng khách (~17 tour/ngày)" },
  { arrival: 0.2, label: "vừa (~29 tour/ngày)" },
  { arrival: 0.3, label: "đông (~43 tour/ngày)" },
  { arrival: 0.45, label: "rất đông (quá tải)" },
];
const SEEDS = [1, 2, 3, 7];

function averaged(picker: Picker, arrival: number) {
  let cv = 0;
  let maxOverMin = 0;
  let dailyCv = 0;
  for (const seed of SEEDS) {
    const r = simulate(picker, { seed, arrival });
    const s = spread(r.map((x) => x.rate));
    cv += s.cv / SEEDS.length;
    maxOverMin += s.maxOverMin / SEEDS.length;
    dailyCv += r.dailyCv / SEEDS.length;
  }
  return { cv, maxOverMin, dailyCv };
}

describe("mô phỏng 20 ngày – độ công bằng", () => {
  for (const { arrival, label } of LEVELS) {
    describe(label, () => {
      const app = averaged(appPicker, arrival);
      const byCount = averaged(countPicker, arrival);

      it("tiền tour thường / giờ có mặt cả tháng lệch rất ít (< 5%)", () => {
        expect(app.cv).toBeLessThan(0.05);
        expect(app.maxOverMin).toBeLessThan(1.15);
      });

      it("công bằng hơn chia xoay vòng theo số tour", () => {
        expect(app.cv).toBeLessThan(byCount.cv);
      });

      it("trong từng ngày cũng không kém chia xoay vòng", () => {
        expect(app.dailyCv).toBeLessThanOrEqual(byCount.dailyCv + 0.01);
      });
    });
  }

  describe("từng KTV (ngày đông khách)", () => {
    const rows = simulate(appPicker, { arrival: 0.3 });
    const avg = spread(rows.map((r) => r.rate)).avg;

    it("KTV nhiều khách chỉ định không được chia thêm tour thường", () => {
      const star = rows.find((r) => r.id === "khachquen")!;
      expect(star.requested).toBeGreaterThan(0);
      expect(star.rate).toBeLessThan(avg * 1.05);
      expect(star.rate).toBeGreaterThan(avg * 0.95);
    });

    it("vào ca trễ / làm cách ngày không bị thiệt (so theo giờ có mặt)", () => {
      for (const id of ["sang2", "chieu2"]) {
        const r = rows.find((x) => x.id === id)!;
        expect(r.rate).toBeGreaterThan(avg * 0.95);
      }
    });
  });
});
