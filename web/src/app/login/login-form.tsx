"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  const message = state.error ?? notice;

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next ?? ""} />
      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-sm font-medium text-ink">Email</label>
        <input
          id="email" name="email" type="email" autoComplete="username" required
          className="h-11 w-full rounded-md border border-line bg-white px-3 text-[15px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-sm font-medium text-ink">Mật khẩu</label>
        <input
          id="password" name="password" type="password" autoComplete="current-password" required minLength={8}
          className="h-11 w-full rounded-md border border-line bg-white px-3 text-[15px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>
      {message ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {message}
        </p>
      ) : null}
      <button
        type="submit" disabled={pending}
        className="h-11 w-full rounded-md bg-brand text-[15px] font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
      >
        {pending ? "Đang đăng nhập…" : "Đăng nhập"}
      </button>
    </form>
  );
}
