"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { AuthFrame } from "@/components/auth-frame";

export default function SetPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/login/?error=link"); else setEmail(data.session.user.email ?? "");
    });
  }, [router]);
  return (
    <AuthFrame title="Đặt mật khẩu" subtitle={email ? `Tài khoản ${email}. Mật khẩu tối thiểu 10 ký tự, nên gồm chữ và số.` : "Đang kiểm tra…"}>
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const p = String(f.get("password") ?? ""), c = String(f.get("confirm") ?? "");
        if (p.length < 10) return setErr("Mật khẩu tối thiểu 10 ký tự.");
        if (p !== c) return setErr("Hai lần nhập không khớp.");
        setPending(true); setErr(null);
        const { error } = await supabase.auth.updateUser({ password: p });
        if (error) { setPending(false); return setErr(/different/i.test(error.message) ? "Mật khẩu mới phải khác mật khẩu cũ." : "Không lưu được mật khẩu. Link có thể đã hết hạn."); }
        await supabase.rpc("touch_last_login");
        router.replace("/");
      }}>
        <input name="password" type="password" autoComplete="new-password" required minLength={10} placeholder="Mật khẩu mới" className="auth-input" />
        <input name="confirm" type="password" autoComplete="new-password" required placeholder="Nhập lại mật khẩu" className="auth-input" />
        {err ? <p role="alert" className="auth-error">{err}</p> : null}
        <button disabled={pending || !email} className="auth-btn">{pending ? "Đang lưu…" : "Lưu mật khẩu & vào hệ thống"}</button>
      </form>
    </AuthFrame>
  );
}
