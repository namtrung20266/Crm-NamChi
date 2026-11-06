"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { useCustomers, useEntities } from "@/lib/data";
import { ORDER_STATUS, STATEMENT_KIND } from "@/lib/status";
import { PageHeader, Card, Badge, Empty, inputCls, Skeleton } from "@/components/ui";
import { vnd, fmtDate } from "@/lib/format";

type Row = { order_id: string; code: string; customer_id: string; entity_id: string; status: string; created_at: string; statement_kind: string | null; statement_status: string | null; total_vnd: number; deposit_vnd: number; paid_vnd: number; remaining_vnd: number };

// Bảng đối soát chuẩn: 1 dòng 1 đơn, tự sinh từ sổ, không gõ tay
export default function DebtPage() {
  const s = useSession();
  const [cust, setCust] = useState(""); const [ent, setEnt] = useState(""); const [onlyOpen, setOnlyOpen] = useState(true);
  const customers = useCustomers();
  const ents = useEntities(s.isStaff ? cust || null : null);
  const rows = useQuery({ queryKey: ["debt", cust, ent, onlyOpen], queryFn: () => {
    let x = supabase.from("order_finance").select("*").order("created_at", { ascending: false }).limit(1000);
    if (cust) x = x.eq("customer_id", cust);
    if (ent) x = x.eq("entity_id", ent);
    if (onlyOpen) x = x.neq("remaining_vnd", 0);
    return q<Row[]>(x);
  } });
  const profit = useQuery({ queryKey: ["profit-all"], enabled: s.can("finance.profit.read"), queryFn: () => q<{ order_id: string; revenue_ex_vat: number | null; cost_vnd: number | null }[]>(supabase.from("order_profit").select("order_id, revenue_ex_vat, cost_vnd")) });
  if (s.isStaff && !s.can("finance.read")) return <Empty title="Bạn không có quyền xem công nợ" />;
  const pm = new Map((profit.data ?? []).map((p) => [p.order_id, Number(p.revenue_ex_vat ?? 0) - Number(p.cost_vnd ?? 0)]));
  const entName = (id: string) => ents.data?.find((e) => e.id === id)?.legal_name ?? "";
  const R = rows.data ?? [];
  const sum = (k: keyof Row) => R.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const showProfit = s.can("finance.profit.read");

  const exportCsv = () => {
    const head = ["Mã đơn", "Công ty", "Trạng thái", "Phiếu", "Phải thu", "Cọc L1 đề xuất", "Đã trả", "Còn lại", ...(showProfit ? ["Lãi gộp"] : [])];
    const lines = R.map((r) => [r.code, entName(r.entity_id), ORDER_STATUS[r.status]?.label, r.statement_kind ? STATEMENT_KIND[r.statement_kind] : "", r.total_vnd, r.deposit_vnd, r.paid_vnd, r.remaining_vnd, ...(showProfit ? [pm.get(r.order_id) ?? ""] : [])]);
    const csv = "\ufeff" + [head, ...lines].map((l) => l.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `doi-soat-cong-no-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <>
      <PageHeader eyebrow="Tài chính" title="Công nợ & đối soát" desc="Phải thu = phiếu tính tiền hiệu lực; đã trả = tổng phân bổ tiền vào đơn. Không ai gõ tay số liệu ở đây."
        actions={<button onClick={exportCsv} className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-sm font-semibold">Xuất Excel (CSV)</button>} />
      <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Phải thu", sum("total_vnd"), ""], ["Đã trả", sum("paid_vnd"), "text-ok"], ["Còn phải thu", sum("remaining_vnd"), "text-danger"], ["Số đơn", R.length, ""]].map(([l, v, c]) => (
          <div key={l as string} className="card p-4"><div className="text-xs text-muted">{l}</div><div className={`mt-1 font-mono text-xl font-semibold ${c}`}>{l === "Số đơn" ? v : vnd(v as number)}</div></div>
        ))}
      </section>
      <Card>
        <div className="mb-4 flex flex-wrap gap-2">
          {s.isStaff ? <select value={cust} onChange={(e) => { setCust(e.target.value); setEnt(""); }} className={inputCls + " w-auto"}><option value="">Mọi khách hàng</option>{(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select> : null}
          {(!s.isStaff && !s.entity) || cust ? <select value={ent} onChange={(e) => setEnt(e.target.value)} className={inputCls + " w-auto"}><option value="">Mọi công ty con</option>{(ents.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}</select> : null}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} className="h-4 w-4" /> Chỉ đơn còn chênh</label>
        </div>
        {rows.isLoading ? <Skeleton rows={6} /> : R.length === 0 ? <Empty title="Không có dòng nào" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-2 py-2">Mã đơn</th><th className="px-2 py-2">Công ty</th><th className="px-2 py-2">Trạng thái</th><th className="px-2 py-2">Phiếu</th>
                <th className="px-2 py-2 text-right">Phải thu</th><th className="px-2 py-2 text-right">Đã trả</th><th className="px-2 py-2 text-right">Còn lại</th>{showProfit ? <th className="px-2 py-2 text-right">Lãi gộp</th> : null}
              </tr></thead>
              <tbody>
                {R.map((r) => (
                  <tr key={r.order_id} className="border-b border-line/70 hover:bg-surface/70">
                    <td className="px-2 py-2.5"><Link href={`/don-hang/chi-tiet/?id=${r.order_id}`} className="font-mono font-semibold text-brand-strong">{r.code}</Link><div className="text-[11px] text-muted">{fmtDate(r.created_at)}</div></td>
                    <td className="px-2 py-2.5">{entName(r.entity_id) || "—"}</td>
                    <td className="px-2 py-2.5"><Badge tone={ORDER_STATUS[r.status]?.tone}>{ORDER_STATUS[r.status]?.label}</Badge></td>
                    <td className="px-2 py-2.5 text-xs">{r.statement_kind ? `${STATEMENT_KIND[r.statement_kind]}${r.statement_status === "confirmed" ? " ✓" : ""}` : <span className="text-muted">Chưa lập</span>}</td>
                    <td className="px-2 py-2.5 text-right font-mono">{vnd(r.total_vnd)}</td>
                    <td className="px-2 py-2.5 text-right font-mono text-ok">{vnd(r.paid_vnd)}</td>
                    <td className={`px-2 py-2.5 text-right font-mono ${Number(r.remaining_vnd) > 0 ? "text-danger" : "text-ok"}`}>{vnd(r.remaining_vnd)}</td>
                    {showProfit ? <td className="px-2 py-2.5 text-right font-mono">{pm.has(r.order_id) ? vnd(pm.get(r.order_id)) : "—"}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
