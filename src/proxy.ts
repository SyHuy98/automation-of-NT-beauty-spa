import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

/**
 * Proxy (trước đây là middleware):
 *  1. Làm mới phiên Supabase (cookie) ở mỗi request.
 *  2. Chặn truy cập sai vai trò: owner/manager → /admin, KTV → /ktv.
 * Layout của /admin và /ktv kiểm tra lại lần nữa ở server (phòng thủ nhiều lớp).
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAdminArea = path.startsWith("/admin");
  const isKtvArea = path.startsWith("/ktv");
  const isLogin = path === "/login";

  const redirectTo = (target: string) => {
    const url = request.nextUrl.clone();
    url.pathname = target;
    url.search = "";
    const res = NextResponse.redirect(url);
    // giữ cookie phiên vừa làm mới
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };

  if (!user) {
    return isAdminArea || isKtvArea || path === "/" ? redirectTo("/login") : response;
  }

  if (isAdminArea || isKtvArea || isLogin || path === "/") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, is_active")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile || !profile.is_active) {
      return isLogin ? response : redirectTo("/login");
    }
    const home = profile.role === "technician" ? "/ktv" : "/admin";
    if (isLogin || path === "/") return redirectTo(home);
    if (isAdminArea && profile.role === "technician") return redirectTo("/ktv");
    if (isKtvArea && profile.role !== "technician") return redirectTo("/admin");
    // Lễ tân chỉ dùng Bảng điều phối
    if (isAdminArea && profile.role === "receptionist" && path !== "/admin") return redirectTo("/admin");
  }

  return response;
}

export const config = {
  matcher: [
    // Bỏ qua file tĩnh, icon, service worker, manifest
    "/((?!_next/static|_next/image|icons/|sw\\.js|manifest\\.webmanifest|icon\\.png|offline\\.html|.*\\.(?:png|svg|jpg|jpeg|webp|ico|mp3)$).*)",
  ],
};
