"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { playChime, vibrate } from "@/lib/alerts";
import { errorMessage } from "@/lib/format";
import { type ConnectionState, useRealtime } from "@/lib/hooks/use-realtime";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { MySnapshot } from "@/types/app";
import { useSession } from "../shared/session-context";

interface KtvData {
  data: MySnapshot | null;
  error: string | null;
  connection: ConnectionState;
  refetch: () => Promise<void>;
}

const Ctx = createContext<KtvData | null>(null);

/**
 * Dữ liệu màn hình KTV (my_snapshot) dùng chung cho trang chính, popup tour mới,
 * badge thông báo. Realtime chỉ lắng nghe dữ liệu của chính KTV (lọc theo id + RLS).
 */
export function KtvDataProvider({ children }: { children: ReactNode }) {
  const me = useSession();
  const [data, setData] = useState<MySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastOfferId = useRef<string | null | undefined>(undefined);
  const inflight = useRef<Promise<void> | null>(null);
  // có sự kiện mới trong lúc đang tải → tải thêm 1 lần sau đó (lần đang chạy có thể
  // đã đọc DB trước khi thay đổi được ghi, vd. lời mời mới)
  const dirty = useRef(false);

  const refetch = useCallback(async (): Promise<void> => {
    if (inflight.current) {
      dirty.current = true;
      return inflight.current;
    }
    const run = (async () => {
      try {
        const { data: snap, error: err } = await getSupabaseBrowser().rpc("my_snapshot");
        if (err) throw err;
        const s = snap as unknown as MySnapshot;
        // Offer mới xuất hiện → chuông + rung
        const offerId = s.offer?.id ?? null;
        if (lastOfferId.current !== undefined && offerId && offerId !== lastOfferId.current) {
          playChime(2);
          vibrate();
        }
        lastOfferId.current = offerId;
        setData(s);
        setError(null);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        inflight.current = null;
      }
      if (dirty.current) {
        dirty.current = false;
        await refetchRef.current();
      }
    })();
    inflight.current = run;
    return run;
  }, []);
  const refetchRef = useRef(refetch);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Service worker nhận push khi app đang mở → làm mới ngay
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "push") void refetch();
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [refetch]);

  const filter = `technician_id=eq.${me.id}`;
  const connection = useRealtime(
    `ktv-${me.id}`,
    [
      { table: "tour_offers", filter },
      { table: "tour_assignments", filter },
      { table: "shift_checkins", filter },
      { table: "announcement_recipients", filter },
      { table: "tours" },
    ],
    () => void refetch(),
    { debounceMs: 150, pollMs: 20_000 },
  );

  return <Ctx.Provider value={{ data, error, connection, refetch }}>{children}</Ctx.Provider>;
}

export function useKtvData(): KtvData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useKtvData phải nằm trong KtvDataProvider");
  return v;
}
