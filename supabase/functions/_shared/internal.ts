// Tiện ích dùng chung cho các Edge Function (Deno).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

/** Client quyền service role – CHỈ dùng trong Edge Function, không bao giờ xuống trình duyệt */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type InternalConfig = Record<string, string | undefined>;

export async function loadConfig(sb: SupabaseClient): Promise<InternalConfig> {
  const { data, error } = await sb.rpc("internal_config");
  if (error) throw new Error(`Không đọc được cấu hình nội bộ: ${error.message}`);
  return (data ?? {}) as InternalConfig;
}

/** So sánh hằng thời gian để kiểm tra header x-internal-secret (request từ chính Postgres qua pg_net) */
export function verifyInternalSecret(req: Request, expected: string | undefined): boolean {
  const got = req.headers.get("x-internal-secret") ?? "";
  if (!expected || got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
