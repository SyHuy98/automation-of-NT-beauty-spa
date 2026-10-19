"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/format";

/**
 * Tải dữ liệu khi mount / khi `deps` đổi, theo mẫu React khuyến nghị
 * (setState trong callback của promise, bỏ qua kết quả cũ khi deps đã đổi).
 * - `data` = null trong lúc tải bộ deps mới (hiện loading).
 * - `refetch()` tải lại im lặng (giữ dữ liệu cũ đến khi có dữ liệu mới) – dùng cho Realtime.
 */
export function useQuery<T>(fetcher: () => Promise<T>, deps: readonly unknown[]) {
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const depsKey = JSON.stringify(deps);
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({
    key: null,
    data: null,
    error: null,
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let ignore = false;
    fetcherRef.current().then(
      (data) => {
        if (!ignore) setState({ key: depsKey, data, error: null });
      },
      (e: unknown) => {
        if (!ignore) setState((s) => ({ ...s, key: depsKey, error: errorMessage(e) }));
      },
    );
    return () => {
      ignore = true;
    };
  }, [depsKey, version]);

  const refetch = useCallback(() => setVersion((v) => v + 1), []);
  const current = state.key === depsKey;

  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: !current,
    refetch,
  };
}

/** Ném lỗi Supabase để useQuery hiển thị thông báo */
export function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data as T;
}
