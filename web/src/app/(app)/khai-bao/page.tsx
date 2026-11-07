"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { useEntities } from "@/lib/data";
import { useLookups, rpc, type Tone } from "@/lib/meta";
import { useFileUrl, fileBlobUrl } from "@/lib/files";
import { PageHeader, Card, Badge, Empty, inputCls, Skeleton, btn, usePaged } from "@/components/ui";
import { fmtNumber } from "@/lib/format";
import { viError } from "@/lib/errors";

type D = {
  id: string; order_id: string; line_no: number; declared_name_vi: string; name_cn: string | null; model: string | null; brand: string | null; hs_code: string | null;
  uom: string; qty: number; unit_price_cny: number; value_cny: number; material: string | null; usage: string | null; spec: string | null; packing: string | null;
  status: string; desk_status: string; alloc_weight_kg: number | null; alloc_cbm: number | null; weight_override_kg: number | null; desk_note: string | null; row_version: number;
  compliance_need: string; compliance_status: string;
  order_code: string; order_status: string; entity_name: string; entity_id: string; customer_ref: string | null; pkg_total: number; order_gw_kg: number;
  images: number; thumb_id: string | null; picked_qty: number; warnings: string[];
};
const EDIT: [keyof D, string, string][] = [["declared_name_vi", "Tên khai báo", "min-w-[200px]"], ["hs_code", "HS", "w-24"], ["qty", "SL", "w-20 text-right"], ["uom", "ĐVT", "w-16"],
  ["unit_price_cny", "Đơn giá (tệ)", "w-24 text-right"], ["material", "Chất liệu", "w-28"], ["model", "Model", "w-24"], ["weight_override_kg", "Kg nhập tay", "w-20 text-right"]];

function Img({ id, n }: { id: string | null; n: number }) {
  const u = useFileUrl(id ?? "", true, !!id);
  if (!id) return <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-dashed border-danger/40 text-[11px] text-danger">Thiếu ảnh</span>;
  return <button type="button" onClick={async () => window.open(await fileBlobUrl(id), "_blank", "noopener")} className="relative h-11 w-11 overflow-hidden rounded-lg border border-line">
    {u.data ? <img src={u.data} alt="" className="h-full w-full object-cover" /> : <span className="skeleton block h-full w-full" />}{n > 1 ? <span className="absolute bottom-0 right-0 bg-ink/70 px-0.5 text-[10px] text-white">{n}</span> : null}</button>;
}

// Ô sửa tại chỗ: bấm vào để sửa, Enter/rời ô để lưu
function Cell({ r, k, cls, onSaved }: { r: D; k: keyof D; cls: string; onSaved: () => void }) {
  const [v, setV] = useState<string | null>(null);
  const val = r[k] == null ? "" : String(r[k]);
  const save = async () => {
    if (v === null || v === val) { setV(null); return; }
    const num = ["qty", "unit_price_cny", "weight_override_kg"].includes(k as string);
    const value = v.trim() === "" ? null : num ? Number(v.replace(/\s/g, "").replace(",", ".")) : k === "hs_code" ? v.replace(/\D/g, "") : v.trim();
    if (k === "hs_code" && value && String(value).length !== 8) { alert("Mã HS phải đủ 8 số"); return; }
    const { error } = await supabase.from("order_items").update({ [k]: value, row_version: r.row_version }).eq("id", r.id);
    if (error) alert(viError(error)); else { setV(null); onSaved(); }
  };
  if (v !== null) return <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setV(null); }}
    className={`h-8 rounded-md border border-brand bg-white px-1.5 text-[13.5px] outline-none ${cls}`} />;
  return <button type="button" onClick={() => setV(val)} className={`block min-h-8 w-full rounded-md px-1.5 py-1 text-left text-[13.5px] hover:bg-brand-soft ${cls} ${val ? "" : "text-danger/70"}`}>
    {val ? (["qty", "unit_price_cny", "weight_override_kg"].includes(k as string) ? fmtNumber(Number(val)) : val) : k === "weight_override_kg" ? "—" : "trống"}</button>;
}

