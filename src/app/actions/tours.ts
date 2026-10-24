"use server";

import { getSupabaseServer } from "@/lib/supabase/server";
import { fieldErrors, tourCreateSchema } from "@/lib/validation/schemas";
import type { Json } from "@/types/database";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export interface CreatedTour {
  id: string;
  code: string;
  offers: Array<{ queued: boolean; technician_id: string; offer_id?: string; reason?: string }>;
}

/**
 * Tạo tour: validate bằng Zod ở server rồi gọi RPC `create_tour` bằng phiên của
 * người dùng (Postgres kiểm tra quyền owner/manager và mọi ràng buộc nghiệp vụ).
 */
export async function createTourAction(input: unknown): Promise<ActionResult<CreatedTour>> {
  const parsed = tourCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dữ liệu chưa hợp lệ", fieldErrors: fieldErrors(parsed.error) };
  }
  const v = parsed.data;
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.rpc("create_tour", {
    p: {
      customer_name: v.customer_name,
      customer_phone: v.customer_phone || null,
      customer_gender: v.customer_gender,
      note: v.note || null,
      service_ids: v.service_ids,
      assign_mode: v.assign_mode,
      team_size: v.team_size,
      requested_technician_id: v.requested_technician_id,
      offers: v.offers,
    } as unknown as Json,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as unknown as CreatedTour };
}
