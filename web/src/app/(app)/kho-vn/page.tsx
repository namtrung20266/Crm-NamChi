"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { PKG_STATUS, TRIP_STATUS } from "@/lib/status";
import { PageHeader, Card, Badge, Empty, inputCls, Skeleton, btn } from "@/components/ui";
import { viError } from "@/lib/errors";

type Check = { trip_id: string; order_id: string; order_code: string; entity: string; expected: number; received: number; missing: number; problem: number };
type Pkg = { id: string; label: string; order_id: string; status: string; row_version: number };

// Kiểm đếm 2 tầng, không cần máy quét: tầng 1 đếm tổng; lệch mới chạm từng ô kiện
export default function VnWarehouse() {
  const s = useSession();
  const [tripId, setTripId] = useState("");
  const [count, setCount] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const trips = useQuery({ queryKey: ["trips-incoming"], queryFn: () => q<{ id: string; code: string; plate: string | null; status: string }[]>(
    supabase.from("trips").select("id, code, plate, status").in("status", ["da_chot", "da_khai_bao", "thong_quan", "ve_vn"]).order("created_at", { ascending: false }).limit(50)) });
  const check = useQuery({ queryKey: ["trip-check", tripId], enabled: !!tripId, queryFn: () => q<Check[]>(supabase.from("trip_package_check").select("*").eq("trip_id", tripId)) });
  const pkgs = useQuery({ queryKey: ["trip-pkg-grid", tripId], enabled: !!tripId, queryFn: async () => {
    const pls = await q<{ id: string }[]>(supabase.from("picking_lists").select("id").eq("trip_id", tripId).neq("status", "huy"));
    if (!pls.length) return [];
    const links = await q<{ package_id: string }[]>(supabase.from("picking_list_packages").select("package_id").in("picking_list_id", pls.map((p) => p.id)));
    return links.length ? q<Pkg[]>(supabase.from("package_labels").select("id, label, order_id, status, row_version").in("id", links.map((l) => l.package_id)).order("label")) : [];
  } });
  if (!s.isStaff) return <Empty title="Trang nội bộ" />;
  const C = check.data ?? [];
  const expected = C.reduce((a, c) => a + c.expected, 0);
  const received = C.reduce((a, c) => a + c.received, 0);
  const setPkg = async (p: Pkg, status: string) => {
    const vn = status === "ve_vn" ? (await q<{ id: string }[]>(supabase.from("warehouses").select("id").eq("code", "VN")))[0]?.id : undefined;
    const { error } = await supabase.from("packages").update({ status, ...(vn ? { warehouse_id: vn } : {}), row_version: p.row_version }).eq("id", p.id);
    if (error) alert(viError(error));
    pkgs.refetch(); check.refetch();
  };

  return (
    <>
      <PageHeader eyebrow="Kho Việt Nam" title="Nhận xe & kiểm đếm" desc="Tầng 1: đếm tổng kiện cả xe – khớp là xong trong 1 phút. Lệch thì xuống tầng 2: chạm từng ô kiện theo số trên tem." />
      <Card>
        <div className="grid gap-3 sm:grid-cols-[1fr_200px_auto]">
          <select value={tripId} onChange={(e) => { setTripId(e.target.value); setMsg(null); }} className={inputCls}>
            <option value="">Chọn chuyến xe…</option>{(trips.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.code} · {t.plate ?? "—"} · {TRIP_STATUS[t.status]?.label}</option>)}
          </select>
          <input value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" placeholder="Tổng kiện đếm được" className={inputCls + " h-12 text-center font-mono text-lg"} disabled={!tripId} />
          <button disabled={!tripId || !count || !s.can("warehouse.write")} className={btn.primary + " h-12"} onClick={async () => {
            const { data, error } = await supabase.rpc("receive_trip", { p_trip_id: tripId, p_counted: Number(count) });
            if (error) return setMsg({ ok: false, text: viError(error) });
            const r = data as { ok: boolean; expected: number; counted: number; message?: string };
            setMsg(r.ok ? { ok: true, text: `Xe về đủ ${r.expected}/${r.expected} kiện. Đơn đã chuyển “Đã về kho VN”.` } : { ok: false, text: `Lệch: đếm ${r.counted}, list bốc ${r.expected}. Kiểm từng kiện bên dưới.` });
            check.refetch(); pkgs.refetch();
          }}>Xác nhận</button>
        </div>
        {msg ? <p className={`mt-3 rounded-lg border px-3 py-2 text-sm ${msg.ok ? "border-ok/30 bg-ok/5 text-ok" : "border-amber-300 bg-amber-50 text-amber-800"}`}>{msg.text}</p> : null}
      </Card>

      {tripId ? (
        <div className="mt-5 space-y-5">
          <section className="grid grid-cols-3 gap-3">
            {[["Kiện trên list bốc", expected], ["Đã nhận VN", received], ["Còn thiếu / vấn đề", expected - received]].map(([l, v]) => (
              <div key={l as string} className="card p-4 text-center"><div className="text-xs text-muted">{l}</div><div className={`mt-1 font-mono text-2xl font-semibold ${l === "Còn thiếu / vấn đề" && Number(v) > 0 ? "text-danger" : ""}`}>{v}</div></div>
            ))}
          </section>
          {s.can("warehouse.write") && expected > 0 && received < expected ? (
            <Card title="Chốt nhận xe khi có lệch">
              <form className="flex flex-wrap gap-2" onSubmit={async (e) => {
                e.preventDefault();
                const note = String(new FormData(e.currentTarget).get("note") ?? "");
                const { error } = await supabase.rpc("finish_trip_receipt", { p_trip_id: tripId, p_note: note });
                if (error) alert(viError(error)); else { setMsg({ ok: true, text: "Đã chốt nhận xe (có lệch). Kiện thiếu/hỏng nên tạo khiếu nại." }); check.refetch(); }
              }}>
                <input name="note" placeholder="VD: thiếu 1 kiện DH2611-0004-3/5, rách 1 kiện" className={inputCls + " min-w-[260px] flex-1"} />
                <button className={btn.danger}>Chốt nhận (lệch)</button>
              </form>
            </Card>
          ) : null}
          {check.isLoading || pkgs.isLoading ? <Skeleton rows={4} /> : C.map((c) => (
            <Card key={c.order_id} title={`${c.order_code} · ${c.entity}`} actions={<Badge tone={c.received === c.expected ? "ok" : "warn"}>{c.received}/{c.expected} kiện</Badge>}>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-8 lg:grid-cols-12">
                {(pkgs.data ?? []).filter((p) => p.order_id === c.order_id).map((p) => {
                  const ok = p.status === "ve_vn" || p.status === "da_giao";
                  const bad = ["thieu", "hong", "sai_hang"].includes(p.status);
                  return (
                    <div key={p.id} className="flex flex-col gap-1">
                      <button title={p.label} disabled={!s.can("warehouse.write")} onClick={() => setPkg(p, ok ? "tren_xe" : "ve_vn")}
                        className={`flex h-14 items-center justify-center rounded-xl border-2 font-mono text-sm font-bold transition ${ok ? "border-ok bg-ok/10 text-ok" : bad ? "border-danger bg-danger/10 text-danger" : "border-line bg-white text-ink hover:border-brand"}`}>
                        {p.label.split("-").pop()}
                      </button>
                      {s.can("warehouse.write") ? <select value={p.status} onChange={(e) => setPkg(p, e.target.value)} className="h-7 rounded-md border border-line text-[10px]">
                        {["tren_xe", "ve_vn", "thieu", "hong", "sai_hang"].map((k) => <option key={k} value={k}>{PKG_STATUS[k].label}</option>)}</select> : null}
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      ) : null}
    </>
  );
}
