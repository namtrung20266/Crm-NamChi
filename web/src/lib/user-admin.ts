import "server-only";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

type Result = { ok: true; link: string; email: string } | { ok: false; error: string };

// Gọi Edge Function user-admin bằng phiên của người đang đăng nhập
async function call(body: Record<string, unknown>): Promise<Result> {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: "Phiên đăng nhập đã hết, đăng nhập lại." };

  const res = await fetch(`${SUPABASE_URL}/functions/v1/user-admin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; token_hash?: string; type?: string; email?: string };
  if (!res.ok || !data.token_hash) return { ok: false, error: data.error ?? "Không tạo được tài khoản." };

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const link = `${proto}://${host}/auth/confirm?token_hash=${encodeURIComponent(data.token_hash)}&type=${data.type}`;
  return { ok: true, link, email: data.email ?? "" };
}

export const inviteUser = (p: {
  email: string; full_name: string; user_type: "staff" | "customer"; role_code: string;
  customer_id?: string | null; entity_id?: string | null;
}) => call({ action: "invite", ...p });

export const resetLink = (userId: string) => call({ action: "reset_link", user_id: userId });
