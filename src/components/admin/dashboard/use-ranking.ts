"use client";

import { useCallback, useEffect, useState } from "react";
import { type AssignmentSnapshot, type Gender, rankTechnicians, type RankResult } from "@/lib/assignment";
import { errorMessage } from "@/lib/format";
import { getSupabaseBrowser } from "@/lib/supabase/client";

/**
 * Lấy snapshot từ DB rồi chạy thuật toán gợi ý ngay trên trình duyệt.
 * `customerGender`: giới tính khách đang nhập trên form (tour chưa tạo); bỏ trống
 * thì dùng giới tính đã lưu của tour `tourId`.
 */
export function useRanking(serviceIds: string[], tourId?: string | null, enabled = true, customerGender?: Gender | null) {
  const [snapshot, setSnapshot] = useState<AssignmentSnapshot | null>(null);
  const [result, setResult] = useState<RankResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = serviceIds.join(",");

  const load = useCallback(async (): Promise<{ snapshot: AssignmentSnapshot; result: RankResult } | null> => {
    if (!enabled || !key) {
      setResult(null);
      return null;
    }
    setLoading(true);
    const { data, error: err } = await getSupabaseBrowser().rpc("assignment_snapshot", {
      p_service_ids: key.split(","),
      ...(tourId ? { p_tour_id: tourId } : {}),
    });
    setLoading(false);
    if (err) {
      setError(errorMessage(err));
      return null;
    }
    const raw = data as unknown as AssignmentSnapshot;
    const snap = customerGender ? { ...raw, customerGender } : raw;
    const ranked = rankTechnicians(snap);
    setSnapshot(snap);
    setResult(ranked);
    setError(null);
    return { snapshot: snap, result: ranked };
  }, [key, tourId, enabled, customerGender]);

  useEffect(() => {
    const id = setTimeout(() => void load(), 150);
    return () => clearTimeout(id);
  }, [load]);

  return { snapshot, result, loading, error, reload: load };
}
