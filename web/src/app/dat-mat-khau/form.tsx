"use client";

import { useActionState } from "react";
import { setInitialPassword } from "./actions";

export function SetPasswordForm() {
  const [state, action, pending] = useActionState(setInitialPassword, {} as { error?: string });
  return (
    <form action={action} className="space-y-4">
      <input name="password" type="password" autoComplete="new-password" required minLength={10} placeholder="Mật khẩu mới" className="auth-input" />
      <input name="confirm" type="password" autoComplete="new-password" required placeholder="Nhập lại mật khẩu" className="auth-input" />
      {state.error ? <p role="alert" className="auth-error">{state.error}</p> : null}
      <button disabled={pending} className="auth-btn">{pending ? "Đang lưu…" : "Lưu mật khẩu & vào hệ thống"}</button>
    </form>
  );
}
