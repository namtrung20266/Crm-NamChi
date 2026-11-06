"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { useCustomers, useEntities } from "@/lib/data";
import { PageHeader, Card, Badge, Empty, Field, inputCls, Skeleton, btn } from "@/components/ui";
import { Form, Submit, ActionButton } from "@/components/ui/form";
import { fmtNumber, fmtDate, vnd } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";
import { viError } from "@/lib/errors";

type Stock = { order_item_id: string; order_id: string; entity_id: string; customer_id: string; line_no: number; declared_name_vi: string; uom: string; qty: number; purchased_qty: number; sold_qty: number; hh_code: string | null; vat_rate: number | null; compliance_ok: boolean; compliance_status: string };
type SI = { id: string; draft_code: string; customer_id: string; entity_id: string; batch_label: string | null; invoice_no: string | null; invoice_date: string | null; payment_method: string; status: string; row_version: number };
type SIL = { id: string; sales_invoice_id: string; order_item_id: string; hh_code: string | null; description: string; uom: string; qty: number; unit_price_vnd: number; amount_vnd: number; vat_rate: number; vat_vnd: number };
const SI_STATUS = { nhap: ["Nháp", "warn"], da_xuat_file: ["Đã xuất file MISA", "info"], da_phat_hanh: ["Đã phát hành", "ok"], huy: ["Hủy", "danger"] } as const;

export default function InvoicesPage() {
  const s = useSession();
  const [tab, setTab] = useState<"ton" | "vao" | "ra">("ton");
  if (!s.isStaff || !s.can("finance.read")) return <Empty title="Bạn không có quyền xem hóa đơn" />;
  return (
    <>
      <PageHeader eyebrow="Tài chính" title="Hóa đơn" desc="HĐ đầu vào theo Mã HH → HĐ bán nhiều đợt (L1, L2…). Không xuất vượt HĐ đầu vào; dòng chưa xong hợp quy/kiểm tra bị khóa." />
      <div className="mb-4 inline-flex rounded-xl border border-line bg-white p-1">
        {([["ton", "Tồn hóa đơn"], ["vao", "HĐ đầu vào"], ["ra", "HĐ bán"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`h-9 rounded-lg px-4 text-sm font-semibold transition ${tab === k ? "bg-brand text-white" : "text-muted hover:text-ink"}`}>{l}</button>
        ))}
      </div>
      {tab === "ton" ? <StockTab /> : tab === "vao" ? <PurchaseTab /> : <SalesTab />}
    </>
  );
}

function useStock() {
  return useQuery({ queryKey: ["invoice-stock"], queryFn: () => q<Stock[]>(supabase.from("invoice_stock").select("*").order("order_id").order("line_no")) });
}

