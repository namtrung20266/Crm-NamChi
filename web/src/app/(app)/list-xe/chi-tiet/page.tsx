"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { TRIP_STATUS } from "@/lib/status";
import { PageHeader, Card, Badge, Empty, Field, inputCls, LinkButton, Skeleton, btn } from "@/components/ui";
import { Form, Submit, ActionButton } from "@/components/ui/form";
import { fmtNumber, fmtDateTime } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";
import { viError } from "@/lib/errors";
import type { PLT } from "../../list-boc/page";

type Trip = { id: string; code: string; plate: string | null; border_gate: string; importer_id: string | null; exporter_id: string | null; planned_date: string | null; actual_date: string | null; status: string; declaration_no: string | null; note: string | null; row_version: number };
type Line = { order_code: string; customer_code: string; entity: string; line_no: number; declared_name_vi: string; declared_name_en: string | null; name_cn: string | null; model: string | null; hs_code: string; uom: string; qty: number; unit_price_cny: number; value_cny: number; origin: string; manufacturer: string | null; compliance_need: string; picking_list: string };
type Snap = { id: string; version: number; status: string; reason: string | null; lines: Line[]; totals: Record<string, unknown>; content_hash: string; created_at: string };
const GATE: Record<string, string> = { huu_nghi: "Hữu Nghị", tan_thanh: "Tân Thanh", mong_cai: "Móng Cái", khac: "Khác" };

