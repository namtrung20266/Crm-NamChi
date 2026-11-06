"use client";

import { Field, inputCls } from "@/components/ui";
import { INVOICE_TYPE } from "@/lib/status";
import type { Order } from "@/lib/orders";

export const GOODS_GROUPS: Record<string, string> = { "": "Chung", giay_dep: "Giày dép", tet: "Hàng Tết", gau_bong: "Gấu bông", thoi_trang: "Thời trang", gia_dung: "Gia dụng" };

export function OrderFields({ o, staff }: { o?: Partial<Order>; staff: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Tuần đặt hàng" hint="VD: 45/2026"><input name="order_week" defaultValue={o?.order_week ?? ""} className={inputCls} /></Field>
      <Field label="Shop / mã NCC"><input name="supplier_name" defaultValue={o?.supplier_name ?? ""} className={inputCls} /></Field>
      <Field label="Nhóm hàng"><select name="goods_group" defaultValue={o?.goods_group ?? ""} className={inputCls}>{Object.entries(GOODS_GROUPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <div className="sm:col-span-2 lg:col-span-3"><Field label="Mô tả hàng"><input name="goods_desc" defaultValue={o?.goods_desc ?? ""} placeholder="VD: Lì xì, treo Tết, quả cầu…" className={inputCls} /></Field></div>
      <Field label="Hình thức hóa đơn TQ"><select name="china_invoice_type" defaultValue={o?.china_invoice_type ?? "HDPT"} className={inputCls}>{Object.entries(INVOICE_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Tổng số lượng"><input name="goods_qty" inputMode="decimal" defaultValue={o?.goods_qty ?? ""} className={inputCls + " font-mono"} /></Field>
      <Field label="Tổng tiền hàng (tệ)"><input name="goods_cny" inputMode="decimal" required defaultValue={o?.goods_cny ?? ""} className={inputCls + " font-mono"} /></Field>
      {staff ? <>
        <Field label="Tỷ giá chốt với khách" hint="Ghim theo đơn, dùng cho mọi số tiền với khách"><input name="fx_rate" inputMode="decimal" required defaultValue={o?.fx_rate ?? ""} className={inputCls + " font-mono"} /></Field>
        <Field label="Thuế xuất HĐ TQ thực tế (tệ)"><input name="china_tax_cny" inputMode="decimal" defaultValue={o?.china_tax_cny ?? 0} className={inputCls + " font-mono"} /></Field>
        <Field label="Cân tính phí (kg)"><input name="weight_kg" inputMode="decimal" defaultValue={o?.weight_kg ?? 0} className={inputCls + " font-mono"} /></Field>
        <Field label="Khối (m³)"><input name="cbm" inputMode="decimal" defaultValue={o?.cbm ?? 0} className={inputCls + " font-mono"} /></Field>
        <Field label="Số kiện"><input name="packages" inputMode="numeric" defaultValue={o?.packages ?? 0} className={inputCls + " font-mono"} /></Field>
        <Field label="VAT tạm tính (%)"><input name="vat_rate" inputMode="decimal" defaultValue={o?.vat_rate ?? 8} className={inputCls + " font-mono"} /></Field>
        <Field label="Dự kiến về (tuần)"><input name="expected_week" defaultValue={o?.expected_week ?? ""} className={inputCls} /></Field>
      </> : null}
      <div className="sm:col-span-2 lg:col-span-3"><Field label="Ghi chú (khách thấy)"><textarea name="note" rows={2} defaultValue={o?.note ?? ""} className={inputCls + " h-auto py-2"} /></Field></div>
      {staff ? <div className="sm:col-span-2 lg:col-span-3"><Field label="Ghi chú nội bộ"><textarea name="internal_note" rows={2} defaultValue={o?.internal_note ?? ""} className={inputCls + " h-auto py-2"} /></Field></div> : null}
    </div>
  );
}

const num = (f: FormData, k: string) => Number(String(f.get(k) ?? "").replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".") || 0);
const opt = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v || null; };

export function readOrder(f: FormData, staff: boolean) {
  const goods_cny = num(f, "goods_cny");
  if (!(goods_cny > 0)) return { error: "Nhập tổng tiền hàng (tệ) lớn hơn 0" } as const;
  const base: Record<string, unknown> = {
    order_week: opt(f, "order_week"), supplier_name: opt(f, "supplier_name"), goods_group: opt(f, "goods_group"), goods_desc: opt(f, "goods_desc"),
    china_invoice_type: String(f.get("china_invoice_type") ?? "HDPT"), goods_qty: num(f, "goods_qty"), goods_cny, note: opt(f, "note"),
  };
  if (staff) {
    const fx = num(f, "fx_rate");
    if (!(fx > 0)) return { error: "Nhập tỷ giá chốt" } as const;
    Object.assign(base, { fx_rate: fx, china_tax_cny: num(f, "china_tax_cny"), weight_kg: num(f, "weight_kg"), cbm: num(f, "cbm"),
      packages: Math.round(num(f, "packages")), vat_rate: num(f, "vat_rate"), expected_week: opt(f, "expected_week"), internal_note: opt(f, "internal_note") });
  }
  return { data: base } as const;
}
