// Edge Function `admin-users`: tạo / đặt lại mật khẩu / khoá / xoá tài khoản.
// Cần quyền service role của Supabase Auth nên chạy ở server (Edge Function có
// sẵn service role key – không phải đưa key này lên Vercel hay trình duyệt).
// Mọi action (trừ bootstrap) yêu cầu người gọi là owner đang hoạt động.
import { z } from "npm:zod@4.6.7";
import { corsHeaders, json, loadConfig, serviceClient, verifyInternalSecret } from "../_shared/internal.ts";

const EMAIL_DOMAIN = "ntspa.local";
const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, "Tên đăng nhập 3–32 ký tự: chữ thường không dấu, số, dấu . _ -");
const passwordSchema = z.string().min(6, "Mật khẩu tối thiểu 6 ký tự").max(72, "Mật khẩu quá dài");
const phoneSchema = z
  .string()
  .trim()
  .regex(/^[0-9 +.-]{8,20}$/, "Số điện thoại không hợp lệ")
  .optional()
  .or(z.literal("").transform(() => undefined));

const createSchema = z.object({
  action: z.literal("create"),
  username: usernameSchema,
  password: passwordSchema,
  full_name: z.string().trim().min(1, "Vui lòng nhập họ tên").max(100),
  phone: phoneSchema,
  role: z.enum(["technician", "manager"]),
  shift: z.enum(["morning", "afternoon", "full", "off"]).default("morning"),
  skill_ids: z.array(z.uuid()).default([]),
});
const bootstrapSchema = createSchema.extend({ action: z.literal("bootstrap_owner"), role: z.literal("owner") });
const resetSchema = z.object({ action: z.literal("reset_password"), id: z.uuid(), password: passwordSchema });
const activeSchema = z.object({ action: z.literal("set_active"), id: z.uuid(), active: z.boolean() });
const deleteSchema = z.object({ action: z.literal("delete"), id: z.uuid() });

