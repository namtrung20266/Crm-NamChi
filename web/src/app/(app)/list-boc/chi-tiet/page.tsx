"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { PageHeader, Card, Badge, Empty, LinkButton, Skeleton, inputCls } from "@/components/ui";
import { ActionButton } from "@/components/ui/form";
import { fmtNumber } from "@/lib/format";
import { viError } from "@/lib/errors";
import type { PLT } from "../page";

type Avail = { id: string; order_id: string; line_no: number; declared_name_vi: string; hs_code: string | null; qty: number; unit_price_cny: number; uom: string; orders: { code: string } | null };
type PLI = { id: string; order_item_id: string; qty: number };
type Pkg = { id: string; label: string; order_id: string; gw_kg: number; cbm: number; status: string };

function Detail() {
  const id = useSearchParams().get("id") ?? "";
  const s = useSession();
  const qc = useQueryClient();
  const [pickQty, setPickQty] = useState<Record<string, string>>({});
  const tot = useQuery({ queryKey: ["pl", id], queryFn: () => q<PLT | null>(supabase.from("picking_list_totals").select("*").eq("id", id).maybeSingle()) });
  const mine = useQuery({ queryKey: ["pl-items", id], queryFn: () => q<PLI[]>(supabase.from("picking_list_items").select("id, order_item_id, qty").eq("picking_list_id", id)) });
  const myPk = useQuery({ queryKey: ["pl-pkgs", id], queryFn: () => q<{ id: string; package_id: string }[]>(supabase.from("picking_list_packages").select("id, package_id").eq("picking_list_id", id)) });
  const avail = useQuery({ queryKey: ["avail-items"], queryFn: () => q<Avail[]>(supabase.from("order_items").select("id, order_id, line_no, declared_name_vi, hs_code, qty, unit_price_cny, uom, orders(code)").eq("status", "da_xac_nhan").order("created_at").limit(1000)) });
  const loaded = useQuery({ queryKey: ["loaded-qty"], queryFn: () => q<{ order_item_id: string; qty: number; picking_lists: { status: string } | null }[]>(supabase.from("picking_list_items").select("order_item_id, qty, picking_lists(status)")) });
  const trips = useQuery({ queryKey: ["trips-open"], queryFn: () => q<{ id: string; code: string; plate: string | null }[]>(supabase.from("trips").select("id, code, plate").eq("status", "nhap").order("created_at", { ascending: false })) });

  const itemMap = new Map((avail.data ?? []).map((a) => [a.id, a]));
  const orderIds = [...new Set((mine.data ?? []).map((m) => itemMap.get(m.order_item_id)?.order_id).filter(Boolean))] as string[];
  const pkgs = useQuery({ queryKey: ["pl-avail-pkgs", orderIds.join(",")], enabled: orderIds.length > 0, queryFn: () => q<Pkg[]>(supabase.from("package_labels").select("id, label, order_id, gw_kg, cbm, status").in("order_id", orderIds).order("label")) });
  const allPk = useQuery({ queryKey: ["pkgs-in-lists"], queryFn: () => q<{ package_id: string; picking_list_id: string; picking_lists: { status: string; code: string } | null }[]>(supabase.from("picking_list_packages").select("package_id, picking_list_id, picking_lists(status, code)")) });
  // Mặc định chọn tất cả kiện của các đơn trong list (mỗi bộ đơn chỉ tự chọn 1 lần, bỏ chọn tay vẫn giữ)
  const autoKey = useRef("");
  useEffect(() => {
    const key = orderIds.join(",");
    if (!key || autoKey.current === key || tot.data?.status !== "nhap" || !pkgs.data || !allPk.data || !myPk.data) return;
    autoKey.current = key;
    const have = new Set(myPk.data.map((x) => x.package_id));
    const rows = pkgs.data.filter((p) => !have.has(p.id) && !allPk.data!.some((x) => x.package_id === p.id && x.picking_list_id !== id && x.picking_lists?.status !== "huy")).map((p) => ({ picking_list_id: id, package_id: p.id }));
    if (rows.length) supabase.from("picking_list_packages").insert(rows).then(() => { qc.invalidateQueries({ queryKey: ["pl-pkgs"] }); qc.invalidateQueries({ queryKey: ["pl"] }); qc.invalidateQueries({ queryKey: ["pkgs-in-lists"] }); });
  }, [orderIds, pkgs.data, allPk.data, myPk.data, tot.data?.status, id, qc]);

  if (tot.isLoading) return <Skeleton rows={8} />;
  const t = tot.data;
  if (!t) return <Empty title="Không tìm thấy list bốc" />;
  const editable = t.status === "nhap" && s.can("logistics.write");
  const used = (itemId: string) => (loaded.data ?? []).filter((l) => l.order_item_id === itemId && l.picking_lists?.status !== "huy").reduce((a, l) => a + Number(l.qty), 0);
  const refresh = () => ["pl", "pl-items", "pl-pkgs", "loaded-qty", "pkgs-in-lists", "picking-lists"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const inList = new Set((myPk.data ?? []).map((x) => x.package_id));
  const addAll = async () => {
    const rows = (pkgs.data ?? []).filter((p) => !inList.has(p.id) && !takenElsewhere(p.id)).map((p) => ({ picking_list_id: id, package_id: p.id }));
    if (rows.length) { const { error } = await supabase.from("picking_list_packages").insert(rows); if (error) alert(viError(error)); refresh(); }
  };
  const takenElsewhere = (pid: string) => (allPk.data ?? []).find((x) => x.package_id === pid && x.picking_list_id !== id && x.picking_lists?.status !== "huy")?.picking_lists?.code;
  const candidates = (avail.data ?? []).filter((a) => Number(a.qty) - used(a.id) > 0 && !(mine.data ?? []).some((m) => m.order_item_id === a.id));

  return (
    <>
      <PageHeader eyebrow="Vận chuyển · List bốc" title={t.code} desc={t.status === "nhap" ? "Đang lập – thêm dòng hàng và kiện" : "Đã chốt theo list xe – không sửa được"}
        actions={<LinkButton href="/list-boc/" variant="secondary">← List bốc</LinkButton>} />
      <div className="card sticky top-14 z-10 mb-5 grid grid-cols-3 gap-3 p-4 sm:grid-cols-6 lg:top-2">
        {[["Đơn", t.orders], ["Dòng", mine.data?.length ?? 0], ["Kiện", t.packages], ["GW kg", fmtNumber(t.gw_kg)], ["CBM", fmtNumber(t.cbm)], ["Trị giá tệ", fmtNumber(t.value_cny)]].map(([l, v]) => (
          <div key={l as string}><div className="text-[12.5px] text-muted">{l}</div><div className="font-mono text-lg font-semibold">{v}</div></div>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="space-y-5">
          <Card title="Dòng hàng trong list">
            {(mine.data ?? []).length === 0 ? <p className="text-sm text-muted">Chưa có dòng nào.</p> : (
              <ul className="space-y-1.5 text-sm">{(mine.data ?? []).map((m) => { const a = itemMap.get(m.order_item_id); return (
                <li key={m.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                  <div><span className="font-mono text-xs text-brand-strong">{a?.orders?.code}·{a?.line_no}</span> {a?.declared_name_vi} <span className="text-xs text-muted">HS {a?.hs_code}</span></div>
                  <div className="flex items-center gap-2"><span className="font-mono">{fmtNumber(m.qty)} {a?.uom}</span>
                    {editable ? <ActionButton variant="danger" onClick={async () => { await q(supabase.from("picking_list_items").delete().eq("id", m.id)); refresh(); }}>Bỏ</ActionButton> : null}</div>
                </li>); })}</ul>
            )}
          </Card>
          <Card title="Kiện trong list" actions={editable && orderIds.length ? <div className="flex gap-3 text-sm">
            <button className="font-semibold text-brand-strong" onClick={() => addAll()}>Chọn tất cả</button>
            <button className="text-muted" onClick={async () => { await supabase.from("picking_list_packages").delete().eq("picking_list_id", id); refresh(); }}>Bỏ chọn tất cả</button></div> : null}>
            {orderIds.length === 0 ? <p className="text-sm text-muted">Thêm dòng hàng trước, kiện của các đơn đó sẽ hiện ở đây.</p> : (
              <ul className="grid gap-1.5 sm:grid-cols-2">{(pkgs.data ?? []).map((p) => { const other = takenElsewhere(p.id); const on = inList.has(p.id); return (
                <li key={p.id}><label className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${on ? "border-brand bg-brand-soft" : "border-line"} ${other ? "opacity-50" : ""}`}>
                  <span className="flex items-center gap-2"><input type="checkbox" disabled={!editable || !!other} checked={on} onChange={async (e) => {
                    const r = e.target.checked ? await supabase.from("picking_list_packages").insert({ picking_list_id: id, package_id: p.id })
                      : await supabase.from("picking_list_packages").delete().eq("picking_list_id", id).eq("package_id", p.id);
                    if (r.error) alert(viError(r.error)); refresh();
                  }} className="h-4 w-4" /><span className="font-mono">{p.label}</span></span>
                  <span className="text-xs text-muted">{other ? `ở ${other}` : `${fmtNumber(p.gw_kg)} kg`}</span>
                </label></li>); })}</ul>
            )}
          </Card>
          {editable ? (
            <Card title="Gắn vào list xe">
              <select defaultValue={t.trip_id ?? ""} onChange={async (e) => { const { error } = await supabase.from("picking_lists").update({ trip_id: e.target.value || null }).eq("id", id); if (error) alert(viError(error)); refresh(); }} className={inputCls}>
                <option value="">— Chưa gắn xe —</option>{(trips.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.code} {x.plate ? `· ${x.plate}` : ""}</option>)}
              </select>
            </Card>
          ) : null}
        </div>
        {editable ? (
          <Card title="Dòng hàng đã xác nhận còn chưa bốc">
            {candidates.length === 0 ? <Empty title="Không còn dòng nào" desc="Chỉ dòng đã XNK xác nhận mới bốc được." /> : (
              <ul className="space-y-1.5">{candidates.map((a) => { const remain = Number(a.qty) - used(a.id); return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                  <div className="min-w-0"><span className="font-mono text-xs text-brand-strong">{a.orders?.code}·{a.line_no}</span> {a.declared_name_vi}<div className="text-xs text-muted">HS {a.hs_code} · còn {fmtNumber(remain)}/{fmtNumber(a.qty)} {a.uom}</div></div>
                  <div className="flex items-center gap-1.5">
                    <input value={pickQty[a.id] ?? String(remain)} onChange={(e) => setPickQty({ ...pickQty, [a.id]: e.target.value })} className={inputCls + " h-8 w-24 font-mono text-xs"} inputMode="decimal" />
                    <ActionButton variant="primary" onClick={async () => { await q(supabase.from("picking_list_items").insert({ picking_list_id: id, order_item_id: a.id, qty: Number((pickQty[a.id] ?? String(remain)).replace(",", ".")) })); refresh(); }}>Thêm</ActionButton>
                  </div>
                </li>); })}</ul>
            )}
          </Card>
        ) : <Card title="Trạng thái"><Badge tone="ok">Đã chốt theo list xe</Badge></Card>}
      </div>
    </>
  );
}

export default function Page() { return <Suspense fallback={<Skeleton rows={8} />}><Detail /></Suspense>; }
