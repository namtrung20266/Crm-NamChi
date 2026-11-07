"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { PKG_STATUS } from "@/lib/status";
import { Card, Badge, Field, inputCls, Skeleton, btn } from "@/components/ui";
import { Form, Submit } from "@/components/ui/form";
import { fmtNumber } from "@/lib/format";
import { viError } from "@/lib/errors";

type Pkg = { id: string; seq_no: number; gw_kg: number; length_cm: number; width_cm: number; height_cm: number; cbm: number; vol_kg: number; chargeable_kg: number;
  status: string; warehouse_id: string | null; tracking_no: string | null; note: string | null; row_version: number };

// Kiện của một đơn: mã vận đơn, cân đo, kho, trạng thái; sửa từng kiện hoặc hàng loạt
export function OrderPackages({ orderId, orderCode }: { orderId: string; orderCode?: string }) {
  const s = useSession();
  const qc = useQueryClient();
  const key = ["packages", orderId];
  const pk = useQuery({ queryKey: key, queryFn: () => q<Pkg[]>(supabase.from("packages").select("id, seq_no, gw_kg, length_cm, width_cm, height_cm, cbm, vol_kg, chargeable_kg, status, warehouse_id, tracking_no, note, row_version").eq("order_id", orderId).is("deleted_at", null).order("seq_no")) });
  const wh = useQuery({ queryKey: ["warehouses"], staleTime: Infinity, queryFn: () => q<{ id: string; code: string; name: string }[]>(supabase.from("warehouses").select("id, code, name").order("sort_order")) });
  const write = s.can("warehouse.write");
  const P = pk.data ?? [];
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState({ warehouse_id: "", status: "", tracking_no: "" });
  const sum = (k: keyof Pkg) => P.reduce((a, p) => a + Number(p[k] ?? 0), 0);
  const refresh = () => { pk.refetch(); ["order", "order-progress", "admin-orders"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); };
  const update = async (p: Pkg, patch: Partial<Pkg>) => {
    const { error } = await supabase.from("packages").update({ ...patch, row_version: p.row_version }).eq("id", p.id);
    if (error) alert(viError(error)); else refresh();
  };
  const applyBulk = async () => {
    const patch: Record<string, unknown> = {};
    if (bulk.warehouse_id) patch.warehouse_id = bulk.warehouse_id;
    if (bulk.status) patch.status = bulk.status;
    if (bulk.tracking_no.trim()) patch.tracking_no = bulk.tracking_no.trim();
    if (!Object.keys(patch).length) return;
    for (const p of P.filter((x) => sel.has(x.id))) {
      const { error } = await supabase.from("packages").update({ ...patch, ...(bulk.warehouse_id && p.status === "du_kien" && !bulk.status ? { status: "ve_kho" } : {}), row_version: p.row_version }).eq("id", p.id);
      if (error) { alert(viError(error)); break; }
    }
    setSel(new Set()); setBulk({ warehouse_id: "", status: "", tracking_no: "" }); refresh();
  };
  const whCode = (id: string | null) => wh.data?.find((w) => w.id === id)?.code ?? "—";
  const label = (p: Pkg) => `${orderCode ?? ""}-${p.seq_no}/${P.length}`;

  return (
    <Card title={`Kiện hàng (${P.length})`} actions={P.length ? <span className="text-sm text-muted">{fmtNumber(sum("gw_kg"))} kg thực · <b className="text-ink">{fmtNumber(sum("chargeable_kg"))} kg tính phí</b> · {fmtNumber(sum("cbm"))} m³</span> : null}>
      {pk.isLoading ? <Skeleton rows={2} /> : P.length === 0 ? <p className="text-sm text-muted">Chưa có kiện. {write ? "Kho nhập kiện bên dưới." : ""}</p> : (
        <>
          {write && sel.size ? (
            <div className="mb-3 flex flex-wrap items-end gap-2 rounded-xl bg-brand-soft p-3 text-sm">
              <b className="self-center">{sel.size} kiện đã chọn:</b>
              <select value={bulk.warehouse_id} onChange={(e) => setBulk({ ...bulk, warehouse_id: e.target.value })} className={inputCls + " h-9 w-auto"}><option value="">Kho…</option>{(wh.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
              <select value={bulk.status} onChange={(e) => setBulk({ ...bulk, status: e.target.value })} className={inputCls + " h-9 w-auto"}><option value="">Trạng thái…</option>{Object.entries(PKG_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
              <input value={bulk.tracking_no} onChange={(e) => setBulk({ ...bulk, tracking_no: e.target.value })} placeholder="Mã vận đơn chung" className={inputCls + " h-9 w-44"} />
              <button onClick={applyBulk} className={btn.primary + " h-9 px-4"}>Áp dụng</button>
            </div>
          ) : null}
          <div className="divide-y divide-line/70 rounded-xl border border-line">
            <div className="hidden grid-cols-[28px_1.3fr_1.4fr_1.2fr_.8fr_1.6fr] gap-3 bg-surface px-3 py-2 text-[12.5px] font-medium uppercase tracking-wide text-muted md:grid">
              <span>{write ? <input type="checkbox" checked={sel.size === P.length} onChange={(e) => setSel(e.target.checked ? new Set(P.map((p) => p.id)) : new Set())} /> : null}</span>
              <span>Kiện</span><span>Mã vận đơn</span><span>Cân đo</span><span className="text-right">Tính phí</span><span>Kho · trạng thái</span>
            </div>
            {P.map((p) => (
              <div key={p.id} className={`grid grid-cols-2 items-center gap-x-3 gap-y-2 px-3 py-2.5 text-[14px] md:grid-cols-[28px_1.3fr_1.4fr_1.2fr_.8fr_1.6fr] ${sel.has(p.id) ? "bg-brand-soft/40" : ""}`}>
                <span className="hidden md:block">{write ? <input type="checkbox" checked={sel.has(p.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(p.id); else n.delete(p.id); setSel(n); }} /> : null}</span>
                <span className="font-semibold">{label(p)}</span>
                <span>{write ? <input defaultValue={p.tracking_no ?? ""} placeholder="Nhập mã vận đơn" onBlur={(e) => { const v = e.target.value.trim(); if (v !== (p.tracking_no ?? "")) update(p, { tracking_no: v || null }); }} className={inputCls + " h-9"} />
                  : (p.tracking_no ?? <span className="text-muted">—</span>)}</span>
                <span className="text-[13px] text-muted">{fmtNumber(p.gw_kg)} kg · {fmtNumber(p.length_cm)}×{fmtNumber(p.width_cm)}×{fmtNumber(p.height_cm)} cm<br />quy đổi {fmtNumber(p.vol_kg)} kg</span>
                <span className="text-right font-semibold">{fmtNumber(p.chargeable_kg)} kg</span>
                <span className="col-span-2 flex gap-2 md:col-span-1">
                  {write ? <>
                    <select value={p.warehouse_id ?? ""} onChange={(e) => update(p, { warehouse_id: e.target.value || null, ...(p.status === "du_kien" ? { status: "ve_kho" } : {}) })} className={inputCls + " h-9 w-[72px] px-2"}>
                      <option value="">—</option>{(wh.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}</select>
                    <select value={p.status} onChange={(e) => update(p, { status: e.target.value })} className={inputCls + " h-9 min-w-0 flex-1 px-2"}>
                      {Object.entries(PKG_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
                  </> : <><Badge>{whCode(p.warehouse_id)}</Badge><Badge tone={PKG_STATUS[p.status]?.tone}>{PKG_STATUS[p.status]?.label}</Badge></>}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {write ? (
        <details className="mt-4 border-t border-line pt-4" open={P.length === 0}>
          <summary className="cursor-pointer text-sm font-semibold text-brand-strong">+ Nhận kiện / cân đo</summary>
          <Form className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" resetOnOk invalidate={[key, ["order", orderId], ["order-progress"]]} onSubmit={async (f) => {
            const n = (k: string) => Number(String(f.get(k) ?? "").replace(",", ".") || 0);
            const count = Math.max(1, Math.min(200, Math.round(n("count") || 1)));
            const start = (P.reduce((a, p) => Math.max(a, p.seq_no), 0)) + 1;
            const tn = String(f.get("tracking_no") ?? "").trim() || null;
            const rows = Array.from({ length: count }, (_, i) => ({ order_id: orderId, seq_no: start + i, gw_kg: n("gw_kg"), length_cm: n("l"), width_cm: n("w"), height_cm: n("h"), warehouse_id: f.get("warehouse_id") || null, status: "ve_kho", tracking_no: tn }));
            const { error } = await supabase.from("packages").insert(rows);
            return error ? { error: viError(error) } : { ok: true, message: `Đã nhận ${count} kiện.` };
          }}>
            <Field label="Số kiện giống nhau"><input name="count" defaultValue={1} inputMode="numeric" className={inputCls} /></Field>
            <Field label="Mã vận đơn (nội địa TQ)"><input name="tracking_no" className={inputCls} /></Field>
            <Field label="Kho nhận"><select name="warehouse_id" className={inputCls}>{(wh.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
            <Field label="Kg / kiện"><input name="gw_kg" inputMode="decimal" className={inputCls} /></Field>
            <Field label="Dài (cm)"><input name="l" inputMode="decimal" className={inputCls} /></Field>
            <Field label="Rộng (cm)"><input name="w" inputMode="decimal" className={inputCls} /></Field>
            <Field label="Cao (cm)"><input name="h" inputMode="decimal" className={inputCls} /></Field>
            <div className="flex items-end justify-end"><Submit>Lưu kiện</Submit></div>
          </Form>
        </details>
      ) : null}
    </Card>
  );
}
