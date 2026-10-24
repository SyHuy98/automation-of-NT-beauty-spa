/**
 * Thuật toán gợi ý phân tour – module THUẦN (không import gì) để:
 *  - chạy trên trình duyệt admin (chế độ Gợi ý / Tự động / Random khi tạo tour),
 *  - chạy trong Edge Function `dispatch` (tự chuyển người kế tiếp khi bị từ chối/hết giờ),
 *  - unit test bằng Vitest.
 * File này được copy nguyên văn sang supabase/functions/_shared/score.ts
 * (`npm run sync:edge`; có test kiểm tra 2 bản giống nhau).
 *
 * Dữ liệu đầu vào lấy từ RPC `assignment_snapshot` (Postgres).
 */

export type ShiftKey = "morning" | "afternoon" | "full";
export type Gender = "male" | "female";

export interface AssignmentWeights {
  /** Thu nhập hôm nay (đã chuẩn hoá theo giờ làm) càng thấp càng ưu tiên – yếu tố chính */
  today: number;
  /** Thu nhập tháng so với trung bình nhóm */
  month: number;
  /** Phạt khi tiền tour chỉ định đẩy KTV vượt TB nhóm quá ngưỡng */
  requested: number;
  /** Thời gian rảnh kể từ tour gần nhất */
  idle: number;
  /** Phạt mạnh khi thời gian còn lại của ca < thời lượng tour */
  shiftEnd: number;
  /** Phạt nhẹ khi hôm nay từ chối / để hết giờ nhiều lần */
  declines: number;
}

export const DEFAULT_WEIGHTS: AssignmentWeights = {
  today: 40,
  month: 25,
  requested: 15,
  idle: 15,
  shiftEnd: 50,
  declines: 5,
};

export interface TechnicianSnapshot {
  id: string;
  fullName: string;
  /** Giới tính KTV; thiếu thì coi là nữ */
  gender?: Gender | null;
  isActive: boolean;
  checkedIn: boolean;
  isFree: boolean;
  busyReason?: string | null;
  shift: ShiftKey | null;
  checkInAt: string | null;
  skillServiceIds: string[];
  /** Đã từ chối / để hết giờ chính tour này ở lượt trước */
  excluded: boolean;
  todayEarnings: number;
  monthEarnings: number;
  monthRequestedEarnings: number;
  lastTourEndedAt: string | null;
  declinesToday: number;
}

export interface AssignmentSnapshot {
  now: string;
  durationMinutes: number;
  requiredSkillServiceIds: string[];
  /**
   * Giới tính khách. Nữ → chỉ KTV nữ. Nam → chỉ KTV nam, nếu không còn KTV nam
   * nào phù hợp thì chuyển sang KTV nữ. Không có → không lọc theo giới tính.
   */
  customerGender?: Gender | null;
  settings: {
    weights: Partial<AssignmentWeights>;
    requestedThresholdPercent: number;
    shiftHours: Partial<Record<ShiftKey, { start: string; end: string }>>;
    randomPoolSize: number;
  };
  technicians: TechnicianSnapshot[];
}

export interface ScoreBreakdown {
  today: number;
  month: number;
  requested: number;
  idle: number;
  shiftEnd: number;
  declines: number;
}

export interface RankedCandidate {
  technicianId: string;
  fullName: string;
  score: number;
  reasons: string[];
  warnings: string[];
  breakdown: ScoreBreakdown;
  idleMinutes: number;
  todayEarnings: number;
  monthDiffPercent: number;
  shiftRemainingMinutes: number | null;
}

export interface ExcludedTechnician {
  technicianId: string;
  fullName: string;
  reason: string;
}

export interface RankResult {
  candidates: RankedCandidate[];
  excluded: ExcludedTechnician[];
  /** Thông báo cho admin khi không còn ai phù hợp */
  message: string | null;
  /** TB tháng của nhóm giới tính đang xét (nhóm của các ứng viên) */
  groupMonthAverage: number;
  /** TB tháng riêng từng nhóm – mỗi KTV chỉ so với người cùng giới tính */
  groupMonthAverages: Record<Gender, number>;
  /** Khách nam nhưng không còn KTV nam phù hợp → đang xếp KTV nữ */
  genderFallback: boolean;
}

