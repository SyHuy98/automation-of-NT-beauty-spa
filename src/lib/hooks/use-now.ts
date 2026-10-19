"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Đồng hồ chạy theo giây, đã bù lệch giờ giữa điện thoại và server
 * (serverNow lấy từ snapshot). Dùng cho mọi đồng hồ đếm ngược.
 */
export function useNow(serverNow?: string | null, intervalMs = 1000): number {
  const offset = useRef(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (serverNow) offset.current = Date.parse(serverNow) - Date.now();
  }, [serverNow]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset.current), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
