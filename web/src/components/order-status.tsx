"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/session";
import { useStatusDefs, rpc, PHASES } from "@/lib/meta";
import { Modal } from "./modal";
import { btn, Field, inputCls, Notice } from "./ui";
import { viError } from "@/lib/errors";

// Thanh tiến trình trạng thái + nút chuyển bước có kiểm soát (lùi/tạm giữ/hủy bắt buộc lý do)
export function OrderStatusBar({ orderId, status, onChanged }: { orderId: string; status: string; onChanged: () => void }) {
  const s = useSession();
  const qc = useQueryClient();
  const defs = useStatusDefs();
  const [target, setTarget] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const D = (defs.data ?? []).filter((d) => d.is_active);
  const flow = D.filter((d) => d.phase !== "ngoai_le");
  const cur = D.find((d) => d.code === status);
  const write = s.isStaff && s.can("order.write");
  const next = flow.find((d) => cur && d.rank > cur.rank && cur.phase !== "ngoai_le");
  const needNote = (code: string) => { const t = D.find((d) => d.code === code); return !!t && !!cur && (t.rank < cur.rank || ["huy", "tam_giu"].includes(code) || ["huy", "tam_giu", "hoan_tat"].includes(cur.code)); };

  const apply = async () => {
    if (!target) return;
    setBusy(true); setErr(null);
    try { await rpc("set_order_status", { p_order_id: orderId, p_status: target, p_note: note || null }); setTarget(null); setNote(""); onChanged(); qc.invalidateQueries({ queryKey: ["admin-orders"] }); }
    catch (e) { setErr(viError(e)); } finally { setBusy(false); }
  };

  return (
    <div className="card mb-5 p-4">
      <div className="overflow-x-auto">
        <div className="flex min-w-max items-start gap-0">
          {flow.map((d, i) => {
            const done = cur && cur.phase !== "ngoai_le" && d.rank <= cur.rank;
            const here = d.code === status;
            const firstOfPhase = i === 0 || flow[i - 1].phase !== d.phase;
            return (
              <div key={d.code} className="flex flex-col">
                <div className="h-4 pl-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{firstOfPhase ? PHASES[d.phase] : ""}</div>
                <div className="flex items-center">
                  <button disabled={!write || here} onClick={() => { setTarget(d.code); setErr(null); }} title={d.description ?? ""}
                    className={`whitespace-nowrap rounded-full px-2.5 py-1.5 text-[13px] font-semibold transition ${here ? "bg-brand text-white shadow-[0_6px_16px_-8px_var(--brand)]" : done ? "bg-brand-soft text-brand-strong" : "bg-surface text-muted"} ${write && !here ? "hover:ring-2 hover:ring-brand/30" : ""}`}>
                    {done && !here ? "✓ " : ""}{d.label}
                  </button>
                  {i < flow.length - 1 ? <span className={`h-px w-3 ${done ? "bg-brand/50" : "bg-line"}`} /> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/70 pt-3">
        {cur?.phase === "ngoai_le" ? <span className="rounded-md bg-danger/10 px-2 py-1 text-xs font-semibold text-danger">{cur.label}</span> : null}
        <span className="text-xs text-muted">Hệ thống tự chuyển bước khi có dữ liệu (xác nhận báo giá, cọc, trả NCC, kiện về đủ, giao, HĐ).</span>
        {write ? (
          <div className="ml-auto flex flex-wrap gap-2">
            {next ? <button onClick={() => setTarget(next.code)} className={btn.primary + " h-8 px-3 text-xs"}>Chuyển: {next.label} →</button> : null}
            {status !== "tam_giu" && status !== "huy" ? <button onClick={() => setTarget("tam_giu")} className={btn.secondary + " h-8 px-3 text-xs"}>Tạm giữ</button> : null}
            {status !== "huy" ? <button onClick={() => setTarget("huy")} className={btn.danger + " h-8 px-3 text-xs"}>Hủy đơn</button> : null}
          </div>
        ) : null}
      </div>
      <Modal open={!!target} onClose={() => setTarget(null)} title={`Chuyển sang “${D.find((d) => d.code === target)?.label ?? ""}”`}>
        <div className="space-y-3">
          <p className="text-sm text-muted">{D.find((d) => d.code === target)?.description}</p>
          <Field label={needNote(target ?? "") ? "Lý do (bắt buộc, khách thấy nếu bước này báo khách)" : "Ghi chú (không bắt buộc)"}>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className={inputCls + " h-auto py-2"} autoFocus />
          </Field>
          {err ? <Notice>{err}</Notice> : null}
          <div className="flex justify-end gap-2"><button onClick={() => setTarget(null)} className={btn.ghost}>Hủy</button>
            <button onClick={apply} disabled={busy || (needNote(target ?? "") && note.trim().length < 5)} className={target === "huy" ? btn.danger : btn.primary}>{busy ? "…" : "Xác nhận"}</button></div>
        </div>
      </Modal>
    </div>
  );
}
