"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function setInitialPassword(_: { error?: string }, f: FormData): Promise<{ error?: string }> {
  const p = z.object({ password: z.string().min(10, "Mật khẩu tối thiểu 10 ký tự"), confirm: z.string() })
    .refine((v) => v.password === v.confirm, { message: "Hai lần nhập không khớp" })
    .safeParse({ password: f.get("password"), confirm: f.get("confirm") });
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: p.data.password });
  if (error) return { error: /should be different/i.test(error.message) ? "Mật khẩu mới phải khác mật khẩu cũ." : "Không lưu được mật khẩu. Link có thể đã hết hạn." };
  await supabase.rpc("touch_last_login");
  redirect("/");
}
