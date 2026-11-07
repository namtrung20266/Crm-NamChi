"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { useStaff } from "@/lib/data";
import { useStatusDefs, statusOf, useLookups, lookupLabel, rpc, PAYMENT_STATE, DELIVERY_STATE, INVOICE_STATE } from "@/lib/meta";
import { INVOICE_TYPE } from "@/lib/status";
import { PageHeader, Card, Badge, Empty, Field, inputCls, LinkButton, Skeleton, btn } from "@/components/ui";
import { Form, Submit, ActionButton } from "@/components/ui/form";
import { OrderStatusBar } from "@/components/order-status";
import { OrderFinance, StatementSummary } from "@/components/order-finance";
import { InlineNote } from "@/components/order-note";
import { OrderProfit } from "@/components/order-profit";
import { OrderInvoices } from "@/components/order-invoices";
import { OrderItems } from "@/components/order-items";
import { OrderPackages } from "@/components/order-packages";
import { OrderChat } from "@/components/order-chat";
import { FileDrop, AttachmentGallery } from "@/components/files";
import { vnd, fmtNumber, fmtDate, fmtDateTime } from "@/lib/format";
import { viError } from "@/lib/errors";
import type { AdminOrder } from "@/components/admin-orders";

type O = {
  id: string; code: string; customer_id: string; entity_id: string; customer_ref: string | null; source_channel: string | null; order_week: string | null; supplier_name: string | null;
  supplier_link: string | null; supplier_contact: string | null; goods_group: string | null; goods_desc: string | null; china_invoice_type: string; goods_qty: number; goods_cny: number;
  fx_rate: number; china_tax_cny: number; weight_kg: number; cbm: number; packages: number; vat_rate: number; deposit_rate: number | null; status: string; expected_week: string | null;
  delay_reason: string | null; note: string | null; internal_note: string | null; cs_owner_id: string | null; require_label_check: boolean; require_inspection: boolean;
  delivery_address: string | null; created_at: string; submitted_at: string | null; row_version: number;
  customer_entities: { code: string; legal_name: string } | null; customers: { code: string; name: string } | null;
};
type Progress = AdminOrder;
const TABS = [["tong-quan", "Tổng quan"], ["hang", "Hàng & khai báo"], ["tai-chinh", "Tài chính"], ["hoa-don", "Hóa đơn"], ["kien", "Kiện & giao"], ["trao-doi", "Trao đổi"], ["lich-su", "Lịch sử"]] as const;

