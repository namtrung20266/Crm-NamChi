"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { rpc } from "@/lib/meta";
import { viError } from "@/lib/errors";

// Ghi chú sửa tại chỗ: kind=internal (nhân viên) hoặc customer (khách ghi chú, nhân viên cũng xem/sửa được)
export function InlineNote({ orderId, kind, value, canEdit, placeholder, compact = false }: {
  orderId: string; kind: "internal" | "customer"; value: string | null; canEdit: boolean; placeholder?: string; compact?: boolean;
}) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await rpc("set_order_note", { p_order_id: orderId, p_kind: kind, p_text: v }); setEdit(false); ["admin-orders", "order", "my-orders"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); }
    catch (e) { alert(viError(e)); } finally { setBusy(false); }
  };
  const tone = kind === "internal" ? "bg-amber-50 border-amber-200" : "bg-blue-50 border-blue-200";
  if (edit) return (
    <div className="space-y-1">
      <textarea autoFocus value={v} onChange={(e) => setV(e.target.value)} rows={compact ? 2 : 3}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save(); if (e.key === "Escape") setEdit(false); }}
        className={`w-full rounded-lg border px-2.5 py-1.5 text-[13.5px] outline-none focus:ring-2 focus:ring-brand/20 ${tone}`} />
      <div className="flex gap-1.5"><button onClick={save} disabled={busy} className="rounded-md bg-brand px-2.5 py-1 text-[12.5px] font-semibold text-white">{busy ? "…" : "Lưu"}</button>
        <button onClick={() => { setEdit(false); setV(value ?? ""); }} className="rounded-md px-2 py-1 text-[12.5px] text-muted">Hủy</button></div>
    </div>
  );
  return (
    <button type="button" disabled={!canEdit} onClick={() => { setV(value ?? ""); setEdit(true); }}
      className={`w-full rounded-lg border px-2.5 py-1.5 text-left text-[13.5px] leading-snug ${value ? tone : "border-dashed border-line text-muted"} ${canEdit ? "hover:ring-2 hover:ring-brand/20" : "cursor-default"}`}>
      <span className={compact ? "line-clamp-3 whitespace-pre-wrap" : "whitespace-pre-wrap"}>{value || (canEdit ? placeholder ?? "+ Ghi chú" : "—")}</span>
    </button>
  );
}
