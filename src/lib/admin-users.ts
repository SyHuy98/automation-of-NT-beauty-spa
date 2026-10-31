"use client";

import { FunctionsHttpError } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase/client";

export type AdminUsersBody =
  | {
      action: "create";
      username: string;
      password: string;
      full_name: string;
      phone?: string;
      role: "technician" | "manager" | "receptionist";
      gender?: "male" | "female";
      skill_ids: string[];
    }
  | { action: "reset_password"; id: string; password: string }
  | { action: "set_active"; id: string; active: boolean }
  | { action: "delete"; id: string };

/**
 * Gọi Edge Function `admin-users` (chạy với service role ở phía Supabase, kiểm
 * tra người gọi là owner). Trả về thông báo lỗi tiếng Việt nếu thất bại.
 */
export async function adminUsers<T = { ok: true }>(body: AdminUsersBody): Promise<T> {
  const { data, error } = await getSupabaseBrowser().functions.invoke("admin-users", { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null);
      throw new Error(payload?.error ?? "Không thực hiện được thao tác");
    }
    throw new Error("Không kết nối được máy chủ – vui lòng thử lại");
  }
  return data as T;
}
