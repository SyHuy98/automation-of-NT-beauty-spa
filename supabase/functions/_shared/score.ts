/**
 * Thuật toán gợi ý phân tour – module THUẦN (không import gì) để:
 *  - chạy trên trình duyệt admin (chế độ Gợi ý / Tự động / Random khi tạo tour),
 *  - chạy trong Edge Function `dispatch` (tự chuyển người kế tiếp khi bị từ chối/hết giờ),
 *  - unit test bằng Vitest.
 * File này được copy nguyên văn sang supabase/functions/_shared/score.ts
 * (`npm run sync:edge`; có test kiểm tra 2 bản giống nhau).
 *
 * Dữ liệu đầu vào lấy từ RPC `assignment_snapshot` (Postgres).
 *
 * Nguyên tắc công bằng:
 *  - Cân bằng theo TIỀN tour (không theo số tour): tour 200k và tour 60k không như nhau.
 *  - Chỉ tính TOUR THƯỜNG: tiền và thời gian làm tour khách chỉ định không tính
 *    vào phần chia chung (khách quen là công riêng của KTV).
 *  - Chia theo GIỜ CÓ MẶT: so tiền tour thường / số giờ trong ca (trừ giờ làm tour
 *    chỉ định), nên vào trễ, làm ca chiều hay nghỉ vài ngày đều không bị thiệt/lợi.
 *  - KTV chỉ so với người cùng giới tính (khách nam → KTV nam, khách nữ → KTV nữ).
 */

export type ShiftKey = "morning" | "afternoon" | "full";
export type Gender = "male" | "female";

export interface AssignmentWeights {
  /** Tiền tour thường hôm nay / giờ có mặt – càng thấp càng ưu tiên (giữ đều trong ngày) */
  today: number;
  /**
   * Tiền tour thường cả tháng (gồm hôm nay) / giờ có mặt so với TB nhóm – YẾU TỐ CHÍNH.
   * Mô phỏng 20 ngày (fairness.sim.test.ts) cho thấy dồn trọng số vào đây giữ mức
   * lệch giữa các KTV ~1–4%, tốt hơn hẳn chia xoay vòng theo số tour (5–11%).
   */
  month: number;
  /** Thời gian rảnh kể từ tour gần nhất (mặc định 0: tiền tháng đã cân bằng; hoà điểm thì ai rảnh lâu hơn được trước) */
  idle: number;
  /** Phạt mạnh khi thời gian còn lại của ca < thời lượng tour */
  shiftEnd: number;
  /** Phạt nhẹ khi hôm nay từ chối / để hết giờ nhiều lần */
  declines: number;
}

export const DEFAULT_WEIGHTS: AssignmentWeights = {
  today: 10,
  month: 90,
  idle: 0,
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
  /** Tổng tiền tour hôm nay / tháng này (gồm cả tour chỉ định) */
  todayEarnings: number;
  monthEarnings: number;
  /** Phần tiền từ tour khách chỉ định – không tính vào cân bằng */
  todayRequestedEarnings?: number;
  monthRequestedEarnings: number;
  /** Số phút làm tour khách chỉ định – trừ khỏi giờ có mặt */
  todayRequestedMinutes?: number;
  monthRequestedMinutes?: number;
  /** Tổng số phút trong ca tháng này (tính đến hiện tại); thiếu thì so tiền tháng tuyệt đối */
  monthWorkedMinutes?: number | null;
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
    /** Không còn dùng (tour chỉ định đã không tính vào cân bằng) – giữ để tương thích */
    requestedThresholdPercent?: number;
    shiftHours: Partial<Record<ShiftKey, { start: string; end: string }>>;
    randomPoolSize: number;
  };
  technicians: TechnicianSnapshot[];
}

export interface ScoreBreakdown {
  today: number;
  month: number;
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
  /** TB chỉ số tháng của nhóm giới tính đang xét (đ tour thường / giờ có mặt) */
  groupMonthAverage: number;
  /** TB riêng từng nhóm – mỗi KTV chỉ so với người cùng giới tính */
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

/** Tiền tour thường tháng này, chia theo giờ có mặt (trừ giờ làm tour chỉ định) nếu có dữ liệu giờ */
export function monthMetric(t: TechnicianSnapshot): number {
  const regular = Math.max(0, t.monthEarnings - t.monthRequestedEarnings);
  if (t.monthWorkedMinutes == null) return regular;
  const hours = Math.max(1, (t.monthWorkedMinutes - (t.monthRequestedMinutes ?? 0)) / 60);
  return regular / hours;
}

/** Có tham gia tính TB tháng: đã có giờ làm trong tháng (hoặc không có dữ liệu giờ) */
function inMonthAverage(t: TechnicianSnapshot): boolean {
  return t.monthWorkedMinutes == null || t.monthWorkedMinutes > 0;
}

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
  const vnDate = vnDateString(nowMs);

