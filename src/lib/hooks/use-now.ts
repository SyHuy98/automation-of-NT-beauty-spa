"use client";

import { useEffect, useState } from "react";

const offsetOf = (serverNow?: string | null) => (serverNow ? Date.parse(serverNow) - Date.now() : 0);

/**
 * Đồng hồ chạy theo giây, đã bù lệch giờ giữa điện thoại và server
 * (serverNow lấy từ snapshot). Dùng cho mọi đồng hồ đếm ngược.
 * Độ lệch được áp dụng ngay từ lần hiển thị đầu (điện thoại chạy nhanh không bị
 * báo "hết giờ" sai ngay khi mở lời mời).
 */
export function useNow(serverNow?: string | null, intervalMs = 1000): number {
  const [sync, setSync] = useState(() => ({ key: serverNow ?? null, offset: offsetOf(serverNow) }));
  const [tick, setTick] = useState(() => Date.now());

  // snapshot mới → tính lại độ lệch ngay trong lần hiển thị này
  if ((serverNow ?? null) !== sync.key) {
    setSync({ key: serverNow ?? null, offset: offsetOf(serverNow) });
  }

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return tick + sync.offset;
}
