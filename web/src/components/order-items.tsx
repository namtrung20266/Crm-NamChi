"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { useLookups, rpc } from "@/lib/meta";
import { useAttachments, uploadFile } from "@/lib/files";
import { COMPLIANCE, COMPLIANCE_STATUS } from "@/lib/status";
import { Card, Badge, Field, inputCls, Skeleton, btn, Notice } from "./ui";
import { Form, Submit, ActionButton } from "./ui/form";
import { Thumb } from "./files";
import { Modal } from "./modal";
import { fmtNumber } from "@/lib/format";
import { viError } from "@/lib/errors";

export type Item = {
  id: string; order_id: string; line_no: number; name_cn: string | null; model: string | null; brand: string | null; declared_name_vi: string; declared_name_en: string | null;
  hs_code: string | null; uom: string; qty: number; unit_price_cny: number; value_cny: number; origin: string; manufacturer: string | null; material: string | null;
  usage: string | null; spec: string | null; packing: string | null; product_link: string | null; item_note: string | null;
  compliance_need: string; compliance_status: string; status: string; row_version: number;
};
// Cột khi dán từ Excel (nhận diện theo tiêu đề nếu có, không thì theo thứ tự này)
const COLS: [keyof Item, string, RegExp][] = [
  ["declared_name_vi", "Tên hàng (VN)", /tên.*(vn|việt|khai)|^tên hàng$|^tên sp/i], ["name_cn", "Tên TQ", /trung|中文|品名|cn/i], ["model", "Model", /model|mã|型号|art/i],
  ["brand", "Thương hiệu", /hiệu|brand|品牌/i], ["uom", "ĐVT", /đvt|đơn vị|unit|单位/i], ["qty", "Số lượng", /số lượng|sl|qty|quantity|数量/i],
  ["unit_price_cny", "Đơn giá (tệ)", /đơn giá|price|单价/i], ["material", "Chất liệu", /chất liệu|material|材质/i], ["usage", "Công dụng", /công dụng|usage|用途/i],
  ["spec", "Quy cách/kích thước", /quy cách|kích thước|spec|size|规格/i], ["packing", "Đóng gói", /đóng gói|packing|包装/i], ["manufacturer", "Nhà sản xuất", /sản xuất|manufact|厂/i],
  ["hs_code", "Mã HS", /hs/i], ["product_link", "Link", /link|url/i],
];

