/**
 * Tạo tài khoản chủ spa (owner) đầu tiên – hoặc thêm owner khác.
 *
 * Cách chạy (ở máy của bạn):
 *   1. Tạo file .env.local có NEXT_PUBLIC_SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY
 *      (Supabase Dashboard → Project Settings → API).
 *   2. npm run create-owner -- <ten_dang_nhap> "<Họ tên>"
 *      Script sẽ hỏi mật khẩu (không lưu vào lịch sử lệnh).
 *
 * Service role key CHỈ dùng ở đây (máy của bạn), không đưa lên Vercel / trình duyệt.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

config({ path: ".env.local" });

const EMAIL_DOMAIN = "ntspa.local";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local");
  }

  const [usernameArg, ...nameParts] = process.argv.slice(2);
  const rl = createInterface({ input: stdin, output: stdout });
  const username = (usernameArg ?? (await rl.question("Tên đăng nhập: "))).trim().toLowerCase();
  const fullName = (nameParts.join(" ") || (await rl.question("Họ tên: "))).trim();
  const password = (await rl.question("Mật khẩu (tối thiểu 6 ký tự): ")).trim();
  rl.close();

  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error("Tên đăng nhập 3–32 ký tự: chữ thường, số, . _ -");
  if (password.length < 6) throw new Error("Mật khẩu tối thiểu 6 ký tự");
  if (!fullName) throw new Error("Vui lòng nhập họ tên");

  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: existing } = await sb.from("profiles").select("id").eq("username", username).maybeSingle();
  if (existing) throw new Error(`Tên đăng nhập "${username}" đã tồn tại`);

  const { data, error } = await sb.auth.admin.createUser({
    email: `${username}@${EMAIL_DOMAIN}`,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, username },
  });
  if (error || !data.user) throw new Error(`Không tạo được user: ${error?.message}`);

  const { error: profileError } = await sb.from("profiles").insert({
    id: data.user.id,
    full_name: fullName,
    username,
    role: "owner",
  });
  if (profileError) {
    await sb.auth.admin.deleteUser(data.user.id);
    throw new Error(`Không tạo được hồ sơ: ${profileError.message}`);
  }
  console.log(`✔ Đã tạo tài khoản chủ spa: ${username}`);
}

main().catch((e) => {
  console.error(`✘ ${(e as Error).message}`);
  process.exit(1);
});
