"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/session";
import { rpc } from "@/lib/meta";
import { Card, Badge, Empty } from "./ui";
import { fmtNumber, fmtDate, vnd } from "@/lib/format";

type D = { lines: { item_id: string; line_no: number; name: string; model: string | null; uom: string; qty: number; delivered_qty: number; purchased_qty: number | null; hh_code: string | null; issued_qty: number; draft_qty: number; missing_qty: number; compliance_ok: boolean }[];
  invoices: { id: string; draft_code: string; invoice_no: string | null; invoice_date: string | null; status: string; batch_label: string | null; qty: number; amount_vnd: number; vat_vnd: number }[] };
const ST: Record<string, [string, "neutral" | "info" | "ok"]> = { nhap: ["Nháp", "neutral"], da_xuat_file: ["Đã xuất file MISA", "info"], da_phat_hanh: ["Đã phát hành", "ok"] };

// Hóa đơn theo từng dòng hàng: đã xuất bao nhiêu, còn thiếu bao nhiêu; đồng bộ trạng thái HĐ
export function OrderInvoices({ orderId }: { orderId: string }) {
  const s = useSession();
  const d = useQuery({ queryKey: ["order-invoices", orderId], queryFn: () => rpc<D>("order_invoice_detail", { p_order_id: orderId }) });
  const x = d.data;
  const staff = s.isStaff && s.can("finance.read");
  const tq = (x?.lines ?? []).reduce((a, l) => ({ q: a.q + Number(l.qty), i: a.i + Math.min(Number(l.issued_qty), Number(l.qty)), m: a.m + Number(l.missing_qty) }), { q: 0, i: 0, m: 0 });
  return (
    <div className="space-y-5">
      <Card title="Xuất hóa đơn theo dòng hàng" actions={x?.lines.length ? <Badge tone={tq.m === 0 ? "ok" : tq.i > 0 ? "warn" : "neutral"}>{tq.m === 0 ? "Đã xuất đủ" : `Còn thiếu ${fmtNumber(tq.m)} / ${fmtNumber(tq.q)}`}</Badge> : null}>
        {!x ? <div className="skeleton h-24" /> : x.lines.length === 0 ? <Empty title="Chưa có dòng khai báo" desc="Hóa đơn bán xuất theo dòng hàng đã khai báo." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[14px]">
              <thead><tr className="text-left text-[12.5px] uppercase text-muted"><th className="pb-2">#</th><th className="pb-2">Hàng</th><th className="pb-2 text-right">SL hàng</th><th className="pb-2 text-right">Đã giao</th>
                {staff ? <th className="pb-2 text-right">HĐ đầu vào</th> : null}<th className="pb-2 text-right">Đã phát hành</th><th className="pb-2 text-right">Đang lập</th><th className="pb-2 text-right">Còn thiếu</th><th className="pb-2">Tiến độ</th></tr></thead>
              <tbody>{x.lines.map((l) => {
                const pct = l.qty ? Math.min(100, (l.issued_qty / l.qty) * 100) : 0;
                return (
                  <tr key={l.item_id} className="border-t border-line/70">
                    <td className="py-2 font-mono text-xs">{l.line_no}</td>
                    <td className="py-2"><div className="font-medium">{l.name}</div><div className="text-[12.5px] text-muted">{[l.model, staff && l.hh_code ? `Mã HH ${l.hh_code}` : null].filter(Boolean).join(" · ")}{!l.compliance_ok ? <span className="text-danger"> · chưa xong hồ sơ chuyên ngành</span> : null}</div></td>
                    <td className="py-2 text-right font-mono">{fmtNumber(l.qty)} <span className="text-[12px] text-muted">{l.uom}</span></td>
                    <td className="py-2 text-right font-mono">{fmtNumber(l.delivered_qty)}</td>
                    {staff ? <td className={`py-2 text-right font-mono ${Number(l.purchased_qty) < Number(l.qty) ? "text-amber-700" : ""}`}>{fmtNumber(l.purchased_qty)}</td> : null}
                    <td className="py-2 text-right font-mono text-ok">{fmtNumber(l.issued_qty)}</td>
                    <td className="py-2 text-right font-mono">{fmtNumber(l.draft_qty)}</td>
                    <td className={`py-2 text-right font-mono font-semibold ${l.missing_qty > 0 ? "text-danger" : "text-ok"}`}>{fmtNumber(l.missing_qty)}</td>
                    <td className="w-28 py-2"><div className="h-1.5 overflow-hidden rounded-full bg-surface"><div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} /></div></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Hóa đơn bán liên quan">
        {(x?.invoices ?? []).length === 0 ? <p className="text-sm text-muted">Chưa có hóa đơn{staff ? "" : " đã phát hành"}.</p> : (
          <ul className="divide-y divide-line/70 text-sm">{x!.invoices.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><span className="font-mono font-semibold">{i.invoice_no ?? i.draft_code}</span> {i.batch_label ? <Badge tone="brand">{i.batch_label}</Badge> : null} <Badge tone={ST[i.status]?.[1]}>{ST[i.status]?.[0] ?? i.status}</Badge> <span className="text-xs text-muted">{fmtDate(i.invoice_date)}</span></span>
              <span className="font-mono text-xs">{fmtNumber(i.qty)} SL · {vnd(Number(i.amount_vnd) + Number(i.vat_vnd))}</span>
            </li>))}</ul>
        )}
      </Card>
    </div>
  );
}