const DEFAULT_SHIFT_HOURS: Record<ShiftKey, { start: string; end: string }> = {
  morning: { start: "09:00", end: "18:00" },
  afternoon: { start: "12:00", end: "21:00" },
  full: { start: "09:00", end: "21:00" },
};

const MINUTE = 60_000;
const VN_OFFSET_MS = 7 * 60 * MINUTE; // Việt Nam không có giờ mùa hè

/** Định dạng tiền VND kiểu vi-VN: 150000 → "150.000 ₫" (không phụ thuộc Intl để chạy giống nhau mọi nơi) */
export function formatVndPlain(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const digits = Math.round(Math.abs(amount)).toString();
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".")} ₫`;
}

/** Ngày hiện tại theo giờ VN dạng YYYY-MM-DD */
export function vnDateString(nowMs: number): string {
  return new Date(nowMs + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** "HH:MM" của ngày VN → epoch ms */
export function vnTimeToMs(vnDate: string, hhmm: string): number {
  return Date.parse(`${vnDate}T${hhmm}:00+07:00`);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function genderOf(t: Pick<TechnicianSnapshot, "gender">): Gender {
  return t.gender === "male" ? "male" : "female";
}

export const GENDER_LABEL: Record<Gender, string> = { male: "Nam", female: "Nữ" };

function round1(v: number): number {
  // `|| 0` để không ra -0
  return Math.round(v * 10) / 10 || 0;
}

/** Bước 1 – lọc: trả về lý do loại (tiếng Việt) hoặc null nếu đạt */
export function exclusionReason(t: TechnicianSnapshot, requiredSkillServiceIds: string[]): string | null {
  if (!t.isActive) return "Tài khoản đã khoá";
  if (!t.checkedIn) return "Chưa vào ca";
  if (!t.isFree) return t.busyReason ?? "Đang bận";
  if (t.excluded) return "Đã từ chối / không phản hồi tour này";
  const skills = new Set(t.skillServiceIds);
  const missing = requiredSkillServiceIds.filter((id) => !skills.has(id));
  if (missing.length > 0) return "Thiếu kỹ năng cho dịch vụ của tour";
  return null;
}

/**
 * Bước 2 + 3 – chấm điểm và giải thích. Trả về ứng viên sắp xếp điểm giảm dần.
 */
export function rankTechnicians(snapshot: AssignmentSnapshot): RankResult {
  const nowMs = Date.parse(snapshot.now);
  const weights: AssignmentWeights = { ...DEFAULT_WEIGHTS, ...snapshot.settings.weights };
  const shiftHours = { ...DEFAULT_SHIFT_HOURS, ...snapshot.settings.shiftHours };
  const threshold = snapshot.settings.requestedThresholdPercent / 100;
  const vnDate = vnDateString(nowMs);

  // Trung bình nhóm = mọi KTV đang hoạt động (kể cả đang bận / chưa vào ca),
  // tính RIÊNG từng giới tính: KTV nam chỉ so với nam, nữ chỉ so với nữ.
  const activeTechs = snapshot.technicians.filter((t) => t.isActive);
  const avgOf = (g: Gender) => {
    const group = activeTechs.filter((t) => genderOf(t) === g);
    return group.length > 0 ? group.reduce((s, t) => s + t.monthEarnings, 0) / group.length : 0;
  };
  const groupMonthAverages: Record<Gender, number> = { male: avgOf("male"), female: avgOf("female") };

  const excluded: ExcludedTechnician[] = [];
  let eligible: TechnicianSnapshot[] = [];
  for (const t of snapshot.technicians) {
    const reason = exclusionReason(t, snapshot.requiredSkillServiceIds);
    if (reason) excluded.push({ technicianId: t.id, fullName: t.fullName, reason });
    else eligible.push(t);
  }

  // Lọc theo giới tính khách
  let genderFallback = false;
  const customerGender = snapshot.customerGender ?? null;
  if (customerGender === "female") {
    for (const t of eligible.filter((t) => genderOf(t) === "male")) {
      excluded.push({ technicianId: t.id, fullName: t.fullName, reason: "Khách nữ – chỉ phân KTV nữ" });
    }
    eligible = eligible.filter((t) => genderOf(t) === "female");
  } else if (customerGender === "male") {
    const males = eligible.filter((t) => genderOf(t) === "male");
    if (males.length > 0) {
      for (const t of eligible.filter((t) => genderOf(t) === "female")) {
        excluded.push({ technicianId: t.id, fullName: t.fullName, reason: "Khách nam – còn KTV nam rảnh" });
      }
      eligible = males;
    } else {
      genderFallback = eligible.length > 0;
    }
  }

  // TB hiển thị = nhóm của các ứng viên (khách nam → nam, trừ khi chuyển KTV nữ)
  const shownGender: Gender | null =
    customerGender === "male" && !genderFallback ? "male" : customerGender ? "female" : null;
  const groupMonthAverage =
    shownGender !== null
      ? groupMonthAverages[shownGender]
      : activeTechs.length > 0
        ? activeTechs.reduce((s, t) => s + t.monthEarnings, 0) / activeTechs.length
        : 0;

  if (eligible.length === 0) {
    return {
      candidates: [],
      excluded,
      message:
        customerGender === "female"
          ? "Hiện không có KTV nữ nào rảnh và phù hợp cho tour này"
          : "Hiện không có KTV nào rảnh và phù hợp cho tour này",
      groupMonthAverage,
      groupMonthAverages,
      genderFallback: false,
    };
  }

  // Chuẩn hoá thu nhập hôm nay theo số giờ đã làm, để KTV ca chiều vừa vào
  // (ít cơ hội trong ngày) không bị thiệt so với ca sáng.
  const ctx = eligible.map((t) => {
    const shift = t.shift ?? "morning";
    const startMs = vnTimeToMs(vnDate, shiftHours[shift].start);
    const endMs = vnTimeToMs(vnDate, shiftHours[shift].end);
    const checkInMs = t.checkInAt ? Date.parse(t.checkInAt) : nowMs;
    const workStart = Math.max(startMs, Math.min(checkInMs, nowMs));
    const hoursWorked = Math.max(1, (nowMs - workStart) / (60 * MINUTE));
    const rate = t.todayEarnings / hoursWorked;
    const lastEndMs = t.lastTourEndedAt ? Date.parse(t.lastTourEndedAt) : 0;
    const idleFrom = Math.max(lastEndMs, checkInMs);
    const idleMinutes = Math.max(0, Math.floor((nowMs - idleFrom) / MINUTE));
    const shiftRemainingMinutes = Math.floor((endMs - nowMs) / MINUTE);
    return { t, rate, hoursWorked, idleMinutes, shiftRemainingMinutes, shift };
  });

  const maxRate = Math.max(...ctx.map((c) => c.rate));
  const minToday = Math.min(...ctx.map((c) => c.t.todayEarnings));

  const candidates: RankedCandidate[] = ctx.map((c) => {
    const { t } = c;
    const reasons: string[] = [];
    const warnings: string[] = [];
    // So với TB của nhóm cùng giới tính
    const groupAvg = customerGender === null ? groupMonthAverage : groupMonthAverages[genderOf(t)];

    // 1) Hôm nay: 1 = thấp nhất nhóm, 0 = cao nhất
    const todayScore = maxRate > 0 ? 1 - c.rate / maxRate : 1;

    // 2) Tháng so với TB nhóm: dưới TB → cộng, trên TB → trừ
    const monthDiff = groupAvg > 0 ? (t.monthEarnings - groupAvg) / groupAvg : 0;
    const monthScore = -clamp(monthDiff, -1, 1);

    // 3) Phạt lệch do tour chỉ định: chỉ khi tháng vượt TB*(1+ngưỡng) và có tiền tour chỉ định
    let requestedPenalty = 0;
    if (groupAvg > 0 && t.monthRequestedEarnings > 0) {
      const overshoot = t.monthEarnings - groupAvg * (1 + threshold);
      if (overshoot > 0) {
        requestedPenalty = clamp(Math.min(overshoot, t.monthRequestedEarnings) / groupAvg, 0, 1);
      }
    }

    // 4) Rảnh lâu → ưu tiên (bão hoà ở 120 phút)
    const idleScore = Math.min(c.idleMinutes / 120, 1);

    // 5) Gần hết ca: còn ít thời gian hơn thời lượng tour → trừ mạnh
    const nearShiftEnd = c.shiftRemainingMinutes < snapshot.durationMinutes;
    const shiftEndPenalty = nearShiftEnd ? 1 : 0;

    // 6) Từ chối / hết giờ nhiều hôm nay → trừ nhẹ
    const declinePenalty = Math.min(t.declinesToday / 3, 1);

    const breakdown: ScoreBreakdown = {
      today: round1(weights.today * todayScore),
      month: round1(weights.month * monthScore),
      requested: round1(-weights.requested * requestedPenalty),
      idle: round1(weights.idle * idleScore),
      shiftEnd: round1(-weights.shiftEnd * shiftEndPenalty),
      declines: round1(-weights.declines * declinePenalty),
    };
    const score = round1(
      breakdown.today + breakdown.month + breakdown.requested + breakdown.idle + breakdown.shiftEnd + breakdown.declines,
    );

    // Lý do ngắn bằng tiếng Việt
    reasons.push(`Rảnh ${c.idleMinutes} phút`);
    reasons.push(
      `Hôm nay ${formatVndPlain(t.todayEarnings)}${t.todayEarnings === minToday && ctx.length > 1 ? " (thấp nhất)" : ""}`,
    );
    const monthPct = Math.round(Math.abs(monthDiff) * 100);
    const groupLabel = customerGender === null ? "" : ` ${GENDER_LABEL[genderOf(t)].toLowerCase()}`;
    if (groupAvg <= 0 || monthPct === 0) reasons.push(`Tháng bằng TB${groupLabel}`);
    else reasons.push(`Tháng ${monthDiff < 0 ? "dưới" : "trên"} TB${groupLabel} ${monthPct}%`);
    if (c.shift === "afternoon" && c.hoursWorked < 4) {
      reasons.push(`Ca chiều, mới làm ${Math.round(c.hoursWorked * 10) / 10} giờ`);
    }
    if (genderFallback) warnings.push("Khách nam – không còn KTV nam rảnh");
    if (requestedPenalty > 0) warnings.push("Tiền tour chỉ định đang vượt TB nhóm");
    if (nearShiftEnd) {
      warnings.push(`Sắp hết ca (còn ${Math.max(0, c.shiftRemainingMinutes)} phút)`);
    }
    if (t.declinesToday > 0) warnings.push(`Đã từ chối/bỏ lỡ ${t.declinesToday} lần hôm nay`);

    return {
      technicianId: t.id,
      fullName: t.fullName,
      score,
      reasons,
      warnings,
      breakdown,
      idleMinutes: c.idleMinutes,
      todayEarnings: t.todayEarnings,
      monthDiffPercent: Math.round(monthDiff * 100),
      shiftRemainingMinutes: c.shiftRemainingMinutes,
    };
  });

  candidates.sort((a, b) => b.score - a.score || b.idleMinutes - a.idleMinutes || a.fullName.localeCompare(b.fullName));
  return { candidates, excluded, message: null, groupMonthAverage, groupMonthAverages, genderFallback };
}

/** Chế độ Tự động: người điểm cao nhất */
export function pickAuto(result: RankResult): RankedCandidate | null {
  return result.candidates[0] ?? null;
}

/**
 * Chế độ Random cân bằng: chọn ngẫu nhiên có trọng số trong nhóm `poolSize`
 * người điểm cao nhất. Trọng số = điểm − điểm thấp nhất trong nhóm + 10, nên
 * người điểm cao vẫn có xác suất cao hơn nhưng không cứng nhắc.
 * `rng` trả về số trong [0, 1) – truyền vào để test được.
 */
export function pickWeightedRandom(
  result: RankResult,
  poolSize: number,
  rng: () => number = Math.random,
): RankedCandidate | null {
  const pool = result.candidates.slice(0, Math.max(1, poolSize));
  if (pool.length === 0) return null;
  const minScore = Math.min(...pool.map((c) => c.score));
  const weights = pool.map((c) => c.score - minScore + 10);
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r < 0) return pool[i];
  }
  return pool[pool.length - 1];
}