// Bàn khai báo: sửa trực tiếp, trạng thái xử lý, cân nặng phân bổ từ kiện, chọn dòng lập list bốc
export default function CustomsDesk() {
  const s = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const st = useLookups("desk_status");
  const [ds, setDs] = useState("");
  const [ent, setEnt] = useState("");
  const [txt, setTxt] = useState("");
  const [done, setDone] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const ents = useEntities(null);
  const data = useQuery({ queryKey: ["desk", ent, done], queryFn: () => rpc<D[]>("desk_items", { p_filter: { entity_id: ent, include_done: done } }) });
  const all = data.data ?? [];
  const rows = useMemo(() => all.filter((r) => (!ds || r.desk_status === ds) && (!txt || [r.declared_name_vi, r.model, r.hs_code, r.order_code, r.entity_name, r.name_cn].join(" ").toLowerCase().includes(txt.toLowerCase()))), [all, ds, txt]);
  const { view, pager } = usePaged(rows);
  const refresh = () => qc.invalidateQueries({ queryKey: ["desk"] });
  const tone = (c: string) => (st.data?.find((x) => x.code === c)?.meta.tone as Tone) ?? "neutral";
  const label = (c: string) => st.data?.find((x) => x.code === c)?.label ?? c;
  const write = s.can("customs.write");
  const setStatus = async (ids: string[], code: string) => {
    for (const id of ids) { const r = all.find((x) => x.id === id); if (!r) continue;
      const { error } = await supabase.from("order_items").update({ desk_status: code, row_version: r.row_version }).eq("id", id); if (error) { alert(viError(error)); break; } }
    refresh();
  };
  const picking = async () => {
    const ids = [...sel];
    const bad = all.filter((r) => sel.has(r.id) && r.status !== "da_xac_nhan");
    if (bad.length) { alert(`${bad.length} dòng chưa xác nhận khai báo (VD: ${bad[0].order_code} dòng ${bad[0].line_no}). Xác nhận trước khi lập list bốc.`); return; }
    try { const id = await rpc<string>("create_picking_from_items", { p_item_ids: ids, p_note: null }); router.push(`/list-boc/chi-tiet/?id=${id}`); } catch (e) { alert(viError(e)); }
  };
  if (!s.isStaff) return <Empty title="Trang nội bộ" />;
  return (
    <>
      <PageHeader eyebrow="Hải quan" title="Bàn khai báo" desc="Bấm vào ô để sửa ngay. Cân nặng mỗi dòng = tổng kg kiện của đơn chia theo trị giá (đổi cách chia ở Cấu hình); nhập tay ô 'Kg nhập tay' khi có cân mẫu." />
      <Card>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {[["", "Tất cả", all.length] as const, ...(st.data ?? []).filter((x) => x.is_active && (done || x.code !== "da_khai")).map((x) => [x.code, x.label, all.filter((r) => r.desk_status === x.code).length] as const)].map(([k, v, n]) => (
            <button key={k} onClick={() => setDs(k)} className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${ds === k ? "bg-ink text-white" : "bg-white text-muted ring-1 ring-line hover:text-ink"}`}>{v} <span className="opacity-70">{n}</span></button>
          ))}
        </div>
        <div className="mb-3 grid gap-2 sm:grid-cols-4">
          <input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Tìm tên, model, HS, mã đơn, công ty…" className={inputCls + " sm:col-span-2"} />
          <select value={ent} onChange={(e) => setEnt(e.target.value)} className={inputCls}><option value="">Mọi công ty con</option>{(ents.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}</select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} /> Hiện cả dòng đã khai tờ khai</label>
        </div>
        {sel.size ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-brand-soft p-3 text-sm">
            <b>{sel.size} dòng đã chọn</b>
            {write ? <select value="" onChange={(e) => { if (e.target.value) setStatus([...sel], e.target.value); }} className={inputCls + " h-9 w-auto"}><option value="">Đổi trạng thái…</option>{(st.data ?? []).map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select> : null}
            {s.can("customs.confirm") ? <button className={btn.secondary + " h-9 px-3"} onClick={async () => { for (const id of sel) { try { await rpc("confirm_order_item", { p_item_id: id }); } catch (e) { alert(viError(e)); break; } } refresh(); }}>Xác nhận khai báo</button> : null}
            {s.can("logistics.write") ? <button className={btn.primary + " h-9 px-4"} onClick={picking}>Lập list bốc từ {sel.size} dòng →</button> : null}
            <button className="ml-auto text-muted" onClick={() => setSel(new Set())}>Bỏ chọn</button>
          </div>
        ) : null}
        {data.isLoading ? <Skeleton rows={6} /> : rows.length === 0 ? <Empty title="Không có dòng nào" /> : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-[14px]">
              <thead className="bg-surface text-left text-[12.5px] uppercase tracking-wide text-muted"><tr>
                <th className="px-2 py-2.5"><input type="checkbox" checked={view.every((r) => sel.has(r.id))} onChange={(e) => { const n = new Set(sel); view.forEach((r) => e.target.checked ? n.add(r.id) : n.delete(r.id)); setSel(n); }} /></th>
                <th className="px-2">Đơn · ảnh</th>{EDIT.map(([k, l]) => <th key={k} className="px-1.5">{l}</th>)}<th className="px-2 text-right">Kg phân bổ</th><th className="px-2">Trạng thái</th><th className="px-2">Ghi chú</th><th />
              </tr></thead>
              <tbody>{view.map((r) => (
                <tr key={r.id} className={`border-t border-line/70 align-top ${sel.has(r.id) ? "bg-brand-soft/40" : ""}`}>
                  <td className="px-2 py-2"><input type="checkbox" checked={sel.has(r.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(r.id); else n.delete(r.id); setSel(n); }} /></td>
                  <td className="px-2 py-2"><div className="flex gap-2"><Img id={r.thumb_id} n={r.images} /><div>
                    <Link href={`/don-hang/chi-tiet/?id=${r.order_id}&tab=hang`} className="font-semibold text-brand-strong hover:underline">{r.order_code}</Link><span className="text-muted"> · dòng {r.line_no}</span>
                    <div className="max-w-[160px] truncate text-[12.5px] text-muted">{r.entity_name}</div>
                    {r.warnings.map((w, i) => <div key={i} className="text-[12px] text-amber-700">⚠ {w}</div>)}</div></div></td>
                  {EDIT.map(([k, , cls]) => <td key={k} className="px-0.5 py-1.5">{write ? <Cell r={r} k={k} cls={cls} onSaved={refresh} /> : <span className="px-1.5">{String(r[k] ?? "—")}</span>}</td>)}
                  <td className="px-2 py-2 text-right"><b>{r.alloc_weight_kg != null ? fmtNumber(r.alloc_weight_kg) : "—"}</b><div className="text-[12px] text-muted">{r.pkg_total ? `${r.pkg_total} kiện · ${fmtNumber(r.order_gw_kg)} kg đơn` : "chưa có kiện"}</div></td>
                  <td className="px-2 py-2">{write ? <select value={r.desk_status} onChange={(e) => setStatus([r.id], e.target.value)} className="h-8 rounded-md border border-line bg-white px-1 text-[13px]">{(st.data ?? []).map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select> : <Badge tone={tone(r.desk_status)}>{label(r.desk_status)}</Badge>}
                    <div className="mt-1">{r.status === "da_xac_nhan" ? <Badge tone="ok">Đã xác nhận</Badge> : <Badge tone="warn">Chưa xác nhận</Badge>}</div>
                    {r.picked_qty ? <div className="text-[12px] text-muted">đã bốc {fmtNumber(r.picked_qty)}/{fmtNumber(r.qty)}</div> : null}</td>
                  <td className="px-0.5 py-1.5">{write ? <Cell r={r} k="desk_note" cls="w-40" onSaved={refresh} /> : r.desk_note}</td>
                  <td className="px-2 py-2">{s.can("customs.confirm") && r.status !== "da_xac_nhan" ? <button onClick={async () => { try { await rpc("confirm_order_item", { p_item_id: r.id }); refresh(); } catch (e) { alert(viError(e)); } }} className="text-[13px] font-semibold text-brand-strong">Xác nhận</button> : null}</td>
                </tr>))}</tbody>
            </table>
            <div className="px-3 pb-3">{pager}</div>
          </div>
        )}
      </Card>
    </>
  );
}
