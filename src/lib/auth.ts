import "server-only";
import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type UserRole = Database["public"]["Enums"]["user_role"];

export interface SessionProfile {
  id: string;
  fullName: string;
  username: string;
  role: UserRole;
  shift: Database["public"]["Enums"]["shift_type"];
}

/** Hồ sơ người đang đăng nhập (null nếu chưa đăng nhập / bị khoá / chưa có hồ sơ) */
export async function getSessionProfile(): Promise<SessionProfile | null> {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, username, role, shift, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (!data || !data.is_active) return null;
  return { id: data.id, fullName: data.full_name, username: data.username, role: data.role, shift: data.shift };
}

export function homeForRole(role: UserRole): string {
  return role === "technician" ? "/ktv" : "/admin";
}

/** Dùng trong layout: bắt buộc đúng vai trò, sai thì chuyển hướng */
export async function requireRole(roles: UserRole[]): Promise<SessionProfile> {
  const profile = await getSessionProfile();
  if (!profile) redirect("/login");
  if (!roles.includes(profile.role)) redirect(homeForRole(profile.role));
  return profile;
}
