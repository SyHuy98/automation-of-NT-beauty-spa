"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/format";
import { useNow } from "@/lib/hooks/use-now";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { DashboardSnapshot, DashboardTechnician, DashboardTour } from "@/types/app";
import { TourDetailDialog } from "./dashboard/tour-detail-dialog";

/**
 * Mở chi tiết 1 tour bất kỳ (kể cả tour ngày cũ) để sửa / đổi KTV / huỷ –
 * dùng ở Nhật ký thao tác và Chốt lương khi xử lý báo sai.
 */
export function useTourLookup() {
  const toast = useToast();
  const [tour, setTour] = useState<DashboardTour | null>(null);
  const [technicians, setTechnicians] = useState<DashboardTechnician[]>([]);
  const now = useNow();

  const open = useCallback(
    async (by: { id?: string; code?: string }) => {
      const supabase = getSupabaseBrowser();
      const [t, d] = await Promise.all([
        supabase.rpc("get_tour", { ...(by.id ? { p_tour_id: by.id } : {}), ...(by.code ? { p_code: by.code } : {}) }),
        supabase.rpc("dashboard_snapshot"),
      ]);
      if (t.error) {
        toast.error(errorMessage(t.error));
        return;
      }
      if (!t.data) {
        toast.warning("Không tìm thấy tour");
        return;
      }
      setTechnicians(((d.data as unknown as DashboardSnapshot) ?? { technicians: [] }).technicians);
      setTour(t.data as unknown as DashboardTour);
    },
    [toast],
  );

  const refresh = useCallback(async () => {
    if (!tour) return;
    const { data } = await getSupabaseBrowser().rpc("get_tour", { p_tour_id: tour.id });
    if (data) setTour(data as unknown as DashboardTour);
  }, [tour]);

  const dialog = (onChanged?: () => void) => (
    <TourDetailDialog
      tour={tour}
      open={!!tour}
      onOpenChange={(v) => !v && setTour(null)}
      technicians={technicians}
      now={now}
      onChanged={() => {
        void refresh();
        onChanged?.();
      }}
    />
  );

  return { open, dialog };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