  // Trung bình nhóm = mọi KTV đang hoạt động đã có giờ làm trong tháng (kể cả
  // đang bận / chưa vào ca), tính RIÊNG từng giới tính.
  const activeTechs = snapshot.technicians.filter((t) => t.isActive && inMonthAverage(t));
  const average = (list: TechnicianSnapshot[]) =>
    list.length > 0 ? list.reduce((s, t) => s + monthMetric(t), 0) / list.length : 0;
  const avgOf = (g: Gender) => average(activeTechs.filter((t) => genderOf(t) === g));
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
  const groupMonthAverage = shownGender !== null ? groupMonthAverages[shownGender] : average(activeTechs);

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
    // Chỉ tour thường, chia cho số giờ có mặt trừ giờ làm tour chỉ định
    const regularToday = Math.max(0, t.todayEarnings - (t.todayRequestedEarnings ?? 0));
    const availableHours = Math.max(1, hoursWorked - (t.todayRequestedMinutes ?? 0) / 60);
    const rate = regularToday / availableHours;
    const lastEndMs = t.lastTourEndedAt ? Date.parse(t.lastTourEndedAt) : 0;
    const idleFrom = Math.max(lastEndMs, checkInMs);
    const idleMinutes = Math.max(0, Math.floor((nowMs - idleFrom) / MINUTE));
    const shiftRemainingMinutes = Math.floor((endMs - nowMs) / MINUTE);
    return { t, rate, regularToday, hoursWorked, idleMinutes, shiftRemainingMinutes, shift };
  });

  const maxRate = Math.max(...ctx.map((c) => c.rate));
  const minRate = Math.min(...ctx.map((c) => c.rate));

  const candidates: RankedCandidate[] = ctx.map((c) => {
    const { t } = c;
    const reasons: string[] = [];
    const warnings: string[] = [];
    // So với TB của nhóm cùng giới tính
    const groupAvg = customerGender === null ? groupMonthAverage : groupMonthAverages[genderOf(t)];

    // 1) Hôm nay: 1 = thấp nhất nhóm, 0 = cao nhất
    const todayScore = maxRate > 0 ? 1 - c.rate / maxRate : 1;

    // 2) Tháng (tour thường / giờ có mặt) so với TB nhóm: dưới TB → cộng, trên TB → trừ
    const monthDiff = groupAvg > 0 ? (monthMetric(t) - groupAvg) / groupAvg : 0;
    const monthScore = -clamp(monthDiff, -1, 1);

    // 3) Rảnh lâu → ưu tiên (bão hoà ở 120 phút)
    const idleScore = Math.min(c.idleMinutes / 120, 1);

    // 4) Gần hết ca: còn ít thời gian hơn thời lượng tour → trừ mạnh
    const nearShiftEnd = c.shiftRemainingMinutes < snapshot.durationMinutes;
    const shiftEndPenalty = nearShiftEnd ? 1 : 0;

    // 5) Từ chối / hết giờ nhiều hôm nay → trừ nhẹ
    const declinePenalty = Math.min(t.declinesToday / 3, 1);

    const breakdown: ScoreBreakdown = {
      today: round1(weights.today * todayScore),
      month: round1(weights.month * monthScore),
      idle: round1(weights.idle * idleScore),
      shiftEnd: round1(-weights.shiftEnd * shiftEndPenalty),
      declines: round1(-weights.declines * declinePenalty),
    };
    const score = round1(
      breakdown.today + breakdown.month + breakdown.idle + breakdown.shiftEnd + breakdown.declines,
    );

    // Lý do ngắn bằng tiếng Việt
    reasons.push(`Rảnh ${c.idleMinutes} phút`);
    const requestedToday = t.todayEarnings - c.regularToday;
    reasons.push(
      `Hôm nay ${formatVndPlain(c.regularToday)}${requestedToday > 0 ? ` (+${formatVndPlain(requestedToday)} chỉ định)` : ""}` +
        `${c.rate === minRate && ctx.length > 1 ? " – thấp nhất" : ""}`,
    );
    const monthPct = Math.round(Math.abs(monthDiff) * 100);
    const groupLabel = customerGender === null ? "" : ` ${GENDER_LABEL[genderOf(t)].toLowerCase()}`;
    if (groupAvg <= 0 || monthPct === 0) reasons.push(`Tháng bằng TB${groupLabel}`);
    else reasons.push(`Tháng ${monthDiff < 0 ? "dưới" : "trên"} TB${groupLabel} ${monthPct}%`);
    if (c.shift === "afternoon" && c.hoursWorked < 4) {
      reasons.push(`Ca chiều, mới làm ${Math.round(c.hoursWorked * 10) / 10} giờ`);
    }
    if (genderFallback) warnings.push("Khách nam – không còn KTV nam rảnh");
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
