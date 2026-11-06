"use client";

import { useActionState, useState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  const [show, setShow] = useState(false);
  const message = state.error ?? notice;

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next ?? ""} />
      <label className="block">
        <span className="auth-label">Email</span>
        <input name="email" type="email" autoComplete="username" required placeholder="ten@congty.vn" className="auth-input" />
      </label>
      <label className="block">
        <span className="auth-label">Mật khẩu</span>
        <span className="relative block">
          <input name="password" type={show ? "text" : "password"} autoComplete="current-password" required minLength={8} placeholder="••••••••••" className="auth-input pr-16" />
          <button type="button" onClick={() => setShow((v) => !v)} className="absolute inset-y-0 right-0 px-4 text-xs font-semibold text-muted hover:text-ink">
            {show ? "Ẩn" : "Hiện"}
          </button>
        </span>
      </label>
      {message ? <p role="alert" className="auth-error">{message}</p> : null}
      <button type="submit" disabled={pending} className="auth-btn">
        <span>{pending ? "Đang xác thực…" : "Đăng nhập"}</span>
        <span aria-hidden className="auth-btn-arrow">→</span>
      </button>
      <p className="pt-1 text-center text-xs text-muted">Quên mật khẩu? Liên hệ quản trị viên Nam Trung để nhận link đặt lại.</p>
    </form>
  );
}