const bodySchema = z.discriminatedUnion("action", [
  createSchema,
  bootstrapSchema,
  resetSchema,
  activeSchema,
  deleteSchema,
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const sb = serviceClient();
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" }, 400);
  }
  const body = parsed.data;

  // ---- Khởi tạo tài khoản owner đầu tiên (chỉ khi chưa có owner nào) ----
  if (body.action === "bootstrap_owner") {
    const config = await loadConfig(sb);
    if (!verifyInternalSecret(req, config.internal_secret)) return json({ error: "Unauthorized" }, 401);
    const { count } = await sb.from("profiles").select("id", { count: "exact", head: true }).eq("role", "owner");
    if ((count ?? 0) > 0) return json({ error: "Đã có tài khoản chủ spa" }, 409);
    return await createAccount(sb, { ...body, role: "owner" });
  }

  // ---- Xác thực người gọi: phải là owner đang hoạt động ----
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await sb.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Phiên đăng nhập đã hết hạn" }, 401);
  const callerId = userData.user.id;
  const { data: caller } = await sb.from("profiles").select("role, is_active").eq("id", callerId).single();
  if (!caller || caller.role !== "owner" || !caller.is_active) {
    return json({ error: "Chỉ chủ spa mới được quản lý tài khoản" }, 403);
  }

  switch (body.action) {
    case "create":
      return await createAccount(sb, body);

    case "reset_password": {
      const { error } = await sb.auth.admin.updateUserById(body.id, { password: body.password });
      if (error) return json({ error: `Không đặt lại được mật khẩu: ${error.message}` }, 400);
      return json({ ok: true });
    }

    case "set_active": {
      if (body.id === callerId) return json({ error: "Không thể tự khoá tài khoản của mình" }, 400);
      const { data: target } = await sb.from("profiles").select("role").eq("id", body.id).single();
      if (!target) return json({ error: "Không tìm thấy tài khoản" }, 404);
      if (target.role === "owner") return json({ error: "Không thể khoá tài khoản chủ spa" }, 400);
      if (!body.active) {
        // Không khoá KTV khi đang dở tour / có offer chờ
        const { count } = await sb
          .from("tour_assignments")
          .select("id", { count: "exact", head: true })
          .eq("technician_id", body.id)
          .in("status", ["accepted", "working"]);
        if ((count ?? 0) > 0) return json({ error: "KTV đang làm tour – hãy hoàn thành hoặc đổi người trước" }, 400);
        const { count: pending } = await sb
          .from("tour_offers")
          .select("id", { count: "exact", head: true })
          .eq("technician_id", body.id)
          .eq("status", "pending");
        if ((pending ?? 0) > 0) return json({ error: "KTV đang có lời mời tour chờ – hãy thu hồi lời mời trước" }, 400);
      }
      // Khoá = cấm đăng nhập (ban) + is_active=false (không được gợi ý tour); lịch sử tiền giữ nguyên
      const { error: banError } = await sb.auth.admin.updateUserById(body.id, {
        ban_duration: body.active ? "none" : "876000h",
      });
      if (banError) return json({ error: `Không cập nhật được: ${banError.message}` }, 400);
      const { error } = await sb.from("profiles").update({ is_active: body.active }).eq("id", body.id);
      if (error) return json({ error: error.message }, 400);
      if (!body.active) await sb.from("shift_checkins").update({ check_out_at: new Date().toISOString() })
        .eq("technician_id", body.id).is("check_out_at", null);
      return json({ ok: true });
    }

    case "delete": {
      if (body.id === callerId) return json({ error: "Không thể tự xoá tài khoản của mình" }, 400);
      // Chỉ cho xoá hẳn tài khoản tạo nhầm: chưa từng có tour / offer nào
      const checks = await Promise.all([
        sb.from("tour_assignments").select("id", { count: "exact", head: true }).eq("technician_id", body.id),
        sb.from("tour_offers").select("id", { count: "exact", head: true }).eq("technician_id", body.id),
        sb.from("tours").select("id", { count: "exact", head: true }).eq("created_by", body.id),
      ]);
      if (checks.some((c) => (c.count ?? 0) > 0)) {
        return json({ error: "Tài khoản đã có tour – chỉ có thể khoá, không xoá được" }, 400);
      }
      const { error } = await sb.auth.admin.deleteUser(body.id);
      if (error) return json({ error: `Không xoá được: ${error.message}` }, 400);
      return json({ ok: true });
    }
  }
});

type CreateInput = z.infer<typeof createSchema> | z.infer<typeof bootstrapSchema>;

async function createAccount(sb: ReturnType<typeof serviceClient>, input: CreateInput): Promise<Response> {
  const { data: existing } = await sb.from("profiles").select("id").eq("username", input.username).maybeSingle();
  if (existing) return json({ error: "Tên đăng nhập đã tồn tại" }, 409);

  const { data: created, error } = await sb.auth.admin.createUser({
    email: `${input.username}@${EMAIL_DOMAIN}`,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name, username: input.username },
  });
  if (error || !created.user) return json({ error: `Không tạo được tài khoản: ${error?.message}` }, 400);

  const { error: profileError } = await sb.from("profiles").insert({
    id: created.user.id,
    full_name: input.full_name,
    username: input.username,
    phone: input.phone ?? null,
    role: input.role,
    shift: input.shift,
  });
  if (profileError) {
    await sb.auth.admin.deleteUser(created.user.id); // hoàn tác
    return json({ error: `Không tạo được hồ sơ: ${profileError.message}` }, 400);
  }

  if (input.role === "technician" && input.skill_ids.length > 0) {
    await sb.from("technician_skills").insert(
      input.skill_ids.map((service_id) => ({ technician_id: created.user!.id, service_id })),
    );
  }
  return json({ ok: true, id: created.user.id });
}
