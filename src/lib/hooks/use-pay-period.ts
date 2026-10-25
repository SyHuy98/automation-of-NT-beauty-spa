"use client";

import { vnToday } from "@/lib/format";
import { payPeriodOf } from "@/lib/pay-period";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useQuery } from "./use-query";

/** Ngày bắt đầu kỳ lương (Cài đặt, mặc định 21) + kỳ hiện tại. null khi đang tải. */
export function usePayPeriodSettings(): { startDay: number; currentPeriod: string } | null {
  const q = useQuery(async () => {
    const { data, error } = await getSupabaseBrowser().from("app_settings").select("payroll_start_day").single();
    if (error) throw error;
    return data.payroll_start_day;
  }, []);
  if (q.data == null) return null;
  return { startDay: q.data, currentPeriod: payPeriodOf(vnToday(), q.data) };
}
