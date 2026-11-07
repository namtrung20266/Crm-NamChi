"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { useLookups } from "@/lib/meta";
import { uploadFile, useAttachments } from "@/lib/files";
import { Thumb } from "./files";
import { fmtDateTime } from "@/lib/format";
import { viError } from "@/lib/errors";

type Msg = { id: number; body: string; internal: boolean; author_side: string; author_name: string | null; created_by: string; created_at: string };

// Trao đổi trên đơn: khách ↔ Nam Trung, ghi chú nội bộ, gửi ảnh/file (lưu Drive, gắn vào đơn)
export function OrderChat({ orderId, height = "60vh" }: { orderId: string; height?: string }) {
  const s = useSession();
  const qc = useQueryClient();
  const key = ["order-messages", orderId];
  const msgs = useQuery({ queryKey: key, refetchInterval: 20_000, queryFn: () => q<Msg[]>(supabase.from("order_messages").select("*").eq("order_id", orderId).order("created_at")) });
  const files = useAttachments("order", [orderId]);
  const replies = useLookups("quick_reply");
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [pending, setPending] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const ch = supabase.channel(`msg-${orderId}-${Math.random().toString(36).slice(2)}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "order_messages", filter: `order_id=eq.${orderId}` },
      () => qc.invalidateQueries({ queryKey: key })).subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs.data?.length]);

  const send = async () => {
    if ((!body.trim() && !pending.length) || busy) return;
    setBusy(true); setErr(null);
    try {
      const names: string[] = [];
      for (const f of pending) { const a = await uploadFile(f, "order", orderId, { visibility: internal ? "internal" : "customer", category: f.type.startsWith("image/") ? "anh_san_pham" : "khac", note: "Gửi trong trao đổi" }); names.push(a.file_name); }
      const text = [body.trim(), names.length ? `📎 ${names.join(", ")}` : ""].filter(Boolean).join("\n");
      const { error } = await supabase.from("order_messages").insert({ order_id: orderId, body: text, internal: s.isStaff && internal });
      if (error) throw error;
      setBody(""); setPending([]);
      qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["attachments", "order"] });
    } catch (e) { setErr(e instanceof Error && !("code" in e) ? e.message : viError(e)); } finally { setBusy(false); }
  };

  // ảnh đính kèm theo thời điểm gửi để hiển thị cạnh tin nhắn
  const fileNear = (m: Msg) => (files.data ?? []).filter((a) => a.note === "Gửi trong trao đổi" && a.created_by === m.created_by && Math.abs(new Date(a.created_at).getTime() - new Date(m.created_at).getTime()) < 120_000);

  return (
    <div className="flex flex-col" style={{ height }}>
      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {(msgs.data ?? []).length === 0 ? <p className="py-8 text-center text-sm text-muted">Chưa có trao đổi. Mọi trao đổi về đơn nên ghi ở đây để cả 2 bên cùng theo dõi.</p> : null}
        {(msgs.data ?? []).map((m) => {
          const mine = m.created_by === s.user_id;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[14px] ${m.internal ? "border border-dashed border-amber-300 bg-amber-50" : mine ? "bg-brand text-white" : m.author_side === "customer" ? "bg-blue-50" : "bg-surface"}`}>
                <div className={`mb-0.5 text-[12px] font-semibold ${mine && !m.internal ? "text-white/80" : "text-muted"}`}>
                  {m.author_name ?? "?"}{m.author_side === "customer" ? " · khách" : ""}{m.internal ? " · nội bộ 🔒" : ""} · {fmtDateTime(m.created_at)}
                </div>
                <div className="whitespace-pre-wrap break-words">{m.body}</div>
                {fileNear(m).length ? <div className="mt-1.5 flex flex-wrap gap-1.5">{fileNear(m).map((a) => <Thumb key={a.id} a={a} size={56} />)}</div> : null}
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <div className="mt-3 border-t border-line pt-3"
        onPaste={(e) => { const f = Array.from(e.clipboardData.files); if (f.length) { e.preventDefault(); setPending((p) => [...p, ...f]); } }}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setPending((p) => [...p, ...Array.from(e.dataTransfer.files)]); }}>
        {s.isStaff && (replies.data ?? []).length ? (
          <select value="" onChange={(e) => { if (e.target.value) setBody(e.target.value); }} className="mb-2 h-9 w-full rounded-lg border border-line bg-white px-2 text-[13.5px] text-muted">
            <option value="">⚡ Câu trả lời nhanh…</option>
            {(replies.data ?? []).filter((r) => r.is_active).map((r) => <option key={r.code} value={r.label}>{r.label}</option>)}
          </select>
        ) : null}
        {pending.length ? <div className="mb-2 flex flex-wrap gap-1.5">{pending.map((f, i) => <span key={i} className="rounded bg-surface px-2 py-0.5 text-[12.5px]">📎 {f.name} <button onClick={() => setPending(pending.filter((_, j) => j !== i))} className="text-danger">✕</button></span>)}</div> : null}
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder={internal ? "Ghi chú nội bộ (khách không thấy)…" : "Nhắn trên đơn… (Ctrl+Enter để gửi, dán ảnh trực tiếp)"}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(); }}
          className={`w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 ${internal ? "border-amber-300 bg-amber-50 focus:ring-amber-200" : "border-line focus:border-brand focus:ring-brand/15"}`} />
        <div className="mt-2 flex items-center gap-2">
          <label className="cursor-pointer rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted hover:text-ink">📎 File<input type="file" multiple hidden onChange={(e) => { setPending((p) => [...p, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} /></label>
          {s.isStaff ? <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Nội bộ</label> : null}
          {err ? <span className="text-xs text-danger">{err}</span> : null}
          <button onClick={send} disabled={busy} className="ml-auto rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50">{busy ? "Đang gửi…" : "Gửi"}</button>
        </div>
      </div>
    </div>
  );
}