function StockTab() {
  const stock = useStock();
  const [only, setOnly] = useState(true);
  const R = (stock.data ?? []).filter((r) => !only || Number(r.purchased_qty) - Number(r.sold_qty) > 0 || !r.compliance_ok);
  return (
    <Card>
      <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} className="h-4 w-4" /> Chỉ dòng còn tồn hoặc đang chờ hồ sơ</label>
      {stock.isLoading ? <Skeleton /> : R.length === 0 ? <Empty title="Không còn tồn" /> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
          <thead><tr className="border-b border-line text-left text-xs uppercase text-muted"><th className="py-2">Mã HH</th><th>Tên hàng</th><th className="text-right">SL đơn</th><th className="text-right">HĐ vào</th><th className="text-right">Đã xuất</th><th className="text-right">Tồn</th><th>Điều kiện</th></tr></thead>
          <tbody>{R.map((r) => (
            <tr key={r.order_item_id} className="border-b border-line/70">
              <td className="py-2 font-mono text-xs">{r.hh_code ?? "—"}</td><td>#{r.line_no} {r.declared_name_vi}</td>
              <td className="text-right font-mono">{fmtNumber(r.qty)}</td><td className="text-right font-mono">{fmtNumber(r.purchased_qty)}</td>
              <td className="text-right font-mono">{fmtNumber(r.sold_qty)}</td><td className="text-right font-mono font-semibold">{fmtNumber(Number(r.purchased_qty) - Number(r.sold_qty))}</td>
              <td>{r.compliance_ok ? (Number(r.purchased_qty) > 0 ? <Badge tone="ok">Đủ điều kiện</Badge> : <Badge>Chưa có HĐ vào</Badge>) : <Badge tone="danger">Chờ hồ sơ chuyên ngành</Badge>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

function PurchaseTab() {
  const s = useSession();
  const qc = useQueryClient();
  const parties = useQuery({ queryKey: ["parties-importer"], queryFn: () => q<{ id: string; code: string }[]>(supabase.from("trade_parties").select("id, code").eq("party_role", "importer")) });
  const pis = useQuery({ queryKey: ["pis"], queryFn: () => q<{ id: string; invoice_no: string; invoice_date: string; seller_id: string }[]>(supabase.from("purchase_invoices").select("id, invoice_no, invoice_date, seller_id").order("invoice_date", { ascending: false }).limit(100)) });
  const pil = useQuery({ queryKey: ["pil"], queryFn: () => q<{ id: string; purchase_invoice_id: string; hh_code: string | null; description: string; qty: number; amount_vnd: number; vat_rate: number }[]>(supabase.from("purchase_invoice_lines").select("id, purchase_invoice_id, hh_code, description, qty, amount_vnd, vat_rate")) });
  const items = useQuery({ queryKey: ["items-confirmed"], queryFn: () => q<{ id: string; line_no: number; declared_name_vi: string; uom: string; qty: number; orders: { code: string } | null }[]>(supabase.from("order_items").select("id, line_no, declared_name_vi, uom, qty, orders(code)").eq("status", "da_xac_nhan").order("created_at", { ascending: false }).limit(500)) });
  const [open, setOpen] = useState<string | null>(null);
  const write = s.can("invoice.write");
  const seller = (id: string) => parties.data?.find((p) => p.id === id)?.code ?? "";
  return (
    <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
      <Card title="HĐ đầu vào">
        {(pis.data ?? []).length === 0 ? <Empty title="Chưa có HĐ đầu vào" /> : (
          <ul className="space-y-2">{(pis.data ?? []).map((p) => { const L = (pil.data ?? []).filter((l) => l.purchase_invoice_id === p.id); return (
            <li key={p.id} className="rounded-xl border border-line p-3.5">
              <div className="flex justify-between"><span><span className="font-mono font-semibold">{seller(p.seller_id)} · {p.invoice_no}</span> <span className="text-xs text-muted">{fmtDate(p.invoice_date)}</span></span><span className="font-mono text-sm">{vnd(L.reduce((a, l) => a + Number(l.amount_vnd), 0))}</span></div>
              <ul className="mt-1 text-xs text-muted">{L.map((l) => <li key={l.id}>{l.hh_code ?? "—"} · {l.description} · {fmtNumber(l.qty)} · VAT {fmtNumber(l.vat_rate)}%</li>)}</ul>
              {write ? (open === p.id ? (
                <Form className="mt-3 grid gap-2 rounded-lg bg-surface p-3 sm:grid-cols-6" resetOnOk invalidate={[["pil"], ["invoice-stock"]]} onSubmit={async (f) => {
                  const it = items.data?.find((i) => i.id === f.get("item"));
                  const n = (k: string) => Number(String(f.get(k) ?? "").replace(/\s/g, "").replace(",", ".") || 0);
                  if (!it) return { error: "Chọn dòng hàng" };
                  const amount = Math.round(n("qty") * n("price")); const rate = n("vat");
                  const { error } = await supabase.from("purchase_invoice_lines").insert({ purchase_invoice_id: p.id, order_item_id: it.id, hh_code: String(f.get("hh") ?? "") || null, description: it.declared_name_vi, uom: it.uom, qty: n("qty"), unit_price_vnd: n("price"), amount_vnd: amount, vat_rate: rate, vat_vnd: Math.round(amount * rate / 100) });
                  return error ? { error: viError(error) } : { ok: true };
                }}>
                  <div className="sm:col-span-2"><Field label="Dòng hàng"><select name="item" className={inputCls}>{(items.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.orders?.code}·{i.line_no} {i.declared_name_vi}</option>)}</select></Field></div>
                  <Field label="Mã HH"><input name="hh" className={inputCls + " font-mono"} /></Field>
                  <Field label="SL"><input name="qty" className={inputCls + " font-mono"} /></Field>
                  <Field label="Đơn giá (đ)"><input name="price" className={inputCls + " font-mono"} /></Field>
                  <Field label="VAT %"><input name="vat" defaultValue={8} className={inputCls + " font-mono"} /></Field>
                  <div className="flex justify-end gap-2 sm:col-span-6"><button type="button" onClick={() => setOpen(null)} className="text-sm text-muted">Đóng</button><Submit>Thêm dòng</Submit></div>
                </Form>
              ) : <button onClick={() => setOpen(p.id)} className="mt-2 text-sm font-semibold text-brand-strong">+ Thêm dòng</button>) : null}
            </li>); })}</ul>
        )}
      </Card>
      {write ? (
        <Card title="Nhập HĐ đầu vào">
          <Form resetOnOk invalidate={[["pis"]]} onSubmit={async (f) => {
            const { error } = await supabase.from("purchase_invoices").insert({ seller_id: f.get("seller"), invoice_no: String(f.get("no") ?? "").trim(), invoice_date: f.get("date") });
            if (error) return { error: viError(error) };
            qc.invalidateQueries({ queryKey: ["pis"] });
            return { ok: true, message: "Đã tạo. Bấm “Thêm dòng” để nhập từng Mã HH." };
          }}>
            <Field label="Bên bán (đơn vị nhập khẩu)"><select name="seller" className={inputCls}>{(parties.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
            <Field label="Số hóa đơn"><input name="no" required className={inputCls + " font-mono"} /></Field>
            <Field label="Ngày hóa đơn"><input name="date" type="date" required className={inputCls} /></Field>
            <div className="flex justify-end"><Submit>Tạo HĐ đầu vào</Submit></div>
          </Form>
        </Card>
      ) : null}
    </div>
  );
}

function SalesTab() {
  const s = useSession();
  const customers = useCustomers();
  const [cust, setCust] = useState("");
  const ents = useEntities(cust || null);
  const allEnts = useEntities(null);
  const stock = useStock();
  const sis = useQuery({ queryKey: ["sis"], queryFn: () => q<SI[]>(supabase.from("sales_invoices").select("*").order("created_at", { ascending: false }).limit(100)) });
  const sil = useQuery({ queryKey: ["sil"], queryFn: () => q<SIL[]>(supabase.from("sales_invoice_lines").select("*")) });
  const [open, setOpen] = useState<string | null>(null);
  const write = s.can("invoice.write");
  const ent = (id: string) => allEnts.data?.find((e) => e.id === id);

  const exportMisa = async (si: SI, L: SIL[]) => {
    const e = ent(si.entity_id);
    downloadCsv(`MISA-${si.draft_code}.csv`,
      ["Số thứ tự hóa đơn (*)", "Tên đơn vị mua hàng", "Địa chỉ", "Mã số thuế", "Email", "Hình thức thanh toán", "Mã HH", "Tên hàng hóa/dịch vụ (*)", "ĐVT", "Số lượng", "Đơn giá", "Thành tiền", "Thuế suất GTGT (%)", "Tiền thuế GTGT"],
      L.map(() => null).map((_, i) => { const l = L[i]; return [1, e?.legal_name, e?.invoice_address, e?.tax_code, e?.invoice_email, si.payment_method, l.hh_code, l.description, l.uom, l.qty, l.unit_price_vnd, l.amount_vnd, l.vat_rate, l.vat_vnd]; }));
    if (si.status === "nhap") { await supabase.from("sales_invoices").update({ status: "da_xuat_file", row_version: si.row_version }).eq("id", si.id); sis.refetch(); }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
      <Card title="HĐ bán">
        {sis.isLoading ? <Skeleton /> : (sis.data ?? []).length === 0 ? <Empty title="Chưa có HĐ bán" /> : (
          <ul className="space-y-3">{(sis.data ?? []).map((si) => {
            const L = (sil.data ?? []).filter((l) => l.sales_invoice_id === si.id);
            const total = L.reduce((a, l) => a + Number(l.amount_vnd) + Number(l.vat_vnd), 0);
            const avail = (stock.data ?? []).filter((r) => r.entity_id === si.entity_id && r.compliance_ok && Number(r.purchased_qty) - Number(r.sold_qty) > 0);
            const st = SI_STATUS[si.status as keyof typeof SI_STATUS];
            return (
              <li key={si.id} className="rounded-xl border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><span className="font-mono font-semibold">{si.invoice_no ? `HĐ ${si.invoice_no}` : si.draft_code}</span> <span className="text-sm text-muted">· {ent(si.entity_id)?.legal_name} {si.batch_label ? `· ${si.batch_label}` : ""} {si.invoice_date ? `· ${fmtDate(si.invoice_date)}` : ""}</span></div>
                  <div className="flex items-center gap-2"><span className="font-mono text-sm font-semibold">{vnd(total)}</span><Badge tone={st[1]}>{st[0]}</Badge></div>
                </div>
                <ul className="mt-2 space-y-0.5 text-xs text-muted">{L.map((l) => <li key={l.id}>{l.hh_code ?? "—"} · {l.description} · {fmtNumber(l.qty)} × {fmtNumber(l.unit_price_vnd)} = {fmtNumber(l.amount_vnd)} · VAT {fmtNumber(l.vat_rate)}%</li>)}</ul>
                {write && si.status !== "huy" && si.status !== "da_phat_hanh" ? (
                  <div className="mt-3 space-y-2 border-t border-line pt-3">
                    {si.status === "nhap" ? (open === si.id ? (
                      <Form className="grid gap-2 rounded-lg bg-surface p-3 sm:grid-cols-5" resetOnOk invalidate={[["sil"], ["invoice-stock"]]} onSubmit={async (f) => {
                        const r = avail.find((x) => x.order_item_id === f.get("item"));
                        if (!r) return { error: "Chọn dòng còn tồn đủ điều kiện" };
                        const n = (k: string) => Number(String(f.get(k) ?? "").replace(/\s/g, "").replace(",", ".") || 0);
                        const amount = Math.round(n("qty") * n("price")); const rate = n("vat");
                        const { error } = await supabase.from("sales_invoice_lines").insert({ sales_invoice_id: si.id, order_item_id: r.order_item_id, hh_code: r.hh_code, description: r.declared_name_vi, uom: r.uom, qty: n("qty"), unit_price_vnd: n("price"), amount_vnd: amount, vat_rate: rate, vat_vnd: Math.round(amount * rate / 100), customer_id: si.customer_id, entity_id: si.entity_id });
                        return error ? { error: viError(error) } : { ok: true };
                      }}>
                        <div className="sm:col-span-2"><Field label="Dòng còn tồn"><select name="item" className={inputCls}>{avail.map((r) => <option key={r.order_item_id} value={r.order_item_id}>{r.hh_code ?? "—"} · {r.declared_name_vi} · tồn {fmtNumber(Number(r.purchased_qty) - Number(r.sold_qty))}</option>)}</select></Field></div>
                        <Field label="SL"><input name="qty" className={inputCls + " font-mono"} /></Field>
                        <Field label="Đơn giá (đ)"><input name="price" className={inputCls + " font-mono"} /></Field>
                        <Field label="VAT %"><input name="vat" defaultValue={8} className={inputCls + " font-mono"} /></Field>
                        <div className="flex justify-end gap-2 sm:col-span-5"><button type="button" onClick={() => setOpen(null)} className="text-sm text-muted">Đóng</button><Submit>Thêm dòng</Submit></div>
                      </Form>
                    ) : <button onClick={() => setOpen(si.id)} className="text-sm font-semibold text-brand-strong">+ Thêm dòng từ tồn</button>) : null}
                    <div className="flex flex-wrap items-end justify-end gap-2">
                      {L.length ? <button onClick={() => exportMisa(si, L)} className={btn.secondary + " h-8 px-3 text-xs"}>Xuất file MISA</button> : null}
                      <form className="flex items-end gap-2" onSubmit={async (e) => {
                        e.preventDefault(); const f = new FormData(e.currentTarget);
                        const { error } = await supabase.from("sales_invoices").update({ status: "da_phat_hanh", invoice_no: String(f.get("no") ?? "").trim() || null, invoice_date: f.get("date") || null, row_version: si.row_version }).eq("id", si.id);
                        if (error) alert(viError(error)); sis.refetch();
                      }}>
                        <input name="no" placeholder="Số HĐ MISA" className={inputCls + " h-8 w-28 text-xs"} />
                        <input name="date" type="date" className={inputCls + " h-8 w-36 text-xs"} />
                        <button className={btn.primary + " h-8 px-3 text-xs"}>Đã phát hành</button>
                      </form>
                      <ActionButton variant="danger" confirmText="Hủy hóa đơn nháp này?" invalidate={[["sis"], ["invoice-stock"]]} onClick={() => q(supabase.from("sales_invoices").update({ status: "huy", row_version: si.row_version }).eq("id", si.id))}>Hủy</ActionButton>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}</ul>
        )}
      </Card>
      {write ? (
        <Card title="Tạo HĐ bán (một đợt)">
          <Form resetOnOk invalidate={[["sis"]]} onSubmit={async (f) => {
            if (!cust || !f.get("entity")) return { error: "Chọn khách và công ty nhận HĐ" };
            const { error } = await supabase.from("sales_invoices").insert({ customer_id: cust, entity_id: f.get("entity"), batch_label: String(f.get("batch") ?? "") || null, payment_method: String(f.get("pm") ?? "TM/CK") });
            return error ? { error: viError(error) } : { ok: true, message: "Đã tạo HĐ nháp. Thêm dòng từ tồn." };
          }}>
            <Field label="Khách hàng"><select value={cust} onChange={(e) => setCust(e.target.value)} className={inputCls}><option value="">Chọn…</option>{(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>
            <Field label="Công ty nhận HĐ"><select name="entity" className={inputCls}>{(ents.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}</select></Field>
            <div className="grid grid-cols-2 gap-3"><Field label="Đợt (L1, L2…)"><input name="batch" className={inputCls} /></Field><Field label="Hình thức TT"><input name="pm" defaultValue="TM/CK" className={inputCls} /></Field></div>
            <div className="flex justify-end"><Submit>Tạo HĐ nháp</Submit></div>
          </Form>
        </Card>
      ) : null}
    </div>
  );
}
