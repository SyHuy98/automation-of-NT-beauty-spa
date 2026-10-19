"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase/client";

export interface RealtimeTable {
  table: string;
  /** Bộ lọc kiểu PostgREST, vd "technician_id=eq.<uuid>" */
  filter?: string;
}

export type ConnectionState = "connecting" | "online" | "offline";

/**
 * Lắng nghe thay đổi (Realtime) trên các bảng rồi gọi `onChange` (đã debounce).
 * - Tự kết nối lại khi mất mạng; khi có mạng / quay lại tab thì gọi onChange để
 *   lấy dữ liệu mới nhất (phòng trường hợp lỡ sự kiện lúc mất kết nối).
 * - Có polling dự phòng (mặc định 30s) để không bao giờ "đứng hình".
 */
export function useRealtime(
  channelName: string,
  tables: RealtimeTable[],
  onChange: () => void,
  options: { debounceMs?: number; pollMs?: number; enabled?: boolean } = {},
): ConnectionState {
  const { debounceMs = 250, pollMs = 30_000, enabled = true } = options;
  const [state, setState] = useState<ConnectionState>("connecting");
  const cb = useRef(onChange);
  const key = JSON.stringify(tables);

  useEffect(() => {
    cb.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled) return;
    const supabase = getSupabaseBrowser();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let channel: RealtimeChannel | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cb.current(), debounceMs);
    };

    const subscribe = () => {
      if (disposed) return;
      channel = supabase.channel(`${channelName}-${Math.random().toString(36).slice(2, 8)}`);
      for (const t of JSON.parse(key) as RealtimeTable[]) {
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table: t.table, ...(t.filter ? { filter: t.filter } : {}) },
          fire,
        );
      }
      channel.subscribe((status) => {
        if (disposed) return;
        if (status === "SUBSCRIBED") {
          setState("online");
          fire(); // đồng bộ lại sau khi (re)connect
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setState(navigator.onLine ? "connecting" : "offline");
          // thử lại sau vài giây với channel mới
          if (channel) supabase.removeChannel(channel);
          channel = null;
          if (retry) clearTimeout(retry);
          retry = setTimeout(subscribe, 3000);
        }
      });
    };

    // Phiên đăng nhập của Realtime phải dùng access token hiện tại (RLS)
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      subscribe();
    });

    const onOnline = () => {
      setState("connecting");
      fire();
    };
    const onOffline = () => setState("offline");
    const onVisible = () => {
      if (document.visibilityState === "visible") fire();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    const poll = pollMs > 0 ? setInterval(() => cb.current(), pollMs) : null;

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      if (retry) clearTimeout(retry);
      if (poll) clearInterval(poll);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) supabase.removeChannel(channel);
    };
  }, [channelName, key, debounceMs, pollMs, enabled]);

  return state;
}
