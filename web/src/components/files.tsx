"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { uploadFile, useAttachments, useFileUrl, fileBlobUrl, fmtSize, type Attachment } from "@/lib/files";
import { useLookups, lookupLabel, rpc } from "@/lib/meta";
import { useSession } from "@/lib/session";
import { Badge } from "./ui";
import { fmtDateTime } from "@/lib/format";
import { viError } from "@/lib/errors";

const ACCEPT = "image/*,.pdf,.xlsx,.xls,.docx,.doc,.csv,.zip,.mp4";

// Vùng thả file: kéo-thả, dán ảnh chụp màn hình (Ctrl+V), hoặc bấm chọn
export function FileDrop({ entityType, refId, compact = false, category, onDone, allowInternal = true }: {
  entityType: string; refId: string; compact?: boolean; category?: string; onDone?: (a: Attachment[]) => void; allowInternal?: boolean;
}) {
  const s = useSession();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const cats = useLookups("attachment_category");
  const [cat, setCat] = useState(category ?? "");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const send = async (files: File[]) => {
    if (!files.length) return;
    setErr(null);
    const done: Attachment[] = [];
    for (const [i, f] of files.entries()) {
      setBusy(`Đang tải ${i + 1}/${files.length}: ${f.name}`);
      try { done.push(await uploadFile(f, entityType, refId, { category: cat || undefined, visibility: internal ? "internal" : "customer" })); }
      catch (e) { setErr(`${f.name}: ${e instanceof Error ? e.message : viError(e)}`); }
    }
    setBusy(null);
    await qc.invalidateQueries({ queryKey: ["attachments", entityType] });
    onDone?.(done);
  };

  return (
    <div
      tabIndex={0}
      onPaste={(e) => { const fs = Array.from(e.clipboardData.files); if (fs.length) { e.preventDefault(); send(fs); } }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); send(Array.from(e.dataTransfer.files)); }}
      className={`rounded-xl border-2 border-dashed outline-none transition focus:border-brand/60 ${over ? "border-brand bg-brand-soft" : "border-line bg-white/60"} ${compact ? "px-3 py-2" : "px-4 py-4"}`}>
      <div className={`flex flex-wrap items-center gap-2 ${compact ? "text-xs" : "text-sm"}`}>
        <button type="button" onClick={() => input.current?.click()} disabled={!!busy}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-strong disabled:opacity-50">+ Chọn file</button>
        <span className="text-muted">hoặc kéo thả / dán ảnh (Ctrl+V) vào đây</span>
        {!compact ? (
          <select value={cat} onChange={(e) => setCat(e.target.value)} className="ml-auto h-8 rounded-md border border-line bg-white px-2 text-xs">
            <option value="">Loại file…</option>{(cats.data ?? []).filter((c) => c.is_active).map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        ) : null}
        {s.isStaff && allowInternal && !compact ? (
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Chỉ nội bộ</label>
        ) : null}
      </div>
      <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { send(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      {busy ? <p className="mt-2 text-xs text-brand-strong">{busy}</p> : null}
      {err ? <p className="mt-2 text-xs text-danger">{err}</p> : null}
    </div>
  );
}

export function Thumb({ a, size = 72 }: { a: Attachment; size?: number }) {
  const img = a.mime_type.startsWith("image/");
  const url = useFileUrl(a.id, true, img);
  const open = async () => { const u = await fileBlobUrl(a.id); window.open(u, "_blank", "noopener"); };
  return (
    <button type="button" onClick={open} title={`${a.file_name} · ${fmtSize(a.size_bytes)}`}
      className="group relative shrink-0 overflow-hidden rounded-lg border border-line bg-surface hover:ring-2 hover:ring-brand/40" style={{ width: size, height: size }}>
      {img ? (url.data ? <img src={url.data} alt={a.file_name} className="h-full w-full object-cover" /> : <span className="skeleton block h-full w-full" />)
        : <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 p-1 text-center"><span className="font-mono text-[10px] font-bold uppercase text-brand-strong">{a.file_name.split(".").pop()}</span><span className="line-clamp-2 text-[9px] leading-tight text-muted">{a.file_name}</span></span>}
      {a.visibility === "internal" ? <span className="absolute left-0.5 top-0.5 rounded bg-ink/80 px-1 text-[9px] text-white">NB</span> : null}
    </button>
  );
}

// Thư viện file của 1 đối tượng: nhóm theo loại, gỡ được (người tải trong 24h / nhân viên)
export function AttachmentGallery({ entityType, refId, empty = "Chưa có file." }: { entityType: string; refId: string; empty?: string }) {
  const s = useSession();
  const qc = useQueryClient();
  const list = useAttachments(entityType, [refId]);
  const cats = useLookups("attachment_category");
  const rows = list.data ?? [];
  if (list.isLoading) return <div className="skeleton h-20" />;
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  const groups = [...new Set(rows.map((r) => r.category ?? ""))];
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g}>
          <div className="mb-1.5 text-xs font-semibold text-muted">{g ? lookupLabel(cats.data, g) : "Chưa phân loại"} ({rows.filter((r) => (r.category ?? "") === g).length})</div>
          <div className="flex flex-wrap gap-2">
            {rows.filter((r) => (r.category ?? "") === g).map((a) => (
              <div key={a.id} className="relative">
                <Thumb a={a} />
                {(s.isStaff || a.created_by === s.user_id) ? (
                  <button type="button" title="Gỡ file" onClick={async () => {
                    if (!confirm(`Gỡ file ${a.file_name}? (file vẫn lưu trên Drive để đối chiếu)`)) return;
                    try { await rpc("remove_attachment", { p_id: a.id }); qc.invalidateQueries({ queryKey: ["attachments", entityType] }); } catch (e) { alert(viError(e)); }
                  }} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-danger text-[11px] text-white opacity-70 shadow hover:opacity-100">×</button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="text-[11px] text-muted">{rows.length} file · cập nhật {fmtDateTime(rows[rows.length - 1].created_at)} {rows.some((r) => r.visibility === "internal") ? <Badge>NB = chỉ nội bộ</Badge> : null}</p>
    </div>
  );
}