function Detail() {
  const id = useSearchParams().get("id") ?? "";
  const s = useSession();
  const qc = useQueryClient();
  const trip = useQuery({ queryKey: ["trip", id], queryFn: () => q<Trip | null>(supabase.from("trips").select("*").eq("id", id).maybeSingle()) });
  const lists = useQuery({ queryKey: ["trip-lists", id], queryFn: () => q<PLT[]>(supabase.from("picking_list_totals").select("*").eq("trip_id", id)) });
  const snaps = useQuery({ queryKey: ["snaps", id], queryFn: () => q<Snap[]>(supabase.from("declaration_snapshots").select("*").eq("trip_id", id).order("version", { ascending: false })) });
  const parties = useQuery({ queryKey: ["parties"], queryFn: () => q<{ id: string; code: string; party_role: string; legal_name: string }[]>(supabase.from("trade_parties").select("id, code, party_role, legal_name").order("code")) });
  const pkgs = useQuery({ queryKey: ["trip-pkgs", id], queryFn: async () => {
    const pls = await q<{ id: string }[]>(supabase.from("picking_lists").select("id").eq("trip_id", id).neq("status", "huy"));
    if (!pls.length) return [];
    const links = await q<{ package_id: string }[]>(supabase.from("picking_list_packages").select("package_id").in("picking_list_id", pls.map((x) => x.id)));
    if (!links.length) return [];
    return q<{ id: string; label: string; order_code: string; gw_kg: number; length_cm: number; width_cm: number; height_cm: number; cbm: number }[]>(
      supabase.from("package_labels").select("id, label, order_code, gw_kg, length_cm, width_cm, height_cm, cbm").in("id", links.map((l) => l.package_id)).order("label"));
  } });

  if (trip.isLoading) return <Skeleton rows={8} />;
  const t = trip.data;
  if (!t) return <Empty title="Không tìm thấy chuyến xe" />;
  const write = s.can("logistics.write");
  const active = (snaps.data ?? []).find((x) => x.status === "locked");
  const refresh = () => ["trip", "trip-lists", "snaps", "trips", "picking-lists"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const sum = (k: keyof PLT) => (lists.data ?? []).reduce((a, l) => a + Number(l[k] ?? 0), 0);
  const fname = (kind: string) => `${t.code}-v${active?.version}-${kind}.csv`;

  const exportDeclaration = () => active && downloadCsv(fname("khai-bao"),
    ["STT", "Mã đơn", "Khách", "Công ty nhận HĐ", "Tên khai báo", "Tên tiếng Anh", "Tên tiếng Trung", "Model", "Mã HS", "ĐVT", "Số lượng", "Đơn giá (CNY)", "Trị giá (CNY)", "Xuất xứ", "Nhà sản xuất", "Chuyên ngành", "List bốc"],
    active.lines.map((l, i) => [i + 1, l.order_code, l.customer_code, l.entity, l.declared_name_vi, l.declared_name_en, l.name_cn, l.model, l.hs_code, l.uom, l.qty, l.unit_price_cny, l.value_cny, l.origin, l.manufacturer, l.compliance_need, l.picking_list]));
  const exportInvoice = () => {
    if (!active) return;
    const g = new Map<string, { name: string; en: string | null; hs: string; uom: string; qty: number; value: number }>();
    for (const l of active.lines) {
      const k = [l.declared_name_vi, l.hs_code, l.uom, l.unit_price_cny].join("|");
      const x = g.get(k) ?? { name: l.declared_name_vi, en: l.declared_name_en, hs: l.hs_code, uom: l.uom, qty: 0, value: 0 };
      x.qty += Number(l.qty); x.value += Number(l.value_cny); g.set(k, x);
    }
    downloadCsv(fname("invoice"), ["STT", "Description (VN)", "Description (EN)", "HS Code", "Unit", "Quantity", "Unit price (CNY)", "Amount (CNY)"],
      [...g.values()].map((x, i) => [i + 1, x.name, x.en, x.hs, x.uom, x.qty, x.qty ? Math.round((x.value / x.qty) * 10000) / 10000 : 0, Math.round(x.value * 100) / 100]));
  };
  const exportPacking = () => downloadCsv(fname("packing-list"), ["STT", "Mã kiện", "Mã đơn", "GW (kg)", "D (cm)", "R (cm)", "C (cm)", "CBM"],
    (pkgs.data ?? []).map((p, i) => [i + 1, p.label, p.order_code, p.gw_kg, p.length_cm, p.width_cm, p.height_cm, p.cbm]));

  return (
    <>
      <PageHeader eyebrow="Vận chuyển · List xe" title={t.code} desc={`${t.plate ?? "Chưa có biển số"} · cửa khẩu ${GATE[t.border_gate]}`}
        actions={<><Badge tone={TRIP_STATUS[t.status]?.tone}>{TRIP_STATUS[t.status]?.label}</Badge><LinkButton href="/list-xe/" variant="secondary">← List xe</LinkButton></>} />
      <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[["List bốc", lists.data?.length ?? 0], ["Đơn", sum("orders")], ["Kiện", sum("packages")], ["GW kg", fmtNumber(sum("gw_kg"))], ["Trị giá tệ", fmtNumber(sum("value_cny"))]].map(([l, v]) => (
          <div key={l as string} className="card p-4"><div className="text-xs text-muted">{l}</div><div className="mt-1 font-mono text-xl font-semibold">{v}</div></div>
        ))}
      </section>
      <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          <Card title="Bộ dữ liệu chốt & chứng từ" actions={active ? <span className="font-mono text-[11px] text-muted">v{active.version} · {active.content_hash.slice(0, 10)}</span> : null}>
            {!active ? <Empty title="Chưa chốt" desc="Gắn list bốc vào xe rồi bấm Chốt list xe. Chứng từ chỉ xuất từ dữ liệu đã chốt." /> : (
              <>
                <p className="mb-3 text-sm text-muted">{active.lines.length} dòng · {fmtNumber(active.totals.qty as number)} SL · {fmtNumber(active.totals.value_cny as number)} tệ · {String(active.totals.packages)} kiện · {fmtNumber(active.totals.gw_kg as number)} kg — chốt {fmtDateTime(active.created_at)}</p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={exportDeclaration} className={btn.primary}>File khai báo (gửi APT)</button>
                  <button onClick={exportInvoice} className={btn.secondary}>Invoice (gộp dòng)</button>
                  <button onClick={exportPacking} className={btn.secondary}>Packing list</button>
                </div>
                <p className="mt-3 text-xs text-muted">Invoice, packing list và file khai báo cùng đọc một bộ dữ liệu chốt nên số lượng, trị giá luôn khớp nhau.</p>
              </>
            )}
            {s.can("customs.confirm") && (lists.data ?? []).length > 0 ? (
              <Form className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4" invalidate={[["snaps", id], ["trip", id], ["trip-lists", id]]} onSubmit={async (f) => {
                const { error } = await supabase.rpc("lock_trip", { p_trip_id: id, p_reason: String(f.get("reason") ?? "") || null });
                if (error) return { error: viError(error) };
                refresh();
                return { ok: true, message: "Đã chốt. List bốc trên xe bị khóa sửa." };
              }}>
                {active ? <div className="min-w-[240px] flex-1"><Field label="Lý do chốt lại (bắt buộc)"><input name="reason" className={inputCls} /></Field></div> : null}
                <Submit>{active ? "Chốt lại (tạo version mới)" : "Chốt list xe"}</Submit>
              </Form>
            ) : null}
          </Card>
          <Card title="List bốc trên xe">
            {(lists.data ?? []).length === 0 ? <p className="text-sm text-muted">Chưa có list bốc. Mở list bốc và chọn “Gắn vào list xe”.</p> : (
              <ul className="space-y-1.5 text-sm">{(lists.data ?? []).map((l) => (
                <li key={l.id} className="flex justify-between rounded-lg border border-line px-3 py-2"><Link href={`/list-boc/chi-tiet/?id=${l.id}`} className="font-mono font-semibold text-brand-strong">{l.code}</Link>
                  <span className="text-xs text-muted">{l.orders} đơn · {l.packages} kiện · {fmtNumber(l.gw_kg)} kg · {fmtNumber(l.value_cny)} tệ</span></li>))}</ul>
            )}
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Thông tin chuyến xe">
            <Form invalidate={[["trip", id], ["trips"]]} onSubmit={async (f) => {
              const o = (k: string) => String(f.get(k) ?? "").trim() || null;
              const { error } = await supabase.from("trips").update({ plate: o("plate"), border_gate: f.get("border_gate"), importer_id: o("importer_id"), exporter_id: o("exporter_id"),
                planned_date: o("planned_date"), actual_date: o("actual_date"), declaration_no: o("declaration_no"), status: f.get("status"), note: o("note"), row_version: t.row_version }).eq("id", t.id);
              return error ? { error: viError(error) } : { ok: true, message: "Đã lưu." };
            }}>
              <fieldset disabled={!write} className="grid grid-cols-2 gap-3">
                <Field label="Biển số"><input name="plate" defaultValue={t.plate ?? ""} className={inputCls} /></Field>
                <Field label="Cửa khẩu"><select name="border_gate" defaultValue={t.border_gate} className={inputCls}>{Object.entries(GATE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Đứng tên nhập khẩu"><select name="importer_id" defaultValue={t.importer_id ?? ""} className={inputCls}><option value="">—</option>{(parties.data ?? []).filter((p) => p.party_role === "importer").map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
                <Field label="Người xuất khẩu"><select name="exporter_id" defaultValue={t.exporter_id ?? ""} className={inputCls}><option value="">—</option>{(parties.data ?? []).filter((p) => p.party_role === "exporter").map((p) => <option key={p.id} value={p.id}>{p.legal_name}</option>)}</select></Field>
                <Field label="Ngày dự kiến"><input name="planned_date" type="date" defaultValue={t.planned_date ?? ""} className={inputCls} /></Field>
                <Field label="Ngày thực tế"><input name="actual_date" type="date" defaultValue={t.actual_date ?? ""} className={inputCls} /></Field>
                <Field label="Số tờ khai"><input name="declaration_no" defaultValue={t.declaration_no ?? ""} className={inputCls + " font-mono"} /></Field>
                <Field label="Trạng thái"><select name="status" defaultValue={t.status} className={inputCls}>{Object.entries(TRIP_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
                <div className="col-span-2"><Field label="Ghi chú"><input name="note" defaultValue={t.note ?? ""} className={inputCls} /></Field></div>
              </fieldset>
              {write ? <div className="flex justify-end"><Submit>Lưu</Submit></div> : null}
            </Form>
          </Card>
          <Card title="Lịch sử chốt">
            {(snaps.data ?? []).length === 0 ? <p className="text-sm text-muted">Chưa có.</p> : (
              <ul className="space-y-1.5 text-sm">{(snaps.data ?? []).map((x) => (
                <li key={x.id} className="flex justify-between gap-2"><span>v{x.version} {x.status === "locked" ? <Badge tone="ok">Hiệu lực</Badge> : <Badge>Bị thay</Badge>}{x.reason ? <span className="text-xs text-muted"> · {x.reason}</span> : null}</span><span className="font-mono text-xs text-muted">{fmtDateTime(x.created_at)}</span></li>))}</ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

export default function Page() { return <Suspense fallback={<Skeleton rows={8} />}><Detail /></Suspense>; }
