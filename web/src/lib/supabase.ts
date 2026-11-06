"use client";

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

// Một client duy nhất cho cả ứng dụng. Mọi truy vấn chạy bằng phiên người dùng → RLS áp dụng.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "namchi-auth" },
});

// Ném lỗi để react-query bắt; trả data đã có kiểu
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function q<T = unknown>(p: PromiseLike<{ data: any; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}
