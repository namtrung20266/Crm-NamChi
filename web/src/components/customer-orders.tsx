"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/session";
import { useStatusDefs, statusOf, PAYMENT_STATE, DELIVERY_STATE, INVOICE_STATE, rpc, type Tone } from "@/lib/meta";
import { UploadThumb } from "./upload-thumb";
import { Badge, inputCls, Skeleton, Empty, btn, usePaged } from "./ui";
import { InlineNote } from "./order-note";
import { vnd, fmtNumber, fmtDate } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";

type CO = { id: string; code: string; customer_ref: string | null; entity_name: string; entity_id: string; goods_desc: string | null; supplier_name: string | null; goods_cny: number; goods_qty: number;
  weight_kg: number; packages: number; order_week: string | null; status: string; created_at: string; note: string | null; thumb_id: string | null; images_count: number;
  days_in_status: number; total_vnd: number; deposit_vnd: number; paid_vnd: number; remaining_vnd: number; payment_state: string; items_total: number; items_confirmed: number;
  pkg_total: number; pkg_cn: number; pkg_on_trip: number; pkg_vn: number; pkg_delivered: number; qty_total: number; qty_delivered: number; delivery_state: string;
  qty_invoiced: number; invoice_state: string; messages_count: number; unread_count: number };
const Chip = ({ s }: { s?: { label: string; tone: Tone } }) => (s ? <Badge tone={s.tone}>{s.label}</Badge> : null);


