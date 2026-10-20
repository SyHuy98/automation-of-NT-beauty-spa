// Kiểu dữ liệu trả về từ các RPC dạng JSON (dashboard_snapshot, my_snapshot…)
import type { Database } from "./database";

export type ShiftType = Database["public"]["Enums"]["shift_type"];
export type TourStatus = Database["public"]["Enums"]["tour_status"];
export type AssignMode = Database["public"]["Enums"]["assign_mode"];
export type AssignmentStatus = Database["public"]["Enums"]["assignment_status"];
export type UserRole = Database["public"]["Enums"]["user_role"];
export type ServiceRow = Database["public"]["Tables"]["services"]["Row"];
export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type SettingsRow = Database["public"]["Tables"]["app_settings"]["Row"];
export type EarningLine = Database["public"]["Views"]["earning_lines"]["Row"];

export type ShiftHours = Partial<Record<Exclude<ShiftType, "off">, { start: string; end: string }>>;

export interface TourItemLite {
  serviceId?: string;
  name: string;
  fee: number;
  duration: number;
}

export interface DashboardTechnician {
  id: string;
  fullName: string;
  username: string;
  /** Ca theo Lịch ca hôm nay; null = chưa xếp */
  scheduledShift: ShiftType | null;
  checkin: { shift: ShiftType; checkInAt: string; checkOutAt: string | null } | null;
  offer: { id: string; tourId: string; code: string; customerName: string; offeredAt: string; expiresAt: string } | null;
  work: {
    tourId: string;
    code: string;
    customerName: string;
    status: AssignmentStatus;
    startedAt: string | null;
    isRequested: boolean;
    durationMinutes: number;
    services: string;
  } | null;
  todayAmount: number;
  monthAmount: number;
  monthRequestedAmount: number;
  todayTours: number;
  lastTourEndedAt: string | null;
}

export interface DashboardTour {
  id: string;
  code: string;
  customerName: string;
  customerPhone: string | null;
  note: string | null;
  status: TourStatus;
  assignMode: AssignMode;
  isRequested: boolean;
  requestedTechnicianId: string | null;
  requestedTechnicianName: string | null;
  teamSize: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledReason: string | null;
  totalFee: number;
  durationMinutes: number;
  items: TourItemLite[];
  members: Array<{
    assignmentId: string;
    technicianId: string;
    name: string;
    status: AssignmentStatus;
    sharePercent: number;
    amount: number;
  }>;
  pendingOffers: Array<{ id: string; technicianId: string; name: string; expiresAt: string; sharePercent: number }>;
}

export interface DashboardAlert {
  id: number;
  tourId: string | null;
  kind: string;
  message: string;
  createdAt: string;
}

export interface DashboardSnapshot {
  now: string;
  today: string;
  settings: {
    offerTimeoutSeconds: number;
    shiftHours: ShiftHours;
    imbalanceThresholdPercent: number;
    requestedThresholdPercent: number;
  };
  technicians: DashboardTechnician[];
  tours: DashboardTour[];
  alerts: DashboardAlert[];
}

export interface MyTourInfo {
  id: string;
  code: string;
  customerName: string;
  note: string | null;
  isRequested: boolean;
  teamSize: number;
  items: TourItemLite[];
  totalFee: number;
  durationMinutes: number;
}

export interface MySnapshot {
  now: string;
  today: string;
  profile: { id: string; fullName: string; username: string };
  /** Ca theo Lịch ca hôm nay; null = chưa xếp */
  scheduledShift: ShiftType | null;
  settings: { offerTimeoutSeconds: number; declineReasons: string[]; shiftHours: ShiftHours };
  checkin: { shift: ShiftType; checkInAt: string; checkOutAt: string | null } | null;
  offer: {
    id: string;
    offeredAt: string;
    expiresAt: string;
    sharePercent: number;
    tour: MyTourInfo;
  } | null;
  work: {
    assignmentStatus: AssignmentStatus;
    sharePercent: number;
    tour: MyTourInfo & { startedAt: string | null; partners: Array<{ name: string; status: AssignmentStatus }> };
  } | null;
  todayAmount: number;
  todayTours: number;
  monthAmount: number;
  monthTours: number;
  unreadAnnouncements: number;
}

/** Trạng thái hiển thị của KTV (tính ra, không lưu) */
export type TechStatus = "off" | "free" | "pending" | "busy";

export function techStatus(t: Pick<DashboardTechnician, "checkin" | "offer" | "work">): TechStatus {
  if (t.work) return t.work.status === "working" ? "busy" : "pending";
  if (t.offer) return "pending";
  if (t.checkin && !t.checkin.checkOutAt) return "free";
  return "off";
}

export const TECH_STATUS_LABEL: Record<TechStatus, string> = {
  off: "Chưa vào ca",
  free: "Rảnh",
  pending: "Chờ xác nhận",
  busy: "Đang làm",
};
