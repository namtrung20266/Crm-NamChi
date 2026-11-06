"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthFrame } from "@/components/auth-frame";
import { supabase } from "@/lib/supabase";

const NOTICES: Record<string, string> = {
  inactive: "Tài khoản chưa được kích hoạt hoặc đã bị khóa. Liên hệ Nam Trung.",
  link: "Link đã hết hạn hoặc đã được dùng. Xin quản trị viên gửi link mới.",
};

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [err, setErr] = useState<string | null>(NOTICES[sp.get("error") ?? ""] ?? null);
  const [pending, setPending] = useState(false);
  const [show, setShow] = useState(false);

  return (
    <form className="space-y-4" noValidate onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const email = String(f.get("email") ?? "").trim().toLowerCase();
      const password = String(f.get("password") ?? "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) { setErr("Nhập đúng email và mật khẩu (tối thiểu 8 ký tự)."); return; }
      setPending(true); setErr(null);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { setPending(false); setErr("Email hoặc mật khẩu không đúng."); return; }
      supabase.rpc("touch_last_login").then(() => undefined);
      const next = sp.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/");
    }}>
      <label className="block"><span className="auth-label">Email</span>
        <input name="email" type="email" autoComplete="username" required placeholder="ten@congty.vn" className="auth-input" /></label>
      <label className="block"><span className="auth-label">Mật khẩu</span>
        <span className="relative block">
          <input name="password" type={show ? "text" : "password"} autoComplete="current-password" required placeholder="••••••••••" className="auth-input pr-16" />
          <button type="button" onClick={() => setShow((v) => !v)} className="absolute inset-y-0 right-0 px-4 text-xs font-semibold text-muted hover:text-ink">{show ? "Ẩn" : "Hiện"}</button>
        </span></label>
      {err ? <p role="alert" className="auth-error">{err}</p> : null}
      <button type="submit" disabled={pending} className="auth-btn"><span>{pending ? "Đang xác thực…" : "Đăng nhập"}</span><span aria-hidden className="auth-btn-arrow">→</span></button>
      <p className="pt-1 text-center text-xs text-muted">Quên mật khẩu? Liên hệ quản trị viên Nam Trung để nhận link đặt lại.</p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthFrame title="Đăng nhập" subtitle="Theo dõi đơn hàng, kiện, chứng từ và công nợ – dành cho nhân viên Nam Trung và khách hàng được cấp tài khoản.">
      <Suspense><LoginForm /></Suspense>
    </AuthFrame>
  );
}
