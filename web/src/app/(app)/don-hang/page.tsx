"use client";

import Link from "next/link";
import { useState } from "react";
import { useSession } from "@/lib/session";
import { useCustomers, useEntities } from "@/lib/data";
import { useOrders } from "@/lib/orders";
import { ORDER_STATUS, INVOICE_TYPE } from "@/lib/status";
import { PageHeader, Card, DataList, Badge, Empty, LinkButton, inputCls, Skeleton } from "@/components/ui";
import { vnd, fmtDate, fmtNumber } from "@/lib/format";
import { AdminOrderTable } from "@/components/admin-orders";

export default function OrdersPage() {
  const s = useSession();
  if (!s.isStaff) return <CustomerOrders />;
  return (
    <>
      <PageHeader eyebrow="Vận hành" title="Đơn hàng" desc="Toàn bộ đơn: tiến độ thanh toán, khai báo, kiện, giao hàng, hóa đơn trên một bảng. Bấm tiêu đề cột để sắp xếp."
        actions={s.can("order.write") ? <LinkButton href="/don-hang/moi/">+ Tạo đơn</LinkButton> : null} />
      <Card><AdminOrderTable /></Card>
    </>
  );
}

function CustomerOrders() {
  const s = useSession();
  const [status, setStatus] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [entityId, setEntityId] = useState("");
  const [text, setText] = useState("");
  const customers = useCustomers();
  const ents = useEntities(s.isStaff ? customerId || null : null);
  const orders = useOrders({ status: status || undefined, customerId: customerId || undefined, entityId: entityId || undefined });
  const rows = (orders.data ?? []).filter((o) => !text || [o.code, o.supplier_name, o.goods_desc, o.order_week].join(" ").toLowerCase().includes(text.toLowerCase()));
  const canCreate = s.can("order.write") || s.can("order.create_own");
  const totals = rows.reduce((a, o) => ({ total: a.total + Number(o.fin?.total_vnd ?? 0), remain: a.remain + Number(o.fin?.remaining_vnd ?? 0) }), { total: 0, remain: 0 });
  const showMoney = !s.isStaff || s.can("finance.read");

  return (
    <>
      <PageHeader eyebrow="Vận hành" title="Đơn hàng" desc={`${rows.length} đơn${showMoney ? ` · tổng ${vnd(totals.total)} · còn phải thu ${vnd(totals.remain)}` : ""}`}
        actions={canCreate ? <LinkButton href="/don-hang/moi/">+ Tạo đơn</LinkButton> : null} />
      <Card>
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tìm mã đơn, shop, hàng, tuần…" className={inputCls} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
            <option value="">Mọi trạng thái</option>{Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          {s.isStaff ? <select value={customerId} onChange={(e) => { setCustomerId(e.target.value); setEntityId(""); }} className={inputCls}>
            <option value="">Mọi khách hàng</option>{(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </select> : null}
          {(!s.isStaff && !s.entity) || (s.isStaff && customerId) ? <select value={entityId} onChange={(e) => setEntityId(e.target.value)} className={inputCls}>
            <option value="">Mọi công ty con</option>{(ents.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}
          </select> : null}
        </div>
        {orders.isLoading ? <Skeleton rows={6} /> : (
          <DataList rows={rows} empty={<Empty title="Chưa có đơn hàng" />}
            columns={[
              { head: "Mã đơn", cell: (o) => <Link href={`/don-hang/chi-tiet/?id=${o.id}`} className="font-mono font-semibold text-brand-strong hover:underline">{o.code}</Link> },
              { head: "Công ty", cell: (o) => <div><div className="font-medium">{o.customer_entities?.legal_name}</div><div className="text-xs text-muted">{o.customers?.code} · tuần {o.order_week ?? "—"}</div></div> },
              { head: "Hàng / shop", cell: (o) => <div className="max-w-[220px]"><div className="truncate">{o.goods_desc ?? "—"}</div><div className="truncate text-xs text-muted">{o.supplier_name ?? ""} · {INVOICE_TYPE[o.china_invoice_type]}</div></div> },
              { head: "Tiền hàng (tệ)", cell: (o) => <span className="font-mono">{fmtNumber(o.goods_cny)}</span>, className: "text-right" },
              ...(showMoney ? [
                { head: "Phải thu", cell: (o: (typeof rows)[number]) => <span className="font-mono">{o.fin?.total_vnd ? vnd(o.fin.total_vnd) : "—"}</span>, className: "text-right" },
                { head: "Còn lại", cell: (o: (typeof rows)[number]) => <span className={`font-mono ${Number(o.fin?.remaining_vnd) > 0 ? "text-danger" : "text-ok"}`}>{o.fin?.total_vnd ? vnd(o.fin.remaining_vnd) : "—"}</span>, className: "text-right" },
              ] : []),
              { head: "Trạng thái", cell: (o) => <Badge tone={ORDER_STATUS[o.status]?.tone}>{ORDER_STATUS[o.status]?.label}</Badge> },
              { head: "Ngày tạo", cell: (o) => <span className="text-xs text-muted">{fmtDate(o.created_at)}</span> },
            ]}
            mobile={(o) => (
              <Link href={`/don-hang/chi-tiet/?id=${o.id}`} className="block">
                <div className="flex items-center justify-between"><span className="font-mono font-semibold text-brand-strong">{o.code}</span><Badge tone={ORDER_STATUS[o.status]?.tone}>{ORDER_STATUS[o.status]?.label}</Badge></div>
                <div className="mt-1 font-medium">{o.customer_entities?.legal_name}</div>
                <div className="text-xs text-muted">{o.goods_desc ?? "—"} · {fmtNumber(o.goods_cny)} tệ{showMoney && o.fin?.total_vnd ? ` · còn ${vnd(o.fin.remaining_vnd)}` : ""}</div>
              </Link>
            )} />
        )}
      </Card>
    </>
  );
}
