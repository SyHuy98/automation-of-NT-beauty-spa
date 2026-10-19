"use client";

import { useRealtime } from "@/lib/hooks/use-realtime";
import { unwrap, useQuery } from "@/lib/hooks/use-query";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { DashboardSnapshot, ServiceRow } from "@/types/app";

/** Dữ liệu bảng điều phối: 1 RPC + Realtime trên các bảng liên quan */
export function useDashboard() {
  const { data, error, refetch } = useQuery(
    async () => unwrap(await getSupabaseBrowser().rpc("dashboard_snapshot")) as unknown as DashboardSnapshot,
    [],
  );

  const connection = useRealtime(
    "dashboard",
    [
      { table: "tours" },
      { table: "tour_offers" },
      { table: "tour_assignments" },
      { table: "shift_checkins" },
      { table: "admin_alerts" },
    ],
    refetch,
    { debounceMs: 200, pollMs: 30_000 },
  );

  return { data, error, refetch, connection };
}

/** Danh sách dịch vụ (mặc định chỉ dịch vụ đang dùng) cho form tạo/sửa tour, bảng giá */
export function useServices(includeInactive = false) {
  const { data, error, refetch } = useQuery(async () => {
    let q = getSupabaseBrowser().from("services").select("*").order("sort_order").order("name");
    if (!includeInactive) q = q.eq("is_active", true);
    return unwrap<ServiceRow[]>(await q);
  }, [includeInactive]);
  return { services: data, error, reload: refetch };
}