function Detail() {
  const sp = useSearchParams();
  const id = sp.get("id") ?? "";
  const s = useSession();
  const qc = useQueryClient();
  const defs = useStatusDefs();
  const groups = useLookups("goods_group");
  const sources = useLookups("order_source");
  const delays = useLookups("delay_reason");
  const staff = useStaff();
  const [tab, setTab] = useState<string>(sp.get("tab") ?? "tong-quan");
  const [edit, setEdit] = useState(false);
  const order = useQuery({ queryKey: ["order", id], enabled: !!id, queryFn: () => q<O | null>(supabase.from("orders").select("*, customer_entities(code, legal_name), customers(code, name)").eq("id", id).maybeSingle()) });
  const prog = useQuery({ queryKey: ["order-progress", id], enabled: !!id, queryFn: async () => (await rpc<Progress[]>("order_progress", { p_ids: [id] }))[0] ?? null });
  const history = useQuery({ queryKey: ["status-history", id], enabled: !!id, queryFn: () => q<{ id: number; from_status: string | null; to_status: string; changed_at: string; note: string | null; source: string }[]>(supabase.from("order_status_history").select("id, from_status, to_status, changed_at, note, source").eq("order_id", id).order("changed_at", { ascending: false })) });
  if (order.isLoading) return <Skeleton rows={8} />;
  const o = order.data;
  if (!o) return <Empty title="Không tìm thấy đơn" desc="Có thể bạn không có quyền xem đơn này." />;
  const p = prog.data;
  const refresh = () => ["order", "order-progress", "status-history", "admin-orders", "notifications"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const st = statusOf(defs.data, o.status, !s.isStaff);
  const canEdit = s.isStaff ? s.can("order.write") : o.status === "dang_len_don";
  const unreadMsg = p?.unread_count ?? 0;

  const info = (
    <Card title="Thông tin đơn" actions={canEdit ? <button className={btn.ghost + " h-8 px-3 text-xs"} onClick={() => setEdit((v) => !v)}>{edit ? "Đóng" : "Sửa"}</button> : null}>
      {edit ? (
        <Form onSubmit={async (f) => {
          const g = (k: string) => String(f.get(k) ?? "").trim() || null;
          const nm = (k: string) => Number(String(f.get(k) ?? "").replace(/\s/g, "").replace(",", ".")) || 0;
          const upd: Record<string, unknown> = { customer_ref: g("customer_ref"), source_channel: g("source_channel"), supplier_name: g("supplier_name"), supplier_link: g("supplier_link"),
            supplier_contact: g("supplier_contact"), goods_group: g("goods_group"), goods_desc: g("goods_desc"), china_invoice_type: f.get("china_invoice_type"), goods_qty: nm("goods_qty"),
            goods_cny: nm("goods_cny"), order_week: g("order_week"), require_label_check: f.get("require_label_check") === "on", require_inspection: f.get("require_inspection") === "on",
            delivery_address: g("delivery_address"), note: g("note"), row_version: o.row_version };
          if (s.isStaff) Object.assign(upd, { fx_rate: nm("fx_rate"), china_tax_cny: nm("china_tax_cny"), vat_rate: nm("vat_rate"), deposit_rate: g("deposit_rate") ? nm("deposit_rate") : null,
            expected_week: g("expected_week"), delay_reason: g("delay_reason"), internal_note: g("internal_note"), cs_owner_id: g("cs_owner_id") });
          const { error } = await supabase.from("orders").update(upd).eq("id", o.id);
          if (error) return { error: viError(error) };
          setEdit(false); refresh();
          return { ok: true, message: "Đã lưu. Lập lại phiếu tính tiền nếu số tiền/tỷ giá thay đổi." };
        }}>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-3"><Field label="Mô tả hàng"><input name="goods_desc" defaultValue={o.goods_desc ?? ""} className={inputCls} /></Field></div>
            <Field label="Mã PO khách"><input name="customer_ref" defaultValue={o.customer_ref ?? ""} className={inputCls} /></Field>
            <Field label="Nguồn đơn"><select name="source_channel" defaultValue={o.source_channel ?? ""} className={inputCls}><option value="">—</option>{(sources.data ?? []).map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select></Field>
            <Field label="Nhóm hàng"><select name="goods_group" defaultValue={o.goods_group ?? ""} className={inputCls}><option value="">Chung</option>{(groups.data ?? []).map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select></Field>
            <Field label="Shop / NCC"><input name="supplier_name" defaultValue={o.supplier_name ?? ""} className={inputCls} /></Field>
            <Field label="Link shop"><input name="supplier_link" defaultValue={o.supplier_link ?? ""} className={inputCls} /></Field>
            <Field label="Liên hệ NCC"><input name="supplier_contact" defaultValue={o.supplier_contact ?? ""} className={inputCls} /></Field>
            <Field label="Tiền hàng (tệ)"><input name="goods_cny" defaultValue={o.goods_cny} className={inputCls + " font-mono"} /></Field>
            <Field label="Số lượng"><input name="goods_qty" defaultValue={o.goods_qty} className={inputCls + " font-mono"} /></Field>
            <Field label="HĐ Trung Quốc"><select name="china_invoice_type" defaultValue={o.china_invoice_type} className={inputCls}>{Object.entries(INVOICE_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            {s.isStaff ? <>
              <Field label="Tỷ giá chốt"><input name="fx_rate" defaultValue={o.fx_rate} className={inputCls + " font-mono"} /></Field>
              <Field label="Thuế xuất HĐ TQ (tệ)"><input name="china_tax_cny" defaultValue={o.china_tax_cny} className={inputCls + " font-mono"} /></Field>
              <Field label="VAT (%)"><input name="vat_rate" defaultValue={o.vat_rate} className={inputCls + " font-mono"} /></Field>
              <Field label="Tỷ lệ cọc riêng (%)"><input name="deposit_rate" defaultValue={o.deposit_rate ?? ""} className={inputCls + " font-mono"} /></Field>
              <Field label="Dự kiến về (tuần)"><input name="expected_week" defaultValue={o.expected_week ?? ""} className={inputCls} /></Field>
              <Field label="Lý do chậm"><select name="delay_reason" defaultValue={o.delay_reason ?? ""} className={inputCls}><option value="">—</option>{(delays.data ?? []).map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select></Field>
              <Field label="CSKH phụ trách"><select name="cs_owner_id" defaultValue={o.cs_owner_id ?? ""} className={inputCls}><option value="">—</option>{(staff.data ?? []).map((x) => <option key={x.user_id} value={x.user_id}>{x.full_name}</option>)}</select></Field>
            </> : null}
            <Field label="Tuần đặt"><input name="order_week" defaultValue={o.order_week ?? ""} className={inputCls} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="require_label_check" defaultChecked={o.require_label_check} /> Cần check tem/mác</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="require_inspection" defaultChecked={o.require_inspection} /> Cần kiểm định</label>
            <div className="sm:col-span-3"><Field label="Địa chỉ giao"><input name="delivery_address" defaultValue={o.delivery_address ?? ""} className={inputCls} /></Field></div>
            <div className="sm:col-span-3"><Field label="Ghi chú (khách thấy)"><textarea name="note" rows={2} defaultValue={o.note ?? ""} className={inputCls + " h-auto py-2"} /></Field></div>
            {s.isStaff ? <div className="sm:col-span-3"><Field label="Ghi chú nội bộ"><textarea name="internal_note" rows={2} defaultValue={o.internal_note ?? ""} className={inputCls + " h-auto py-2"} /></Field></div> : null}
          </div>
          <div className="flex justify-end"><Submit>Lưu đơn</Submit></div>
        </Form>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          {([["Mã PO khách", o.customer_ref], ["Nguồn đơn", o.source_channel ? lookupLabel(sources.data, o.source_channel) : null], ["Nhóm hàng", lookupLabel(groups.data, o.goods_group)],
            ["Shop / NCC", o.supplier_name], ["Liên hệ NCC", o.supplier_contact], ["HĐ Trung Quốc", INVOICE_TYPE[o.china_invoice_type]],
            ["Tiền hàng", `${fmtNumber(o.goods_cny)} tệ`], ["Số lượng", fmtNumber(o.goods_qty)], ...(s.isStaff ? [["Tỷ giá chốt", fmtNumber(o.fx_rate)], ["Tiền hàng (VND)", vnd(Math.round(o.goods_cny * o.fx_rate))], ["Thuế xuất HĐ TQ", `${fmtNumber(o.china_tax_cny)} tệ`], ["Cọc riêng", o.deposit_rate != null ? `${o.deposit_rate}%` : "Theo cấu hình"]] : []),
            ["Cân tính phí", `${fmtNumber(o.weight_kg)} kg`], ["Khối", `${fmtNumber(o.cbm)} m³`], ["Số kiện", fmtNumber(o.packages)], ["Tuần đặt", o.order_week], ["Dự kiến về", o.expected_week],
            ["Lý do chậm", o.delay_reason ? lookupLabel(delays.data, o.delay_reason) : null], ["CSKH", staff.data?.find((x) => x.user_id === o.cs_owner_id)?.full_name ?? null], ["Gửi đơn lúc", o.submitted_at ? fmtDateTime(o.submitted_at) : null]] as [string, string | null][]).map(([k, v]) => (
            <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="font-medium">{v || "—"}</dd></div>
          ))}
          {o.supplier_link ? <div className="col-span-full"><dt className="text-xs text-muted">Link shop</dt><dd><a href={o.supplier_link} target="_blank" rel="noopener noreferrer" className="break-all text-brand-strong underline">{o.supplier_link}</a></dd></div> : null}
          {o.delivery_address ? <div className="col-span-full"><dt className="text-xs text-muted">Địa chỉ giao</dt><dd>{o.delivery_address}</dd></div> : null}
          {o.note ? <div className="col-span-full"><dt className="text-xs text-muted">Ghi chú</dt><dd className="whitespace-pre-wrap">{o.note}</dd></div> : null}
          {s.isStaff && o.internal_note ? <div className="col-span-full rounded-lg bg-amber-50 p-2"><dt className="text-xs text-amber-800">Ghi chú nội bộ</dt><dd className="whitespace-pre-wrap">{o.internal_note}</dd></div> : null}
        </dl>
      )}
    </Card>
  );

  const chips = p ? [
    ["Thanh toán", PAYMENT_STATE[p.payment_state], p.total_vnd ? `còn ${vnd(p.remaining_vnd)}` : "", "tai-chinh"],
    ["Khai báo", { label: p.items_total ? `${p.items_confirmed}/${p.items_total} xác nhận` : "Chưa có dòng", tone: p.items_total && p.items_confirmed === p.items_total ? "ok" : "warn" }, p.items_total ? `ảnh ${p.items_with_image}/${p.items_total}` : "", "hang"],
    ["Kiện", { label: p.pkg_total ? `${p.pkg_total} kiện` : "Chưa có kiện", tone: p.pkg_issue ? "danger" : "info" }, p.pkg_total ? `TQ ${p.pkg_cn} · xe ${p.pkg_on_trip} · VN ${p.pkg_vn}` : "", "kien"],
    ["Giao hàng", DELIVERY_STATE[p.delivery_state], p.qty_total ? `${fmtNumber(p.qty_delivered)}/${fmtNumber(p.qty_total)}` : "", "kien"],
    ["Hóa đơn", INVOICE_STATE[p.invoice_state], p.qty_total ? `${fmtNumber(p.qty_invoiced)}/${fmtNumber(p.qty_total)}` : "", "hoa-don"],
  ] as const : [];

  return (
    <>
      <PageHeader eyebrow={`${o.customers?.code} · ${o.customer_entities?.legal_name}`} title={`Đơn ${o.code}`}
        desc={`${o.goods_desc ?? "—"} · ${fmtNumber(o.goods_cny)} tệ · tạo ${fmtDate(o.created_at)}${p?.sla_overdue ? " · ⏰ QUÁ HẠN bước hiện tại" : ""}`}
        actions={<div className="flex gap-2">
          {o.status === "dang_len_don" && (!s.isStaff || s.can("order.write")) ? <ActionButton variant="primary" confirmText="Gửi đơn cho Nam Trung? Sau khi gửi, sửa đơn qua trao đổi với CSKH." onClick={async () => { await rpc("submit_order", { p_order_id: o.id }); refresh(); }}>Gửi đơn</ActionButton> : null}
          <LinkButton href="/don-hang/" variant="secondary">← Đơn hàng</LinkButton></div>} />

      {s.isStaff ? <OrderStatusBar orderId={o.id} status={o.status} onChanged={refresh} /> : (
        <div className="card mb-5 flex items-center gap-3 p-4"><Badge tone={st.tone}>{st.label}</Badge><span className="text-sm text-muted">Cập nhật {p ? `${p.days_in_status} ngày trước` : ""}</span></div>
      )}

      {p ? <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {chips.map(([l, c, sub, t]) => (
          <button key={l} onClick={() => setTab(t)} className="card px-3 py-2.5 text-left transition hover:-translate-y-0.5">
            <div className="text-[12.5px] text-muted">{l}</div><div className="mt-0.5">{c ? <Badge tone={c.tone}>{c.label}</Badge> : null}</div><div className="mt-0.5 font-mono text-[12.5px] text-muted">{sub}</div>
          </button>
        ))}
      </div> : null}

      <div className="grid gap-5 xl:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-5">
          <div className="flex gap-1 overflow-x-auto rounded-xl bg-white p-1 ring-1 ring-line">
            {TABS.map(([k, v]) => (
              <button key={k} onClick={() => setTab(k)} className={`relative shrink-0 rounded-lg px-3 py-2 text-[14px] font-semibold transition ${tab === k ? "bg-ink text-white" : "text-muted hover:text-ink"} ${k === "trao-doi" ? "xl:hidden" : ""}`}>
                {v}{k === "trao-doi" && unreadMsg ? <span className="ml-1 rounded-full bg-brand px-1.5 text-[12px] text-white">{unreadMsg}</span> : null}
              </button>
            ))}
          </div>
          {tab === "tong-quan" ? <>
            <div className="grid gap-4 md:grid-cols-2">
              {s.isStaff ? <Card title="Ghi chú nội bộ (NV)"><InlineNote orderId={o.id} kind="internal" value={o.internal_note} canEdit={s.can("order.write")} placeholder="+ Thêm ghi chú cho nhân viên" /></Card> : null}
              <Card title={s.isStaff ? "Ghi chú của khách" : "Ghi chú của bạn"}><InlineNote orderId={o.id} kind="customer" value={o.note} canEdit placeholder="+ Thêm ghi chú cho đơn" /></Card>
            </div>
            <StatementSummary orderId={o.id} onOpen={() => setTab("tai-chinh")} />
            {info}
            <Card title="Ảnh & file của đơn"><div className="space-y-4"><FileDrop entityType="order" refId={o.id} /><AttachmentGallery entityType="order" refId={o.id} /></div></Card>
          </> : null}
          {tab === "hang" ? <OrderItems orderId={o.id} /> : null}
          {tab === "tai-chinh" ? <>
            <OrderFinance order={o} progress={p ?? undefined} onChanged={refresh} />
            <OrderProfit orderId={o.id} />
          </> : null}
          {tab === "hoa-don" ? <OrderInvoices orderId={o.id} /> : null}
          {tab === "kien" ? <OrderPackages orderId={o.id} orderCode={o.code} /> : null}
          {tab === "trao-doi" ? <Card title="Trao đổi trên đơn" className="xl:hidden"><OrderChat orderId={o.id} /></Card> : null}
          {tab === "lich-su" ? (
            <Card title="Lịch sử trạng thái">
              <ol className="relative space-y-3 border-l border-line pl-4 text-sm">{(history.data ?? []).map((h) => (
                <li key={h.id}><span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-brand" />
                  <div className="flex flex-wrap items-center gap-2"><Badge tone={statusOf(defs.data, h.to_status).tone}>{statusOf(defs.data, h.to_status).label}</Badge>
                    <span className="font-mono text-xs text-muted">{fmtDateTime(h.changed_at)}</span>{h.source === "auto" ? <Badge tone="info">tự động</Badge> : h.source === "customer" ? <Badge>khách</Badge> : null}</div>
                  {h.note ? <div className="mt-0.5 text-xs text-ink/80">{h.note}</div> : null}</li>
              ))}</ol>
            </Card>
          ) : null}
        </div>
        <div className="hidden xl:block">
          <div className="sticky top-6"><Card title="Trao đổi trên đơn"><OrderChat orderId={o.id} height="min(620px, calc(100dvh - 170px))" /></Card></div>
        </div>
      </div>
    </>
  );
}

export default function Page() { return <Suspense fallback={<Skeleton rows={8} />}><Detail /></Suspense>; }
