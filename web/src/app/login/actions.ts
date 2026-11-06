"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Email không hợp lệ"),
  password: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự"),
  next: z.string().optional(),
});

export interface LoginState {
  error?: string;
}

// Chỉ cho chuyển hướng nội bộ, chặn open redirect (?next=https://...)
function safeNext(next?: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Thông tin chưa hợp lệ" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    // Không tiết lộ email có tồn tại hay không
    return { error: "Email hoặc mật khẩu không đúng." };
  }
  await supabase.rpc("touch_last_login");
  redirect(safeNext(parsed.data.next));
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
