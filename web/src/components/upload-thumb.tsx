"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFileUrl, fileBlobUrl, uploadFile } from "@/lib/files";

// Ảnh đại diện có nút tải ảnh: bấm ô trống hoặc dấu + để chọn ảnh, lưu Google Drive gắn vào đơn / dòng hàng
export function UploadThumb({ id, n, entityType, refId, size = 56, canUpload = true }: { id: string | null; n: number; entityType: "order" | "order_item"; refId: string; size?: number; canUpload?: boolean }) {
  const qc = useQueryClient();
  const url = useFileUrl(id ?? "", true, !!id);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try { for (const f of files) await uploadFile(f, entityType, refId, { category: "anh_san_pham" }); ["admin-orders", "desk", "my-orders", "attachments"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); }
    catch (e) { alert(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const st = { width: size, height: size };
  return (
    <div className="relative shrink-0" style={st}>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { pick(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      {id ? (
        <button type="button" onClick={async () => window.open(await fileBlobUrl(id), "_blank", "noopener")} className="h-full w-full overflow-hidden rounded-lg border border-line bg-surface">
          {url.data ? <img src={url.data} alt="" className="h-full w-full object-cover" /> : <span className="skeleton block h-full w-full" />}
          {n > 1 ? <span className="absolute bottom-0 left-0 rounded-tr bg-ink/70 px-1 text-[11px] text-white">{n}</span> : null}
        </button>
      ) : (
        <button type="button" disabled={!canUpload || busy} onClick={() => input.current?.click()} title="Bấm để tải ảnh"
          className="flex h-full w-full flex-col items-center justify-center rounded-lg border border-dashed border-brand/50 text-[11px] leading-tight text-brand-strong hover:bg-brand-soft disabled:opacity-60">
          {busy ? "Đang tải…" : canUpload ? <><span className="text-lg leading-none">+</span>Ảnh</> : "Chưa ảnh"}
        </button>
      )}
      {id && canUpload ? <button type="button" title="Thêm ảnh" onClick={() => input.current?.click()} disabled={busy}
        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[13px] leading-none text-white shadow">{busy ? "…" : "+"}</button> : null}
    </div>
  );
}
