"use client";

import { supabase } from "./supabase";
import { SUPABASE_ANON_KEY, SUPABASE_URL, BASE_PATH } from "./env";

type Result = { ok: true; link: string; email: string } | { ok: false; error: string };

async function call(body: Record<string, unknown>): Promise<Result> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: "Phiên đăng nhập đã hết, đăng nhập lại." };
  const res = await fetch(`${SUPABASE_URL}/functions/v1/user-admin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; token_hash?: string; type?: string; email?: string };
  if (!res.ok || !data.token_hash) return { ok: false, error: data.error ?? "Không tạo được tài khoản." };
  const link = `${window.location.origin}${BASE_PATH}/auth/confirm/?token_hash=${encodeURIComponent(data.token_hash)}&type=${data.type}`;
  return { ok: true, link, email: data.email ?? "" };
}

export const inviteUser = (p: { email: string; full_name: string; user_type: "staff" | "customer"; role_code: string; customer_id?: string | null; entity_id?: string | null }) =>
  call({ action: "invite", ...p });
export const resetLink = (userId: string) => call({ action: "reset_link", user_id: userId });
