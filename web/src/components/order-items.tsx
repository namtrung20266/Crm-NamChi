"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { COMPLIANCE, COMPLIANCE_STATUS } from "@/lib/status";
import { Card, Badge, Field, inputCls, Skeleton } from "@/components/ui";
import { Form, Submit, ActionButton } from "@/components/ui/form";
import { fmtNumber } from "@/lib/format";
import { viError } from "@/lib/errors";

export type Item = {
  id: string; order_id: string; line_no: number; name_cn: string | null; model: string | null; declared_name_vi: string; declared_name_en: string | null;
  hs_code: string | null; uom: string; qty: number; unit_price_cny: number; value_cny: number; origin: string; manufacturer: string | null;
  material: string | null; usage: string | null; spec: string | null; compliance_need: string; compliance_status: string; status: string; row_version: number;
};

// Dòng khai báo của 1 đơn (thay sheet LCH-Khaibao): CSKH lập, XNK xác nhận
export function OrderItems({ orderId }: { orderId: string }) {
  const s = useSession();
  const key = ["items", orderId];
  const items = useQuery({ queryKey: key, queryFn: () => q<Item[]>(supabase.from("order_items").select("*").eq("order_id", orderId).order("line_no")) });
  const warn = useQuery({ queryKey: ["item-warn", orderId], enabled: s.isStaff, queryFn: () => q<{ item_id: string; detail: string }[]>(supabase.from("order_item_warnings").select("item_id, detail").eq("order_id", orderId)) });
  const [edit, setEdit] = useState<Item | null>(null);
  const write = s.can("customs.write"), confirmP = s.can("customs.confirm");
  const I = items.data ?? [];
  const w = (id: string) => (warn.data ?? []).filter((x) => x.item_id === id);

  const save = async (f: FormData) => {
    const o = (k: string) => String(f.get(k) ?? "").trim() || null;
    const n = (k: string) => Number(String(f.get(k) ?? "").replace(",", ".") || 0);
    const hs = (o("hs_code") ?? "").replace(/\D/g, "") || null;
    if (hs && hs.length !== 8) return { error: "Mã HS phải đủ 8 số" };
    const row = { declared_name_vi: o("declared_name_vi"), declared_name_en: o("declared_name_en"), name_cn: o("name_cn"), model: o("model"), hs_code: hs,
      uom: o("uom") ?? "Chiếc", qty: n("qty"), unit_price_cny: n("unit_price_cny"), origin: o("origin") ?? "CN", manufacturer: o("manufacturer"),
      material: o("material"), usage: o("usage"), spec: o("spec"), compliance_need: String(f.get("compliance_need") ?? "none"),
      compliance_status: String(f.get("compliance_status") ?? "khong_can") };
    if (!row.declared_name_vi || !(row.qty > 0)) return { error: "Cần tên khai báo và số lượng" };
    const r = edit
      ? await supabase.from("order_items").update({ ...row, row_version: edit.row_version }).eq("id", edit.id)
      : await supabase.from("order_items").insert({ ...row, order_id: orderId });
    if (r.error) return { error: viError(r.error) };
    setEdit(null);
    return { ok: true, message: edit ? "Đã sửa dòng (nếu đã xác nhận sẽ về trạng thái nháp)." : "Đã thêm dòng." };
  };

  const totalVal = I.reduce((a, i) => a + Number(i.value_cny), 0);
  return (
    <Card title={`Dòng khai báo (${I.length}) · ${fmtNumber(totalVal)} tệ`}>
      {items.isLoading ? <Skeleton rows={2} /> : I.length === 0 ? <p className="text-sm text-muted">Chưa có dòng khai báo.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs uppercase text-muted">
              <th className="py-2">#</th><th>Tên khai báo</th><th>HS</th><th className="text-right">SL</th><th className="text-right">Đơn giá</th><th className="text-right">Trị giá</th><th>Chuyên ngành</th><th>Trạng thái</th><th />
            </tr></thead>
            <tbody>
              {I.map((i) => (
                <tr key={i.id} className="border-b border-line/70 align-top">
                  <td className="py-2 font-mono text-xs">{i.line_no}</td>
                  <td className="py-2"><div className="font-medium">{i.declared_name_vi}</div><div className="text-xs text-muted">{[i.model, i.name_cn, i.manufacturer].filter(Boolean).join(" · ")}</div>
                    {w(i.id).map((x, k) => <div key={k} className="mt-1 text-[11px] text-amber-700">⚠ {x.detail}</div>)}</td>
                  <td className="py-2 font-mono text-xs">{i.hs_code ?? "—"}</td>
                  <td className="py-2 text-right font-mono">{fmtNumber(i.qty)} <span className="text-xs text-muted">{i.uom}</span></td>
                  <td className="py-2 text-right font-mono">{fmtNumber(i.unit_price_cny)}</td>
                  <td className="py-2 text-right font-mono">{fmtNumber(i.value_cny)}</td>
                  <td className="py-2 text-xs">{i.compliance_need === "none" ? "—" : `${COMPLIANCE[i.compliance_need]}: ${COMPLIANCE_STATUS[i.compliance_status]}`}</td>
                  <td className="py-2">{i.status === "da_xac_nhan" ? <Badge tone="ok">Đã xác nhận</Badge> : <Badge tone="warn">Nháp</Badge>}</td>
                  <td className="py-2 text-right">
                    <div className="flex justify-end gap-1.5">
                      {write ? <button onClick={() => setEdit(i)} className="text-xs font-semibold text-brand-strong">Sửa</button> : null}
                      {confirmP && i.status !== "da_xac_nhan" ? <ActionButton invalidate={[key]} onClick={() => q(supabase.rpc("confirm_order_item", { p_item_id: i.id }))}>Xác nhận</ActionButton> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {write ? (
        <details className="mt-4 border-t border-line pt-4" open={!!edit || I.length === 0} key={edit?.id ?? "new"}>
          <summary className="cursor-pointer text-sm font-semibold text-brand-strong">{edit ? `Sửa dòng ${edit.line_no}` : "+ Thêm dòng khai báo"}</summary>
          <Form className="mt-3 grid gap-3 sm:grid-cols-4" resetOnOk invalidate={[key, ["item-warn", orderId]]} onSubmit={save}>
            <div className="sm:col-span-2"><Field label="Tên khai báo tiếng Việt"><input name="declared_name_vi" required defaultValue={edit?.declared_name_vi} className={inputCls} /></Field></div>
            <Field label="Tên tiếng Anh"><input name="declared_name_en" defaultValue={edit?.declared_name_en ?? ""} className={inputCls} /></Field>
            <Field label="Tên tiếng Trung"><input name="name_cn" defaultValue={edit?.name_cn ?? ""} className={inputCls} /></Field>
            <Field label="Model"><input name="model" defaultValue={edit?.model ?? ""} className={inputCls} /></Field>
            <Field label="Mã HS (8 số)"><input name="hs_code" inputMode="numeric" defaultValue={edit?.hs_code ?? ""} className={inputCls + " font-mono"} /></Field>
            <Field label="Đơn vị tính"><input name="uom" defaultValue={edit?.uom ?? "Chiếc"} className={inputCls} /></Field>
            <Field label="Xuất xứ"><input name="origin" defaultValue={edit?.origin ?? "CN"} className={inputCls} /></Field>
            <Field label="Số lượng"><input name="qty" inputMode="decimal" required defaultValue={edit?.qty ?? ""} className={inputCls + " font-mono"} /></Field>
            <Field label="Đơn giá khai báo (tệ)"><input name="unit_price_cny" inputMode="decimal" defaultValue={edit?.unit_price_cny ?? ""} className={inputCls + " font-mono"} /></Field>
            <Field label="Nhà sản xuất"><input name="manufacturer" defaultValue={edit?.manufacturer ?? ""} className={inputCls} /></Field>
            <Field label="Chất liệu"><input name="material" defaultValue={edit?.material ?? ""} className={inputCls} /></Field>
            <Field label="Công dụng"><input name="usage" defaultValue={edit?.usage ?? ""} className={inputCls} /></Field>
            <Field label="Quy cách / thông số"><input name="spec" defaultValue={edit?.spec ?? ""} className={inputCls} /></Field>
            <Field label="Hồ sơ chuyên ngành"><select name="compliance_need" defaultValue={edit?.compliance_need ?? "none"} className={inputCls}>{Object.entries(COMPLIANCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Tiến độ hồ sơ"><select name="compliance_status" defaultValue={edit?.compliance_status ?? "khong_can"} className={inputCls}>{Object.entries(COMPLIANCE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <div className="flex items-end justify-end gap-2 sm:col-span-4">{edit ? <button type="button" onClick={() => setEdit(null)} className="text-sm text-muted">Hủy sửa</button> : null}<Submit>{edit ? "Lưu dòng" : "Thêm dòng"}</Submit></div>
          </Form>
        </details>
      ) : null}
    </Card>
  );
}
