"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { PKG_STATUS } from "@/lib/status";
import { Card, Badge, Field, inputCls, Skeleton } from "@/components/ui";
import { Form, Submit } from "@/components/ui/form";
import { fmtNumber } from "@/lib/format";
import { viError } from "@/lib/errors";

type Pkg = { id: string; label: string; seq_no: number; gw_kg: number; length_cm: number; width_cm: number; height_cm: number; cbm: number; vol_kg: number; chargeable_kg: number; status: string; warehouse_code: string | null; row_version: number };

// Kiện của một đơn: kho nhận, cân đo, đổi trạng thái nhanh
export function OrderPackages({ orderId }: { orderId: string }) {
  const s = useSession();
  const key = ["packages", orderId];
  const pk = useQuery({ queryKey: key, queryFn: () => q<Pkg[]>(supabase.from("package_labels").select("*").eq("order_id", orderId).order("seq_no")) });
  const wh = useQuery({ queryKey: ["warehouses"], staleTime: Infinity, queryFn: () => q<{ id: string; code: string; name: string }[]>(supabase.from("warehouses").select("id, code, name").order("sort_order")) });
  const write = s.can("warehouse.write");
  const P = pk.data ?? [];
  const sum = (k: keyof Pkg) => P.reduce((a, p) => a + Number(p[k] ?? 0), 0);
  const setStatus = async (p: Pkg, status: string, warehouse_id?: string) => {
    const { error } = await supabase.from("packages").update({ status, ...(warehouse_id ? { warehouse_id } : {}), row_version: p.row_version }).eq("id", p.id);
    if (error) alert(viError(error)); else pk.refetch();
  };

  return (
    <Card title={`Kiện hàng (${P.length}) · ${fmtNumber(sum("chargeable_kg"))} kg tính phí · ${fmtNumber(sum("cbm"))} m³`}>
      {pk.isLoading ? <Skeleton rows={2} /> : P.length === 0 ? <p className="text-sm text-muted">Chưa có kiện. {write ? "Kho nhập kiện bên dưới." : ""}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs uppercase text-muted">
              <th className="py-2">Mã kiện</th><th className="text-right">Kg thực</th><th className="text-right">D×R×C (cm)</th><th className="text-right">Kg quy đổi</th><th className="text-right">Kg tính phí</th><th>Kho</th><th>Trạng thái</th>
            </tr></thead>
            <tbody>
              {P.map((p) => (
                <tr key={p.id} className="border-b border-line/70">
                  <td className="py-2 font-mono font-semibold">{p.label}</td>
                  <td className="text-right font-mono">{fmtNumber(p.gw_kg)}</td>
                  <td className="text-right font-mono text-xs">{fmtNumber(p.length_cm)}×{fmtNumber(p.width_cm)}×{fmtNumber(p.height_cm)}</td>
                  <td className="text-right font-mono">{fmtNumber(p.vol_kg)}</td>
                  <td className="text-right font-mono font-semibold">{fmtNumber(p.chargeable_kg)}</td>
                  <td>{write ? <select defaultValue={(wh.data ?? []).find((w) => w.code === p.warehouse_code)?.id ?? ""} onChange={(e) => setStatus(p, p.status === "du_kien" ? "ve_kho" : p.status, e.target.value)} className={inputCls + " h-8 w-24 text-xs"}>
                    <option value="">—</option>{(wh.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}</select> : p.warehouse_code ?? "—"}</td>
                  <td>{write ? <select value={p.status} onChange={(e) => setStatus(p, e.target.value)} className={inputCls + " h-8 w-28 text-xs"}>
                    {Object.entries(PKG_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select> : <Badge tone={PKG_STATUS[p.status]?.tone}>{PKG_STATUS[p.status]?.label}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {write ? (
        <details className="mt-4 border-t border-line pt-4" open={P.length === 0}>
          <summary className="cursor-pointer text-sm font-semibold text-brand-strong">+ Nhận kiện / cân đo</summary>
          <Form className="mt-3 grid gap-3 sm:grid-cols-6" resetOnOk invalidate={[key, ["order", orderId]]} onSubmit={async (f) => {
            const n = (k: string) => Number(String(f.get(k) ?? "").replace(",", ".") || 0);
            const count = Math.max(1, Math.min(200, Math.round(n("count") || 1)));
            const start = (P.reduce((a, p) => Math.max(a, p.seq_no), 0)) + 1;
            const rows = Array.from({ length: count }, (_, i) => ({ order_id: orderId, seq_no: start + i, gw_kg: n("gw_kg"), length_cm: n("l"), width_cm: n("w"), height_cm: n("h"), warehouse_id: f.get("warehouse_id") || null, status: "ve_kho" }));
            const { error } = await supabase.from("packages").insert(rows);
            return error ? { error: viError(error) } : { ok: true, message: `Đã nhận ${count} kiện.` };
          }}>
            <Field label="Số kiện giống nhau"><input name="count" defaultValue={1} inputMode="numeric" className={inputCls + " font-mono"} /></Field>
            <Field label="Kg / kiện"><input name="gw_kg" inputMode="decimal" className={inputCls + " font-mono"} /></Field>
            <Field label="Dài (cm)"><input name="l" inputMode="decimal" className={inputCls + " font-mono"} /></Field>
            <Field label="Rộng (cm)"><input name="w" inputMode="decimal" className={inputCls + " font-mono"} /></Field>
            <Field label="Cao (cm)"><input name="h" inputMode="decimal" className={inputCls + " font-mono"} /></Field>
            <Field label="Kho"><select name="warehouse_id" className={inputCls}>{(wh.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
            <div className="flex justify-end sm:col-span-6"><Submit>Lưu kiện</Submit></div>
          </Form>
        </details>
      ) : null}
    </Card>
  );
}