function parsePaste(text: string) {
  const rows = text.replace(/\r/g, "").split("\n").filter((r) => r.trim()).map((r) => r.split("\t"));
  if (!rows.length) return { map: [] as (keyof Item | null)[], data: [] as string[][] };
  const head = rows[0];
  const detected = head.map((h) => COLS.find(([, , re]) => re.test(h.trim()))?.[0] ?? null);
  const hasHeader = detected.filter(Boolean).length >= 2;
  const map = hasHeader ? detected : head.map((_, i) => COLS[i]?.[0] ?? null);
  return { map, data: hasHeader ? rows.slice(1) : rows };
}
const n = (v: string) => Number(String(v ?? "").replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")) || 0;

// Dòng khai báo của 1 đơn: CSKH/khách nhập (dán Excel được), ảnh từng dòng, XNK xác nhận
export function OrderItems({ orderId, readOnly = false }: { orderId: string; readOnly?: boolean }) {
  const s = useSession();
  const qc = useQueryClient();
  const key = ["items", orderId];
  const items = useQuery({ queryKey: key, queryFn: () => q<Item[]>(supabase.from("order_items").select("*").eq("order_id", orderId).is("deleted_at", null).order("line_no")) });
  const I = items.data ?? [];
  const imgs = useAttachments("order_item", I.map((i) => i.id));
  const warn = useQuery({ queryKey: ["item-warn", orderId], enabled: s.isStaff, queryFn: () => q<{ item_id: string; detail: string }[]>(supabase.from("order_item_warnings").select("item_id, detail").eq("order_id", orderId)) });
  const uoms = useLookups("uom");
  const [edit, setEdit] = useState<Item | null>(null);
  const [adding, setAdding] = useState(false);
  const [paste, setPaste] = useState<string | null>(null);
  const [pErr, setPErr] = useState<string | null>(null);
  const write = !readOnly && (s.isStaff ? s.can("customs.write") : s.can("order.create_own"));
  const confirmP = s.can("customs.confirm");
  const w = (id: string) => (warn.data ?? []).filter((x) => x.item_id === id);
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["item-warn", orderId] }); qc.invalidateQueries({ queryKey: ["order-progress"] }); };

  const save = async (f: FormData) => {
    const o = (k: string) => String(f.get(k) ?? "").trim() || null;
    const hs = (o("hs_code") ?? "").replace(/\D/g, "") || null;
    if (hs && hs.length !== 8) return { error: "Mã HS phải đủ 8 số" };
    const row: Record<string, unknown> = { declared_name_vi: o("declared_name_vi"), declared_name_en: o("declared_name_en"), name_cn: o("name_cn"), model: o("model"), brand: o("brand"), hs_code: hs,
      uom: o("uom") ?? "Chiếc", qty: n(String(f.get("qty") ?? "")), unit_price_cny: n(String(f.get("unit_price_cny") ?? "")), origin: o("origin") ?? "CN", manufacturer: o("manufacturer"),
      material: o("material"), usage: o("usage"), spec: o("spec"), packing: o("packing"), product_link: o("product_link"), item_note: o("item_note") };
    if (s.isStaff) Object.assign(row, { compliance_need: String(f.get("compliance_need") ?? "none"), compliance_status: String(f.get("compliance_status") ?? "khong_can") });
    if (!row.declared_name_vi || !((row.qty as number) > 0)) return { error: "Cần tên hàng và số lượng" };
    const r = edit ? await supabase.from("order_items").update({ ...row, row_version: edit.row_version }).eq("id", edit.id).select("id").single()
      : await supabase.from("order_items").insert({ ...row, order_id: orderId }).select("id").single();
    if (r.error) return { error: viError(r.error) };
    const files = (f.getAll("images") as File[]).filter((x) => x && x.size > 0);
    for (const file of files) { try { await uploadFile(file, "order_item", r.data.id, { category: "anh_san_pham" }); } catch (e) { return { error: `Đã lưu dòng nhưng ảnh lỗi: ${e instanceof Error ? e.message : ""}` }; } }
    setEdit(null); setAdding(false); refresh(); qc.invalidateQueries({ queryKey: ["attachments", "order_item"] });
    return { ok: true, message: edit ? "Đã sửa (dòng đã xác nhận sẽ về nháp)." : "Đã thêm dòng." };
  };

  const doPaste = async () => {
    const { map, data } = parsePaste(paste ?? "");
    const rows = data.map((r) => Object.fromEntries(map.map((k, i) => [k, r[i]]).filter(([k]) => k))).filter((r) => r.declared_name_vi && n(String(r.qty)) > 0)
      .map((r) => ({ ...r, qty: n(String(r.qty)), unit_price_cny: n(String(r.unit_price_cny ?? "")) }));
    if (!rows.length) { setPErr("Không đọc được dòng nào có Tên hàng và Số lượng. Kiểm tra lại thứ tự cột."); return; }
    try { await rpc("add_order_items", { p_order_id: orderId, p_rows: rows }); setPaste(null); setPErr(null); refresh(); } catch (e) { setPErr(viError(e)); }
  };
  const pv = paste ? parsePaste(paste) : null;
  const totalVal = I.reduce((a, i) => a + Number(i.value_cny), 0);
  const F = edit ?? undefined;
  const formOpen = adding || !!edit;

  return (
    <Card title={`Hàng & khai báo (${I.length} dòng · ${fmtNumber(totalVal)} tệ)`} actions={write ? (
      <div className="flex gap-2"><button onClick={() => { setPaste(""); setPErr(null); }} className={btn.secondary + " h-8 px-3 text-xs"}>Dán từ Excel</button>
        <button onClick={() => { setEdit(null); setAdding(true); }} className={btn.primary + " h-8 px-3 text-xs"}>+ Thêm dòng</button></div>) : null}>
      {items.isLoading ? <Skeleton rows={2} /> : I.length === 0 ? <p className="text-sm text-muted">Chưa có dòng hàng. {write ? "Dán thẳng bảng từ Excel (có hoặc không có dòng tiêu đề) để nhập nhanh." : ""}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-[13px]">
            <thead><tr className="border-b border-line text-left text-[11px] uppercase text-muted">
              <th className="py-2">#</th><th>Ảnh</th><th>Tên khai báo · model</th><th>HS</th><th className="text-right">SL</th><th className="text-right">Đơn giá</th><th className="text-right">Trị giá</th><th>Chất liệu · quy cách</th><th>Chuyên ngành</th><th>TT</th><th />
            </tr></thead>
            <tbody>{I.map((i) => {
              const pics = (imgs.data ?? []).filter((a) => a.entity_ref_id === i.id);
              return (
                <tr key={i.id} className="border-b border-line/70 align-top">
                  <td className="py-2 font-mono text-xs">{i.line_no}</td>
                  <td className="py-2"><div className="flex gap-1">{pics.slice(0, 2).map((a) => <Thumb key={a.id} a={a} size={44} />)}{pics.length > 2 ? <span className="self-center text-[10px] text-muted">+{pics.length - 2}</span> : null}
                    {!pics.length ? <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-dashed border-danger/40 text-[10px] text-danger">Thiếu ảnh</span> : null}</div></td>
                  <td className="max-w-[240px] py-2"><div className="font-medium">{i.declared_name_vi}</div><div className="text-[11px] text-muted">{[i.model, i.brand, i.name_cn].filter(Boolean).join(" · ")}</div>
                    {w(i.id).map((x, k) => <div key={k} className="mt-0.5 text-[11px] text-amber-700">⚠ {x.detail}</div>)}</td>
                  <td className="py-2 font-mono text-xs">{i.hs_code ?? <span className="text-danger">—</span>}</td>
                  <td className="py-2 text-right font-mono">{fmtNumber(i.qty)} <span className="text-[10px] text-muted">{i.uom}</span></td>
                  <td className="py-2 text-right font-mono">{fmtNumber(i.unit_price_cny)}</td>
                  <td className="py-2 text-right font-mono">{fmtNumber(i.value_cny)}</td>
                  <td className="max-w-[160px] py-2 text-[11px] text-muted">{[i.material, i.spec, i.packing].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="py-2 text-[11px]">{i.compliance_need === "none" ? "—" : `${COMPLIANCE[i.compliance_need]}: ${COMPLIANCE_STATUS[i.compliance_status]}`}</td>
                  <td className="py-2">{i.status === "da_xac_nhan" ? <Badge tone="ok">Đã XN</Badge> : <Badge tone="warn">Nháp</Badge>}</td>
                  <td className="py-2 text-right"><div className="flex justify-end gap-1.5">
                    {write && (s.isStaff || i.status !== "da_xac_nhan") ? <button onClick={() => { setAdding(false); setEdit(i); }} className="text-xs font-semibold text-brand-strong">Sửa</button> : null}
                    {confirmP && i.status !== "da_xac_nhan" ? <ActionButton invalidate={[key]} onClick={() => rpc("confirm_order_item", { p_item_id: i.id })}>Xác nhận</ActionButton> : null}
                  </div></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}

      <Modal open={formOpen} onClose={() => { setEdit(null); setAdding(false); }} title={edit ? `Sửa dòng ${edit.line_no}` : "Thêm dòng hàng"} wide>
        <Form key={edit?.id ?? "new"} className="grid gap-3 sm:grid-cols-4" onSubmit={save}>
          <div className="sm:col-span-2"><Field label="Tên khai báo tiếng Việt *"><input name="declared_name_vi" required defaultValue={F?.declared_name_vi} className={inputCls} /></Field></div>
          <Field label="Tên tiếng Trung"><input name="name_cn" defaultValue={F?.name_cn ?? ""} className={inputCls} /></Field>
          <Field label="Tên tiếng Anh"><input name="declared_name_en" defaultValue={F?.declared_name_en ?? ""} className={inputCls} /></Field>
          <Field label="Model / mã hàng"><input name="model" defaultValue={F?.model ?? ""} className={inputCls} /></Field>
          <Field label="Thương hiệu"><input name="brand" defaultValue={F?.brand ?? ""} placeholder="Không nhãn hiệu" className={inputCls} /></Field>
          <Field label="Số lượng *"><input name="qty" inputMode="decimal" required defaultValue={F?.qty ?? ""} className={inputCls + " font-mono"} /></Field>
          <Field label="Đơn vị tính"><input name="uom" list="uom-list" defaultValue={F?.uom ?? "Chiếc"} className={inputCls} /><datalist id="uom-list">{(uoms.data ?? []).map((u) => <option key={u.code} value={u.label} />)}</datalist></Field>
          <Field label="Đơn giá (tệ)"><input name="unit_price_cny" inputMode="decimal" defaultValue={F?.unit_price_cny ?? ""} className={inputCls + " font-mono"} /></Field>
          <Field label="Mã HS (8 số)"><input name="hs_code" inputMode="numeric" defaultValue={F?.hs_code ?? ""} className={inputCls + " font-mono"} /></Field>
          <Field label="Xuất xứ"><input name="origin" defaultValue={F?.origin ?? "CN"} className={inputCls} /></Field>
          <Field label="Nhà sản xuất"><input name="manufacturer" defaultValue={F?.manufacturer ?? ""} className={inputCls} /></Field>
          <Field label="Chất liệu"><input name="material" defaultValue={F?.material ?? ""} className={inputCls} /></Field>
          <Field label="Công dụng"><input name="usage" defaultValue={F?.usage ?? ""} className={inputCls} /></Field>
          <Field label="Quy cách / kích thước"><input name="spec" defaultValue={F?.spec ?? ""} className={inputCls} /></Field>
          <Field label="Đóng gói" hint="VD: 12 chiếc/hộp, 10 hộp/thùng"><input name="packing" defaultValue={F?.packing ?? ""} className={inputCls} /></Field>
          <div className="sm:col-span-2"><Field label="Link sản phẩm"><input name="product_link" defaultValue={F?.product_link ?? ""} placeholder="https://…" className={inputCls} /></Field></div>
          <div className="sm:col-span-2"><Field label="Ghi chú dòng"><input name="item_note" defaultValue={F?.item_note ?? ""} className={inputCls} /></Field></div>
          {s.isStaff ? <>
            <Field label="Hồ sơ chuyên ngành"><select name="compliance_need" defaultValue={F?.compliance_need ?? "none"} className={inputCls}>{Object.entries(COMPLIANCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Tiến độ hồ sơ"><select name="compliance_status" defaultValue={F?.compliance_status ?? "khong_can"} className={inputCls}>{Object.entries(COMPLIANCE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          </> : null}
          <div className="sm:col-span-4"><Field label="Ảnh sản phẩm / tem mác (chọn nhiều)" hint="Lưu Google Drive, gắn vào dòng này. Ảnh lớn tự thu nhỏ."><input name="images" type="file" multiple accept="image/*" className="block w-full text-sm" /></Field></div>
          {edit ? <div className="sm:col-span-4"><div className="text-[12px] font-medium">Ảnh đã có</div><div className="mt-1 flex flex-wrap gap-2">{(imgs.data ?? []).filter((a) => a.entity_ref_id === edit.id).map((a) => <Thumb key={a.id} a={a} />)}</div></div> : null}
          <div className="flex justify-end gap-2 sm:col-span-4"><button type="button" onClick={() => { setEdit(null); setAdding(false); }} className={btn.ghost}>Hủy</button><Submit>{edit ? "Lưu dòng" : "Thêm dòng"}</Submit></div>
        </Form>
      </Modal>

      <Modal open={paste !== null} onClose={() => setPaste(null)} title="Dán bảng hàng từ Excel" wide>
        <p className="mb-2 text-xs text-muted">Copy vùng bảng trong Excel (kèm dòng tiêu đề càng tốt) rồi dán vào đây. Không có tiêu đề thì theo thứ tự cột: {COLS.map((c) => c[1]).join(" | ")}.</p>
        <textarea value={paste ?? ""} onChange={(e) => setPaste(e.target.value)} rows={6} autoFocus className={inputCls + " h-auto py-2 font-mono text-xs"} placeholder="Dán (Ctrl+V) tại đây…" />
        {pv && pv.data.length ? (
          <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-line">
            <table className="w-full text-[11.5px]"><thead className="bg-surface"><tr>{pv.map.map((k, i) => <th key={i} className={`px-2 py-1 text-left ${k ? "text-brand-strong" : "text-muted line-through"}`}>{k ? COLS.find((c) => c[0] === k)?.[1] : "bỏ qua"}</th>)}</tr></thead>
              <tbody>{pv.data.slice(0, 30).map((r, i) => <tr key={i} className="border-t border-line/60">{pv.map.map((_, j) => <td key={j} className="px-2 py-1">{r[j]}</td>)}</tr>)}</tbody></table>
          </div>
        ) : null}
        {pErr ? <div className="mt-2"><Notice>{pErr}</Notice></div> : null}
        <div className="mt-3 flex justify-end gap-2"><span className="mr-auto self-center text-xs text-muted">{pv?.data.length ?? 0} dòng · ảnh thêm sau ở từng dòng</span>
          <button onClick={() => setPaste(null)} className={btn.ghost}>Hủy</button><button onClick={doPaste} className={btn.primary}>Thêm {pv?.data.length ?? 0} dòng</button></div>
      </Modal>
    </Card>
  );
}
