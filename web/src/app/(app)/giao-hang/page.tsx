"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { useCustomers, useEntities } from "@/lib/data";
import { rpc } from "@/lib/meta";
import { PageHeader, Card, Badge, Empty, Field, inputCls, Skeleton, btn, usePaged } from "@/components/ui";
import { fmtDate, vnd } from "@/lib/format";
import { viError } from "@/lib/errors";

type Cand = { order_id: string; code: string; entity_id: string; entity_name: string; goods_desc: string | null; status: string; pkg_total: number; pkg_ready: number; pkg_delivered: number; remaining_vnd: number };
type DN = { id: string; code: string; entity_id: string; delivery_date: string; driver_name: string | null; vehicle_plate: string | null; receiver_name: string | null; status: string; created_at: string;
  customer_entities: { legal_name: string } | null; goods_issues: { packages: number; orders: { code: string } | null }[] };
const ST: Record<string, [string, "warn" | "info" | "ok" | "danger"]> = { nhap: ["Đang lập", "warn"], dang_giao: ["Đang giao", "info"], da_giao: ["Đã giao", "ok"], huy: ["Hủy", "danger"] };

// Giao hàng: lọc khách tổng/công ty con → chọn đơn, số kiện giao thực tế → lập phiếu giao (in cho lái xe ký)
export default function DeliveryPage() {
  const s = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const customers = useCustomers();
  const [cust, setCust] = useState("");
  const [ent, setEnt] = useState("");
  const ents = useEntities(cust || null);
  const cand = useQuery({ queryKey: ["delivery-cand", cust, ent], queryFn: () => rpc<Cand[]>("delivery_candidates", { p_customer_id: cust || null, p_entity_id: ent || null }) });
  const notes = useQuery({ queryKey: ["delivery-notes"], queryFn: () => q<DN[]>(supabase.from("delivery_notes").select("id, code, entity_id, delivery_date, driver_name, vehicle_plate, receiver_name, status, created_at, customer_entities(legal_name), goods_issues(packages, orders(code))").order("created_at", { ascending: false }).limit(500)) });
  const [pick, setPick] = useState<Record<string, number>>({});
  const [h, setH] = useState({ delivery_date: new Date().toISOString().slice(0, 10), driver_name: "", driver_phone: "", vehicle_plate: "", receiver_name: "", receiver_phone: "", address: "", note: "" });
  const [busy, setBusy] = useState(false);
  const C = cand.data ?? [];
  const chosen = C.filter((c) => pick[c.order_id] != null);
  const chosenEnt = [...new Set(chosen.map((c) => c.entity_id))];
  const np = usePaged(notes.data ?? []);
  const groups = useMemo(() => [...new Set(C.map((c) => c.entity_name))], [C]);
  const write = s.can("warehouse.write");
  const create = async () => {
    if (chosenEnt.length !== 1) { alert("Mỗi phiếu giao cho 1 công ty con. Chọn đơn cùng một công ty."); return; }
    setBusy(true);
    try {
      const id = await rpc<string>("create_delivery_note", { p_entity_id: chosenEnt[0], p_orders: chosen.map((c) => ({ order_id: c.order_id, packages: pick[c.order_id] })), p_header: h });
      setPick({}); qc.invalidateQueries({ queryKey: ["delivery-cand"] }); qc.invalidateQueries({ queryKey: ["delivery-notes"] });
      router.push(`/giao-hang/phieu/?id=${id}`);
    } catch (e) { alert(viError(e)); } finally { setBusy(false); }
  };
  if (!s.isStaff) return <Empty title="Trang nội bộ" />;
  return (
    <>
      <PageHeader eyebrow="Kho Việt Nam" title="Giao hàng" desc="Chọn khách → tích các đơn cần giao, sửa số kiện nếu giao thiếu → lập phiếu giao, in cho lái xe và người nhận ký." />
      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Card title="Đơn sẵn sàng giao (kiện đang ở kho VN)">
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <select value={cust} onChange={(e) => { setCust(e.target.value); setEnt(""); }} className={inputCls}><option value="">Mọi khách tổng</option>{(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
            <select value={ent} onChange={(e) => setEnt(e.target.value)} className={inputCls}><option value="">Mọi công ty con</option>{(ents.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}</select>
          </div>
          {cand.isLoading ? <Skeleton /> : C.length === 0 ? <Empty title="Không có đơn nào đang chờ giao" /> : groups.map((g) => (
            <div key={g} className="mb-4">
              <div className="mb-1.5 flex items-center justify-between"><b>{g}</b>
                <button className="text-sm font-semibold text-brand-strong" onClick={() => { const n = { ...pick }; C.filter((c) => c.entity_name === g).forEach((c) => (n[c.order_id] = c.pkg_ready)); setPick(n); }}>Chọn tất cả</button></div>
              <ul className="divide-y divide-line/70 rounded-xl border border-line">{C.filter((c) => c.entity_name === g).map((c) => (
                <li key={c.order_id} className={`flex flex-wrap items-center gap-3 px-3 py-2.5 ${pick[c.order_id] != null ? "bg-brand-soft/50" : ""}`}>
                  <input type="checkbox" checked={pick[c.order_id] != null} onChange={(e) => { const n = { ...pick }; if (e.target.checked) n[c.order_id] = c.pkg_ready; else delete n[c.order_id]; setPick(n); }} className="h-4 w-4" />
                  <div className="min-w-0 flex-1"><Link href={`/don-hang/chi-tiet/?id=${c.order_id}&tab=kien`} className="font-semibold text-brand-strong">{c.code}</Link> <span className="text-sm text-muted">· {c.goods_desc}</span>
                    <div className="text-[13px] text-muted">{c.pkg_ready} kiện ở kho VN · đã giao {c.pkg_delivered}/{c.pkg_total}{c.remaining_vnd > 0 ? <span className="text-danger"> · còn nợ {vnd(c.remaining_vnd)}</span> : null}</div></div>
                  {pick[c.order_id] != null ? <label className="flex items-center gap-1.5 text-sm">Giao <input type="number" min={1} max={c.pkg_ready} value={pick[c.order_id]} onChange={(e) => setPick({ ...pick, [c.order_id]: Math.max(1, Math.min(c.pkg_ready, Number(e.target.value) || 1)) })} className={inputCls + " h-9 w-20"} /> / {c.pkg_ready} kiện</label> : null}
                </li>))}</ul>
            </div>
          ))}
        </Card>
        {write ? (
          <Card title={`Lập phiếu giao (${chosen.length} đơn · ${chosen.reduce((a, c) => a + (pick[c.order_id] ?? 0), 0)} kiện)`}>
            {chosenEnt.length > 1 ? <p className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">Đang chọn đơn của {chosenEnt.length} công ty. Mỗi phiếu giao cho 1 công ty con.</p> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Ngày giao"><input type="date" value={h.delivery_date} onChange={(e) => setH({ ...h, delivery_date: e.target.value })} className={inputCls} /></Field>
              <Field label="Biển số xe"><input value={h.vehicle_plate} onChange={(e) => setH({ ...h, vehicle_plate: e.target.value })} className={inputCls} /></Field>
              <Field label="Lái xe"><input value={h.driver_name} onChange={(e) => setH({ ...h, driver_name: e.target.value })} className={inputCls} /></Field>
              <Field label="SĐT lái xe"><input value={h.driver_phone} onChange={(e) => setH({ ...h, driver_phone: e.target.value })} className={inputCls} /></Field>
              <Field label="Người nhận"><input value={h.receiver_name} onChange={(e) => setH({ ...h, receiver_name: e.target.value })} className={inputCls} /></Field>
              <Field label="SĐT người nhận"><input value={h.receiver_phone} onChange={(e) => setH({ ...h, receiver_phone: e.target.value })} className={inputCls} /></Field>
              <div className="sm:col-span-2"><Field label="Địa chỉ giao"><input value={h.address} onChange={(e) => setH({ ...h, address: e.target.value })} className={inputCls} /></Field></div>
              <div className="sm:col-span-2"><Field label="Ghi chú"><input value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} className={inputCls} /></Field></div>
            </div>
            <button disabled={!chosen.length || busy} onClick={create} className={btn.primary + " mt-4 w-full"}>{busy ? "Đang lập…" : "Lập phiếu giao & mở bản in"}</button>
          </Card>
        ) : null}
      </div>
      <Card title="Phiếu giao" className="mt-5">
        {notes.isLoading ? <Skeleton /> : (notes.data ?? []).length === 0 ? <Empty title="Chưa có phiếu giao" /> : (
          <>
            <ul className="divide-y divide-line/70">{np.view.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div><Link href={`/giao-hang/phieu/?id=${n.id}`} className="font-semibold text-brand-strong">{n.code}</Link> <span className="text-sm text-muted">· {n.customer_entities?.legal_name} · {fmtDate(n.delivery_date)} · {n.goods_issues.length} đơn · {n.goods_issues.reduce((a, g) => a + g.packages, 0)} kiện{n.driver_name ? ` · ${n.driver_name}` : ""}{n.vehicle_plate ? ` (${n.vehicle_plate})` : ""}</span>
                  <div className="text-[13px] text-muted">{n.goods_issues.map((g) => g.orders?.code).join(", ")}</div></div>
                <Badge tone={ST[n.status][1]}>{ST[n.status][0]}</Badge>
              </li>))}</ul>
            {np.pager}
          </>
        )}
      </Card>
    </>
  );
}
