"use client";

import { Money as MoneyText } from "@/components/ui/misc";
import { useSession } from "./session-context";

/** Lễ tân chỉ phân tour – không được xem số tiền (tiền tour, thu nhập KTV) */
export function useCanSeeMoney(): boolean {
  return useSession().role !== "receptionist";
}

/** Số tiền trên Bảng điều phối: ẩn với lễ tân */
export function Money(props: Parameters<typeof MoneyText>[0]) {
  return useCanSeeMoney() ? <MoneyText {...props} /> : null;
}
