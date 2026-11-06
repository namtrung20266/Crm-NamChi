"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/errors";
import { btn, Notice } from "./index";

export function SubmitButton({ children, variant = "primary" }: { children: React.ReactNode; variant?: keyof typeof btn }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className={btn[variant]}>{pending ? "Đang xử lý…" : children}</button>;
}

// Form dùng server action, hiển thị lỗi/thành công và link mời (nếu có)
export function ActionForm({ action, children, className = "space-y-4", resetOnOk = false }: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  resetOnOk?: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className={className} key={resetOnOk && state.ok ? String(Math.random()) : undefined}>
      {children}
      {state.error ? <Notice>{state.error}</Notice> : null}
      {state.ok && state.message ? <Notice tone="ok">{state.message}</Notice> : null}
      {state.link ? <CopyLink link={state.link} /> : null}
    </form>
  );
}

export function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-brand/30 bg-brand-soft p-3">
      <p className="text-xs font-medium text-brand-strong">Link kích hoạt (dùng 1 lần) – gửi cho người dùng qua Zalo hoặc email:</p>
      <div className="mt-2 flex gap-2">
        <input readOnly value={link} className="h-9 min-w-0 flex-1 rounded-md border border-line bg-white px-2 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className={btn.primary + " h-9"} onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); }}>
          {copied ? "Đã chép" : "Chép"}
        </button>
      </div>
    </div>
  );
}

export function ConfirmButton({ children, message, variant = "secondary" }: { children: React.ReactNode; message: string; variant?: keyof typeof btn }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={btn[variant] + " h-8 px-3 text-xs"}
      onClick={(e) => { if (!confirm(message)) e.preventDefault(); }}>
      {pending ? "…" : children}
    </button>
  );
}
