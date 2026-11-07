"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { useCustomers } from "@/lib/data";
import { INVOICE_TYPE } from "@/lib/status";
import { useLookups, lookupLabel } from "@/lib/meta";
import { PageHeader, Card, Badge, Empty, Field, inputCls, Skeleton } from "@/components/ui";
import { Form, Submit, ActionButton } from "@/components/ui/form";
import { fmtDate, fmtNumber } from "@/lib/format";
import { viError } from "@/lib/errors";

type FT = { id: string; code: string; name: string; calc_method: string; visible_to_customer: boolean };
type Rule = { id: string; fee_type_id: string; customer_id: string | null; entity_id: string | null; china_invoice_type: string | null; goods_group: string | null; sell_rate: number; cost_rate: number | null; valid_from: string; valid_to: string | null; note: string | null };
const METHOD: Record<string, string> = { percent_goods: "% tiền hàng", percent_goods_after_tax: "% (tiền hàng + thuế TQ)", per_kg: "đ / kg tính phí", actual: "Theo thực tế (nhập tay)" };

export default function FeesPage() {
  const s = useSession();
  const customers = useCustomers();
  const groups = useLookups("goods_group");
  const ft = useQuery({ queryKey: ["fee-types"], queryFn: () => q<FT[]>(supabase.from("fee_types").select("id, code, name, calc_method, visible_to_customer").is("deleted_at", null).order("sort_order")) });
  const rules = useQuery({ queryKey: ["fee-rules"], queryFn: () => q<Rule[]>(supabase.from("fee_rules").select("*").order("valid_from", { ascending: false })) });
  const manage = s.can("fee.manage");
  const allEnts = useQuery({ queryKey: ["all-entities-fee"], queryFn: () => q<{ id: string; customer_id: string; legal_name: string }[]>(supabase.from("customer_entities").select("id, customer_id, legal_name").is("deleted_at", null).order("legal_name")) });
  const [entF, setEntF] = useState("");
  useEffect(() => { setEntF(new URLSearchParams(window.location.search).get("entity") ?? ""); }, []);
  if (!s.isStaff) return <Empty title="Trang nội bộ" />;
  const now = Date.now();
  const ename = (id: string | null) => (id ? allEnts.data?.find((e) => e.id === id)?.legal_name ?? "?" : null);
  const cname = (id: string | null) => (id ? customers.data?.find((c) => c.id === id)?.code ?? "?" : "Mọi khách");
  const unit = (m: string) => (m === "per_kg" ? "đ/kg" : "%");

  return (
    <>
      <PageHeader eyebrow="Tài chính" title="Biểu phí" desc="Giá bán và giá vốn từng loại phí, có ngày hiệu lực. Đặt giá vốn tạo phiên bản mới, giữ giá bán. Đơn lấy mức đang hiệu lực tại ngày tạo đơn, nên đổi biểu phí không làm sai đơn cũ." />
      {entF ? <div className="mb-4 rounded-xl bg-brand-soft px-4 py-3 text-sm">Đang đặt biểu phí riêng cho <b>{ename(entF)}</b>: chọn sẵn ở ô “Riêng công ty con” khi thêm mức phí. Phí nào không đặt riêng sẽ lấy mức của khách tổng hoặc mặc định.</div> : null}
      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          {ft.isLoading ? <Skeleton /> : (ft.data ?? []).map((t) => {
            const rs = (rules.data ?? []).filter((r) => r.fee_type_id === t.id);
            return (
              <Card key={t.id} title={t.name} actions={<span className="text-xs text-muted">{METHOD[t.calc_method]}</span>}>
                {t.calc_method === "actual" ? <p className="text-sm text-muted">Nhập số thực tế trên từng đơn (mục “Thêm khoản phát sinh”).</p> : rs.length === 0 ? <Empty title="Chưa có mức phí" /> : (
                  <ul className="space-y-2">
                    {rs.map((r) => {
                      const live = new Date(r.valid_from).getTime() <= now && (!r.valid_to || new Date(r.valid_to).getTime() > now);
                      return (
                        <li key={r.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${live ? "border-line" : "border-dashed border-line opacity-60"}`}>
                          <div>
                            <span className="font-mono font-semibold">{fmtNumber(r.sell_rate)} {unit(t.calc_method)}</span>
                            <span className="ml-2 text-xs text-muted">giá vốn: {r.cost_rate == null ? "chưa có" : `${fmtNumber(r.cost_rate)} ${unit(t.calc_method)}`}</span>
                            <div className="text-xs text-muted">{ename(r.entity_id) ?? cname(r.customer_id)} · {r.china_invoice_type ? INVOICE_TYPE[r.china_invoice_type] : "mọi loại HĐ"} · {r.goods_group ? lookupLabel(groups.data, r.goods_group) : "mọi nhóm hàng"} · {fmtDate(r.valid_from)} → {r.valid_to ? fmtDate(r.valid_to) : "nay"}{r.note ? ` · ${r.note}` : ""}</div>
                          </div>
                          {live && s.can("finance.cost.write") && !r.valid_to ? <ActionButton invalidate={[["fee-rules"]]} onClick={async () => { const v = prompt(`Giá vốn mới (${unit(t.calc_method)}) cho mức ${fmtNumber(r.sell_rate)} ${unit(t.calc_method)}:`, r.cost_rate == null ? "" : String(r.cost_rate)); if (v === null || v.trim() === "") return; await q(supabase.rpc("set_fee_cost", { p_rule_id: r.id, p_cost_rate: Number(v.replace(",", ".")), p_note: "Đặt giá vốn" })); }}>Đặt giá vốn</ActionButton> : null}
                          {live ? (manage && !r.valid_to ? <ActionButton confirmText="Ngừng áp dụng mức này từ bây giờ? (đơn cũ không đổi)" invalidate={[["fee-rules"]]} onClick={() => q(supabase.from("fee_rules").update({ valid_to: new Date().toISOString() }).eq("id", r.id))}>Ngừng</ActionButton> : <Badge tone="ok">Đang áp dụng</Badge>) : <Badge>Hết hiệu lực</Badge>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
        {manage ? (
          <Card title="Thêm mức phí mới">
            <Form resetOnOk invalidate={[["fee-rules"]]} onSubmit={async (f) => {
              const sell = Number(String(f.get("sell_rate") ?? "").replace(",", "."));
              const costS = String(f.get("cost_rate") ?? "").trim();
              if (!f.get("fee_type_id") || !(sell >= 0)) return { error: "Chọn loại phí và nhập mức" };
              const d = String(f.get("valid_from") ?? "");
              const { error } = await supabase.from("fee_rules").insert({
                fee_type_id: f.get("fee_type_id"), customer_id: (f.get("entity_id") ? allEnts.data?.find((e) => e.id === f.get("entity_id"))?.customer_id : f.get("customer_id")) || null, entity_id: f.get("entity_id") || null, china_invoice_type: f.get("china_invoice_type") || null,
                goods_group: f.get("goods_group") || null, sell_rate: sell, cost_rate: costS === "" ? null : Number(costS.replace(",", ".")),
                valid_from: d ? new Date(d + "T00:00:00+07:00").toISOString() : new Date().toISOString(), note: String(f.get("note") ?? "") || null });
              return error ? { error: viError(error) } : { ok: true, message: "Đã thêm. Mức cũ vẫn áp dụng cho đơn tạo trước ngày hiệu lực." };
            }}>
              <Field label="Loại phí"><select name="fee_type_id" className={inputCls}>{(ft.data ?? []).filter((t) => t.calc_method !== "actual").map((t) => <option key={t.id} value={t.id}>{t.name} ({METHOD[t.calc_method]})</option>)}</select></Field>
              <Field label="Áp cho khách"><select name="customer_id" className={inputCls}><option value="">Mọi khách (mặc định)</option>{(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>
              <Field label="Riêng công ty con" hint="Trống = áp cả khách tổng. Ưu tiên: công ty con > khách tổng > mặc định"><select name="entity_id" key={entF} defaultValue={entF} className={inputCls}><option value="">—</option>{(allEnts.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}</select></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Loại hóa đơn TQ"><select name="china_invoice_type" className={inputCls}><option value="">Mọi loại</option>{Object.entries(INVOICE_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Nhóm hàng"><select name="goods_group" className={inputCls}><option value="">Mọi nhóm</option>{(groups.data ?? []).filter((g) => g.is_active && g.code !== "chung").map((g) => <option key={g.code} value={g.code}>{g.label}</option>)}</select></Field>
                <Field label="Mức thu khách"><input name="sell_rate" inputMode="decimal" required className={inputCls + " font-mono"} /></Field>
                <Field label="Giá vốn" hint="Để trống nếu chưa có"><input name="cost_rate" inputMode="decimal" className={inputCls + " font-mono"} /></Field>
              </div>
              <Field label="Áp dụng từ ngày" hint="Để trống = ngay bây giờ"><input name="valid_from" type="date" className={inputCls} /></Field>
              <Field label="Ghi chú / căn cứ"><input name="note" className={inputCls} /></Field>
              <div className="flex justify-end"><Submit>Thêm mức phí</Submit></div>
            </Form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