// Danh sách đơn của khách: đếm theo trạng thái, ảnh, thanh toán, kiện, giao, hóa đơn, ghi chú, xuất Excel đơn đã chọn
export function CustomerOrderList() {
  const s = useSession();
  const defs = useStatusDefs();
  const [st, setSt] = useState("");
  const [txt, setTxt] = useState("");
  const [ent, setEnt] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const d = useQuery({ queryKey: ["my-orders"], queryFn: () => rpc<CO[]>("customer_orders", { p_filter: {} }) });
  const all = d.data ?? [];
  const entities = [...new Map(all.map((o) => [o.entity_id, o.entity_name])).entries()];
  const rows = useMemo(() => all.filter((o) => (!st || o.status === st) && (!ent || o.entity_id === ent) &&
    (!txt || [o.code, o.customer_ref, o.goods_desc, o.supplier_name, o.entity_name].join(" ").toLowerCase().includes(txt.toLowerCase()))), [all, st, ent, txt]);
  const { view, pager } = usePaged(rows);
  const counts = (defs.data ?? []).map((x) => [x.code, (x.customer_label || x.label), all.filter((o) => o.status === x.code).length] as const).filter(([, , n]) => n > 0);
  const exp = () => downloadCsv(`don-hang-${new Date().toISOString().slice(0, 10)}.csv`,
    ["Mã đơn", "Mã PO", "Công ty", "Hàng", "Shop", "Tiền hàng (tệ)", "Số lượng", "Trạng thái", "Phải trả", "Đã trả", "Còn lại", "Số kiện", "Kiện đã giao", "SL đã giao", "SL đã xuất HĐ", "Ghi chú", "Ngày tạo"],
    (sel.size ? rows.filter((o) => sel.has(o.id)) : rows).map((o) => [o.code, o.customer_ref, o.entity_name, o.goods_desc, o.supplier_name, o.goods_cny, o.goods_qty, statusOf(defs.data, o.status, true).label,
      o.total_vnd, o.paid_vnd, o.remaining_vnd, o.pkg_total, o.pkg_delivered, o.qty_delivered, o.qty_invoiced, o.note, fmtDate(o.created_at)]));
  const sum = rows.reduce((a, o) => ({ t: a.t + Number(o.total_vnd), r: a.r + Math.max(0, Number(o.remaining_vnd)) }), { t: 0, r: 0 });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => setSt("")} className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${!st ? "bg-ink text-white" : "bg-white text-muted ring-1 ring-line"}`}>Tất cả <span className="opacity-70">{all.length}</span></button>
        {counts.map(([k, l, n]) => <button key={k} onClick={() => setSt(k)} className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${st === k ? "bg-ink text-white" : "bg-white text-muted ring-1 ring-line"}`}>{l} <span className="opacity-70">{n}</span></button>)}
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Tìm mã đơn, PO, hàng, shop…" className={inputCls + " sm:col-span-2"} />
        {!s.entity && entities.length > 1 ? <select value={ent} onChange={(e) => setEnt(e.target.value)} className={inputCls}><option value="">Mọi công ty</option>{entities.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select> : <span />}
        <button onClick={exp} className={btn.secondary}>Xuất Excel ({sel.size || rows.length}{sel.size ? " đã chọn" : ""})</button>
      </div>
      <div className="rounded-lg bg-surface px-3 py-2 text-[13.5px] text-muted"><b className="text-ink">{rows.length}</b> đơn · phải trả <b className="text-ink">{vnd(sum.t)}</b> · còn phải trả <b className="text-danger">{vnd(sum.r)}</b></div>
      {d.isLoading ? <Skeleton rows={6} /> : rows.length === 0 ? <Empty title="Không có đơn" /> : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full text-[14px]">
            <thead className="bg-surface text-left text-[12.5px] uppercase tracking-wide text-muted"><tr>
              <th className="px-2 py-2.5"><input type="checkbox" checked={view.length > 0 && view.every((o) => sel.has(o.id))} onChange={(e) => { const n = new Set(sel); view.forEach((o) => e.target.checked ? n.add(o.id) : n.delete(o.id)); setSel(n); }} /></th>
              <th className="px-1">Ảnh</th><th className="px-2">Đơn · hàng</th><th className="px-2">Trạng thái</th><th className="px-2">Thanh toán</th><th className="px-2">Kiện · giao · HĐ</th><th className="px-2">Ghi chú của bạn</th>
            </tr></thead>
            <tbody>{view.map((o) => { const x = statusOf(defs.data, o.status, true); return (
              <tr key={o.id} className={`border-t border-line/70 align-top ${sel.has(o.id) ? "bg-brand-soft/40" : ""}`}>
                <td className="px-2 py-3"><input type="checkbox" checked={sel.has(o.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(o.id); else n.delete(o.id); setSel(n); }} /></td>
                <td className="px-1 py-3"><UploadThumb id={o.thumb_id} n={o.images_count} entityType="order" refId={o.id} /></td>
                <td className="px-2 py-3"><Link href={`/don-hang/chi-tiet/?id=${o.id}`} className="font-semibold text-brand-strong hover:underline">{o.code}</Link>
                  {o.unread_count ? <span className="ml-1 rounded-full bg-brand px-1.5 text-[12px] text-white">{o.unread_count} mới</span> : null}
                  <div className="font-medium">{o.goods_desc ?? "—"}</div><div className="text-[13px] text-muted">{o.entity_name}{o.customer_ref ? ` · PO ${o.customer_ref}` : ""} · {fmtNumber(o.goods_cny)} tệ · {fmtDate(o.created_at)}</div></td>
                <td className="px-2 py-3"><Badge tone={x.tone}>{x.label}</Badge><div className="mt-1 text-[12.5px] text-muted">{o.days_in_status} ngày</div></td>
                <td className="px-2 py-3"><Chip s={PAYMENT_STATE[o.payment_state]} />{o.total_vnd ? <div className="mt-1 text-[13px]">{vnd(o.total_vnd)}<div className={o.remaining_vnd > 0 ? "text-danger" : "text-ok"}>còn {vnd(o.remaining_vnd)}</div></div> : null}</td>
                <td className="space-y-1 px-2 py-3 text-[13px]">{o.pkg_total ? <div>{o.pkg_total} kiện · TQ {o.pkg_cn} · xe {o.pkg_on_trip} · VN {o.pkg_vn} · đã giao {o.pkg_delivered}</div> : <div className="text-muted">Chưa có kiện</div>}
                  <div className="flex flex-wrap gap-1"><Chip s={DELIVERY_STATE[o.delivery_state]} /><Chip s={INVOICE_STATE[o.invoice_state]} /></div></td>
                <td className="w-56 px-2 py-3"><InlineNote orderId={o.id} kind="customer" value={o.note} canEdit placeholder="+ Ghi chú" compact /></td>
              </tr>); })}</tbody>
          </table>
          <div className="px-3 pb-3">{pager}</div>
        </div>
      )}
    </div>
  );
}
