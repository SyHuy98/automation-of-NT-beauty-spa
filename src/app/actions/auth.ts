"use server";

import { redirect } from "next/navigation";
import { homeForRole } from "@/lib/auth";
import { getSupabaseServer } from "@/lib/supabase/server";
import { loginSchema } from "@/lib/validation/schemas";

/** Tên đăng nhập → email ảo trong Supabase Auth (KTV không cần email thật) */
const EMAIL_DOMAIN = "ntspa.local";

export interface LoginState {
  error?: string;
  fieldErrors?: { username?: string; password?: string };
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    username: formData.get("username") ?? "",
    password: formData.get("password") ?? "",
  });
  if (!parsed.success) {
    const fe: LoginState["fieldErrors"] = {};
    for (const i of parsed.error.issues) fe[i.path[0] as "username" | "password"] ??= i.message;
    return { fieldErrors: fe };
  }

  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: `${parsed.data.username}@${EMAIL_DOMAIN}`,
    password: parsed.data.password,
  });
  if (error || !data.user) {
    if (error?.message?.toLowerCase().includes("banned")) {
      return { error: "Tài khoản đã bị khoá. Vui lòng liên hệ chủ spa." };
    }
    return { error: "Sai tên đăng nhập hoặc mật khẩu" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile || !profile.is_active) {
    await supabase.auth.signOut();
    return { error: "Tài khoản chưa được kích hoạt hoặc đã bị khoá" };
  }

  redirect(homeForRole(profile.role));
}

export async function logoutAction() {
  const supabase = await getSupabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
