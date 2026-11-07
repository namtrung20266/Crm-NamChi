"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { viError, type ActionState } from "@/lib/errors";
import { btn, Notice } from "./index";

// Form phía trình duyệt: chặn bấm 2 lần, báo lỗi tiếng Việt, làm mới dữ liệu liên quan
export function Form({ onSubmit, children, className = "space-y-4", invalidate = [], resetOnOk = false }: {
  onSubmit: (f: FormData) => Promise<ActionState | void>;
  children: React.ReactNode;
  className?: string;
  invalidate?: string[][];
  resetOnOk?: boolean;
}) {
  const qc = useQueryClient();
  const [state, setState] = useState<ActionState>({});
  const [pending, setPending] = useState(false);
  return (
    <form
      className={className}
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending) return;
        const form = e.currentTarget;
        setPending(true);
        setState({});
        try {
          const r = (await onSubmit(new FormData(form))) ?? { ok: true };
          setState(r);
          if (!r.error) {
            await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k })));
            if (resetOnOk) form.reset();
          }
        } catch (err) {
          setState({ error: viError(err) });
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset disabled={pending} className="contents">{children}</fieldset>
      {state.error ? <Notice>{state.error}</Notice> : null}
      {state.ok && state.message ? <Notice tone="ok">{state.message}</Notice> : null}
      {state.link ? <CopyLink link={state.link} /> : null}
    </form>
  );
}

export function Submit({ children, variant = "primary", className = "" }: { children: React.ReactNode; variant?: keyof typeof btn; className?: string }) {
  return <button type="submit" className={`${btn[variant]} ${className}`}>{children}</button>;
}

export function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-brand/30 bg-brand-soft p-3">
      <p className="text-xs font-medium text-brand-strong">Link kích hoạt (dùng 1 lần) – gửi qua Zalo hoặc email:</p>
      <div className="mt-2 flex gap-2">
        <input readOnly value={link} className="h-9 min-w-0 flex-1 rounded-md border border-line bg-white px-2 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className={btn.primary + " h-9"} onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); }}>
          {copied ? "Đã chép" : "Chép"}
        </button>
      </div>
    </div>
  );
}

// Nút thao tác nhanh có xác nhận
export function ActionButton({ onClick, children, confirmText, variant = "secondary", invalidate = [] }: {
  onClick: () => Promise<unknown>; children: React.ReactNode; confirmText?: string; variant?: keyof typeof btn; invalidate?: string[][];
}) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" disabled={pending} className={btn[variant] + " h-8 px-3 text-xs"}
        onClick={async () => {
          if (confirmText && !confirm(confirmText)) return;
          setPending(true); setErr(null);
          try { await onClick(); await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k }))); }
          catch (e) { setErr(viError(e)); }
          finally { setPending(false); }
        }}>{pending ? "…" : children}</button>
      {err ? <span className="text-[12.5px] text-danger">{err}</span> : null}
    </span>
  );
}
