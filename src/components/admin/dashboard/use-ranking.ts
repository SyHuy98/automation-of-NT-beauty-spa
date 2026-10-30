"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type AssignmentSnapshot, type Gender, rankTechnicians, type RankResult } from "@/lib/assignment";
import { errorMessage } from "@/lib/format";
import { getSupabaseBrowser } from "@/lib/supabase/client";

/**
 * Lấy snapshot từ DB rồi chạy thuật toán gợi ý ngay trên trình duyệt.
 * `customerGender`: giới tính khách đang nhập trên form (tour chưa tạo); bỏ trống
 * thì dùng giới tính đã lưu của tour `tourId`.
 * - Đổi giới tính / "khách đồng ý KTV nữ" → xếp lại ngay trên snapshot đang có (không gọi lại DB).
 * - Đổi dịch vụ → `loading` = true cho tới khi có snapshot mới (danh sách cũ vẫn hiện
 *   nhưng không bấm được); kết quả của lần tải cũ về muộn bị bỏ qua.
 */
export function useRanking(
  serviceIds: string[],
  tourId?: string | null,
  enabled = true,
  customerGender?: Gender | null,
  /** Khách nam đồng ý KTV nữ (form chưa lưu) → bỏ quy tắc giới tính */
  allowAnyGender = false,
) {
  const [raw, setRaw] = useState<{ key: string; snap: AssignmentSnapshot } | null>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const ids = enabled ? serviceIds.join(",") : "";
  const fetchKey = `${tourId ?? ""}|${ids}`;

  const apply = useCallback(
    (snap: AssignmentSnapshot): AssignmentSnapshot => ({
      ...snap,
      ...(customerGender ? { customerGender } : {}),
      ...(allowAnyGender ? { genderFree: true } : {}),
    }),
    [customerGender, allowAnyGender],
  );
  const applyRef = useRef(apply);
  useEffect(() => {
    applyRef.current = apply;
  }, [apply]);

  const load = useCallback(async (): Promise<{ snapshot: AssignmentSnapshot; result: RankResult } | null> => {
    const my = ++seq.current;
    if (!ids) {
      setFetching(false);
      return null;
    }
    setFetching(true);
    const { data, error: err } = await getSupabaseBrowser().rpc("assignment_snapshot", {
      p_service_ids: ids.split(","),
      ...(tourId ? { p_tour_id: tourId } : {}),
    });
    const latest = my === seq.current;
    if (latest) setFetching(false);
    if (err) {
      if (latest) setError(errorMessage(err));
      return null;
    }
    const snap = data as unknown as AssignmentSnapshot;
    if (latest) {
      setRaw({ key: `${tourId ?? ""}|${ids}`, snap });
      setError(null);
    }
    const applied = applyRef.current(snap);
    return { snapshot: applied, result: rankTechnicians(applied) };
  }, [ids, tourId]);

  useEffect(() => {
    const id = setTimeout(() => void load(), 150);
    return () => clearTimeout(id);
  }, [load]);

  const base = ids && raw ? raw.snap : null;
  const snapshot = useMemo(() => (base ? apply(base) : null), [base, apply]);
  const result = useMemo(() => (snapshot ? rankTechnicians(snapshot) : null), [snapshot]);
  // snapshot đang hiện thuộc bộ dịch vụ cũ → coi như đang tải
  const stale = !!ids && raw?.key !== fetchKey;

  return { snapshot, result, loading: fetching || stale, error, reload: load };
}
