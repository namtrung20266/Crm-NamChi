"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { ORDER_SELECT, type Order } from "@/lib/orders";
import { ORDER_STATUS, INVOICE_TYPE, STATEMENT_KIND, DELAY } from "@/lib/status";
import { PageHeader, Card, Badge, Empty, Field, inputCls, LinkButton, Skeleton, btn } from "@/components/ui";
import { Form, Submit, ActionButton } from "@/components/ui/form";
import { OrderFields, readOrder, GOODS_GROUPS } from "@/components/order-fields";
import { OrderPackages } from "@/components/order-packages";
import { OrderItems } from "@/components/order-items";
import { vnd, fmtNumber, fmtDate, fmtDateTime } from "@/lib/format";
import { viError } from "@/lib/errors";

type Stmt = { id: string; version: number; kind: string; status: string; subtotal_vnd: number; vat_rate: number; vat_vnd: number; total_vnd: number; deposit_vnd: number; fx_rate: number; created_at: string; confirmed_at: string | null };
type Line = { id: string; label: string; basis_vnd: number | null; rate: number | null; amount_vnd: number; source: string; visible_to_customer: boolean; sort_order: number };

function Detail() {
  const id = useSearchParams().get("id") ?? "";
  const s = useSession();
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const staffWrite = s.isStaff && s.can("order.write");
  const finRead = s.isStaff ? s.can("finance.read") : true;
  const order = useQuery({ queryKey: ["order", id], enabled: !!id, queryFn: () => q<Order | null>(supabase.from("orders").select(ORDER_SELECT).eq("id", id).maybeSingle()) });
  const stmt = useQuery({ queryKey: ["stmt", id], enabled: !!id && finRead, queryFn: () => q<Stmt | null>(supabase.from("order_statements").select("*").eq("order_id", id).neq("status", "superseded").order("version", { ascending: false }).limit(1).maybeSingle()) });
  const lines = useQuery({ queryKey: ["stmt-lines", stmt.data?.id], enabled: !!stmt.data?.id, queryFn: () => q<Line[]>(supabase.from("order_statement_lines").select("*").eq("statement_id", stmt.data!.id).order("sort_order")) });
  const allocs = useQuery({ queryKey: ["allocs", id], enabled: finRead, queryFn: () => q<{ id: string; kind: string; amount_vnd: number; created_at: string; note: string | null }[]>(supabase.from("receipt_allocations").select("id, kind, amount_vnd, created_at, note").eq("order_id", id).order("created_at")) });
  const sp = useQuery({ queryKey: ["supplier-pay", id], enabled: s.isStaff && s.can("finance.read"), queryFn: () => q<{ id: string; paid_at: string; method: string; amount_cny: number; fx_rate: number; amount_vnd: number; note: string | null }[]>(supabase.from("supplier_payments").select("*").eq("order_id", id).is("deleted_at", null).order("paid_at")) });
  const profit = useQuery({ queryKey: ["profit", id], enabled: s.can("finance.profit.read"), queryFn: () => q<{ revenue_ex_vat: number | null; cost_vnd: number | null; missing_cost_lines: number } | null>(supabase.from("order_profit").select("revenue_ex_vat, cost_vnd, missing_cost_lines").eq("order_id", id).maybeSingle()) });
  const history = useQuery({ queryKey: ["status-history", id], queryFn: () => q<{ id: number; from_status: string | null; to_status: string; changed_at: string }[]>(supabase.from("order_status_history").select("id, from_status, to_status, changed_at").eq("order_id", id).order("changed_at", { ascending: false })) });
  const feeTypes = useQuery({ queryKey: ["fee-types-actual"], enabled: s.can("finance.statement.write"), queryFn: () => q<{ id: string; name: string }[]>(supabase.from("fee_types").select("id, name").eq("calc_method", "actual").order("sort_order")) });

  if (order.isLoading) return <Skeleton rows={8} />;
  const o = order.data;
  if (!o) return <Empty title="Không tìm thấy đơn" desc="Có thể anh/chị không có quyền xem đơn này." />;
  const refresh = () => ["order", "stmt", "stmt-lines", "allocs", "profit", "status-history", "orders"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const paid = (allocs.data ?? []).reduce((a, x) => a + Number(x.amount_vnd), 0);
  const st = stmt.data;
  const goodsVnd = Math.round(o.goods_cny * o.fx_rate);
  const spVnd = (sp.data ?? []).reduce((a, x) => a + Number(x.amount_vnd), 0);

  const build = async (kind: string, extra: unknown[] = []) => {
    await q(supabase.rpc("build_statement", { p_order_id: o.id, p_kind: kind, p_extra: extra }));
    refresh();
  };

  return (
    <>
      <PageHeader eyebrow={`${o.customers?.code} · ${o.customer_entities?.legal_name}`} title={`Đơn ${o.code}`}
        desc={`${o.goods_desc ?? "—"} · ${fmtNumber(o.goods_cny)} tệ · ${INVOICE_TYPE[o.china_invoice_type]} · tạo ${fmtDate(o.created_at)}`}
        actions={<LinkButton href="/don-hang/" variant="secondary">← Đơn hàng</LinkButton>} />

      {/* Thanh trạng thái */}
      <div className="card mb-5 overflow-x-auto p-4">
        <div className="flex min-w-max items-center gap-1.5">
          {Object.entries(ORDER_STATUS).filter(([k]) => !["tam_giu", "huy"].includes(k)).map(([k, v], i, arr) => {
            const idx = arr.findIndex(([x]) => x === o.status);
            const done = idx >= 0 && i <= idx;
            return (
              <div key={k} className="flex items-center gap-1.5">
                <button disabled={!staffWrite} title={staffWrite ? "Chuyển sang trạng thái này" : undefined}
                  onClick={async () => { if (!confirm(`Chuyển đơn sang “${v.label}”?`)) return; const { error } = await supabase.from("orders").update({ status: k, row_version: o.row_version }).eq("id", o.id); if (error) alert(viError(error)); refresh(); }}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${k === o.status ? "bg-brand text-white shadow-[0_6px_16px_-8px_var(--brand)]" : done ? "bg-brand-soft text-brand-strong" : "bg-surface text-muted"} ${staffWrite ? "hover:ring-2 hover:ring-brand/30" : ""}`}>
                  {v.label}
                </button>
                {i < arr.length - 1 ? <span className={`h-px w-4 ${done ? "bg-brand/50" : "bg-line"}`} /> : null}
              </div>
            );
          })}
          {["tam_giu", "huy"].includes(o.status) ? <Badge tone="danger">{ORDER_STATUS[o.status].label}</Badge> : null}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <div className="space-y-5">
          {/* Phiếu tính tiền */}
          {finRead ? (
            <Card title={st ? `Phiếu tính tiền · ${STATEMENT_KIND[st.kind]} (bản ${st.version})` : "Phiếu tính tiền"}
              actions={st ? <Badge tone={st.status === "confirmed" ? "ok" : "warn"}>{st.status === "confirmed" ? `Đã xác nhận ${fmtDate(st.confirmed_at)}` : "Chờ xác nhận"}</Badge> : null}>
              {!st ? <Empty title="Chưa lập phiếu tính tiền" desc={s.can("finance.statement.write") ? "Bấm “Lập phiếu dự tính” để hệ thống tính theo biểu phí." : "Nam Trung sẽ gửi phiếu sau khi chốt đơn."} /> : (
                <>
                  <table className="w-full text-sm">
                    <tbody>
                      {(lines.data ?? []).map((l) => (
                        <tr key={l.id} className="border-b border-line/70">
                          <td className="py-2 pr-2">{l.label}{!l.visible_to_customer ? <Badge>nội bộ</Badge> : null}{l.source === "manual" ? <span className="ml-1 text-[11px] text-muted">phát sinh</span> : null}</td>
                          <td className="py-2 text-right text-xs text-muted">{l.rate && l.source === "rule" ? (l.basis_vnd ? `${fmtNumber(l.rate)}% × ${fmtNumber(l.basis_vnd)}` : `${fmtNumber(l.rate)} đ/kg`) : ""}</td>
                          <td className="py-2 text-right font-mono">{vnd(l.amount_vnd)}</td>
                        </tr>
                      ))}
                      <tr><td className="pt-3 text-muted">Cộng</td><td /><td className="pt-3 text-right font-mono">{vnd(st.subtotal_vnd)}</td></tr>
                      <tr><td className="text-muted">VAT {fmtNumber(st.vat_rate)}%</td><td /><td className="text-right font-mono">{vnd(st.vat_vnd)}</td></tr>
                      <tr className="text-base font-semibold"><td className="pt-2">Tổng phải thanh toán</td><td /><td className="pt-2 text-right font-mono text-brand-strong">{vnd(st.total_vnd)}</td></tr>
                      <tr><td className="text-muted">Cọc L1 đề xuất</td><td /><td className="text-right font-mono text-muted">{vnd(st.deposit_vnd)}</td></tr>
                    </tbody>
                  </table>
                  {st.status === "active" && (!s.isStaff || s.can("finance.statement.write")) ? (
                    <div className="mt-4 flex justify-end"><ActionButton variant="primary" confirmText="Xác nhận phiếu tính tiền này?" onClick={async () => { await q(supabase.rpc("confirm_statement", { p_statement_id: st.id })); refresh(); }}>Xác nhận phiếu</ActionButton></div>
                  ) : null}
                </>
              )}
              {s.can("finance.statement.write") ? (
                <div className="mt-5 space-y-3 border-t border-line pt-4">
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(STATEMENT_KIND).map(([k, v]) => (
                      <ActionButton key={k} variant={k === "quyet_toan" ? "primary" : "secondary"} confirmText={`Lập phiếu ${v}? Phiếu hiện tại sẽ được thay thế (vẫn lưu lịch sử).`} onClick={() => build(k)}>Lập phiếu {v.toLowerCase()}</ActionButton>
                    ))}
                  </div>
                  <details><summary className="cursor-pointer text-sm font-semibold text-brand-strong">+ Thêm khoản phát sinh (kiểm định, ship, thuế NK…)</summary>
                    <Form className="mt-3 grid gap-3 sm:grid-cols-2" resetOnOk onSubmit={async (f) => {
                      const amount = Number(String(f.get("amount") ?? "").replace(/\D/g, ""));
                      const cost = String(f.get("cost") ?? "").replace(/\D/g, "");
                      const ftId = String(f.get("fee_type_id") ?? "");
                      const label = String(f.get("label") ?? "").trim() || feeTypes.data?.find((x) => x.id === ftId)?.name || "";
                      if (!label || !amount) return { error: "Nhập loại phí và số tiền" };
                      await build(st?.kind ?? "tam_tinh", [{ label, amount_vnd: amount, cost_vnd: cost || null, fee_type_id: ftId || null, visible: f.get("internal") !== "on" }]);
                      return { ok: true, message: "Đã thêm và tính lại phiếu." };
                    }}>
                      <Field label="Loại phí"><select name="fee_type_id" className={inputCls}>{(feeTypes.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
                      <Field label="Diễn giải (tùy chọn)"><input name="label" className={inputCls} placeholder="VD: Kiểm định lô 25/10 – 2 mẫu" /></Field>
                      <Field label="Số tiền thu khách (đ)"><input name="amount" inputMode="numeric" required className={inputCls + " font-mono"} /></Field>
                      <Field label="Chi phí thực Nam Trung (đ)" hint="Để trống nếu chưa có"><input name="cost" inputMode="numeric" className={inputCls + " font-mono"} /></Field>
                      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="internal" className="h-4 w-4" /> Chỉ nội bộ (khách không thấy)</label>
                      <div className="flex justify-end"><Submit>Thêm &amp; tính lại</Submit></div>
                    </Form>
                  </details>
                </div>
              ) : null}
            </Card>
          ) : null}

          <OrderPackages orderId={o.id} />
          <OrderItems orderId={o.id} />

          {/* Thông tin đơn */}
          <Card title="Thông tin đơn" actions={staffWrite ? <button className={btn.ghost + " h-8 px-3 text-xs"} onClick={() => setEdit((v) => !v)}>{edit ? "Đóng" : "Sửa"}</button> : null}>
            {edit && staffWrite ? (
              <Form onSubmit={async (f) => {
                const p = readOrder(f, true);
                if ("error" in p) return { error: p.error };
                const delay = String(f.get("delay_reason") ?? "") || null;
                const { error } = await supabase.from("orders").update({ ...p.data, delay_reason: delay, row_version: o.row_version }).eq("id", o.id);
                if (error) return { error: viError(error) };
                setEdit(false); refresh();
                return { ok: true, message: "Đã lưu. Nhớ lập lại phiếu tính tiền nếu số liệu thay đổi." };
              }}>
                <OrderFields o={o} staff />
                <Field label="Lý do chậm"><select name="delay_reason" defaultValue={o.delay_reason ?? ""} className={inputCls}><option value="">—</option>{Object.entries(DELAY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <div className="flex justify-end"><Submit>Lưu đơn</Submit></div>
              </Form>
            ) : (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                {[["Tuần đặt", o.order_week], ["Shop / NCC", o.supplier_name], ["Nhóm hàng", GOODS_GROUPS[o.goods_group ?? ""] ?? o.goods_group],
                  ["Số lượng", fmtNumber(o.goods_qty)], ["Tiền hàng", `${fmtNumber(o.goods_cny)} tệ`], ["Tỷ giá chốt", fmtNumber(o.fx_rate)],
                  ["Tiền hàng (VND)", vnd(goodsVnd)], ["Thuế xuất HĐ TQ", `${fmtNumber(o.china_tax_cny)} tệ`], ["Cân tính phí", `${fmtNumber(o.weight_kg)} kg`],
                  ["Khối", `${fmtNumber(o.cbm)} m³`], ["Số kiện", fmtNumber(o.packages)], ["Dự kiến về", o.expected_week],
                  ["Lý do chậm", o.delay_reason ? DELAY[o.delay_reason] : null]].map(([k, v]) => (
                  <div key={k as string}><dt className="text-xs text-muted">{k}</dt><dd className="font-medium">{v || "—"}</dd></div>
                ))}
                {o.note ? <div className="col-span-full"><dt className="text-xs text-muted">Ghi chú</dt><dd>{o.note}</dd></div> : null}
                {s.isStaff && o.internal_note ? <div className="col-span-full"><dt className="text-xs text-muted">Ghi chú nội bộ</dt><dd>{o.internal_note}</dd></div> : null}
              </dl>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          {finRead ? (
            <Card title="Thanh toán của khách">
              <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-surface p-2"><div className="text-[11px] text-muted">Phải thu</div><div className="font-mono text-sm font-semibold">{vnd(st?.total_vnd ?? 0)}</div></div>
                <div className="rounded-lg bg-surface p-2"><div className="text-[11px] text-muted">Đã trả</div><div className="font-mono text-sm font-semibold text-ok">{vnd(paid)}</div></div>
                <div className="rounded-lg bg-surface p-2"><div className="text-[11px] text-muted">Còn lại</div><div className={`font-mono text-sm font-semibold ${(st?.total_vnd ?? 0) - paid > 0 ? "text-danger" : "text-ok"}`}>{vnd((st?.total_vnd ?? 0) - paid)}</div></div>
              </div>
              {(allocs.data ?? []).length === 0 ? <p className="text-sm text-muted">Chưa ghi nhận thanh toán.</p> : (
                <ul className="space-y-1.5 text-sm">{(allocs.data ?? []).map((a) => <li key={a.id} className="flex justify-between"><span><Badge tone="brand">{a.kind}</Badge> <span className="text-xs text-muted">{fmtDateTime(a.created_at)}</span></span><span className="font-mono">{vnd(a.amount_vnd)}</span></li>)}</ul>
              )}
              {s.can("finance.receipt.write") ? <p className="mt-3 text-xs text-muted">Ghi nhận tiền tại mục <Link href="/tien-vao/" className="font-semibold text-brand-strong">Tiền vào</Link> rồi phân bổ vào đơn.</p> : null}
            </Card>
          ) : null}

          {s.isStaff && s.can("finance.read") ? (
            <Card title="Thanh toán nhà cung cấp">
              <ul className="space-y-1.5 text-sm">
                {(sp.data ?? []).length === 0 ? <li className="text-muted">Chưa thanh toán NCC.</li> : null}
                {(sp.data ?? []).map((p) => <li key={p.id} className="flex justify-between gap-2"><span>{fmtDate(p.paid_at)} · {p.method === "khach_tra_ho" ? "Khách trả hộ" : "Nam Trung trả"} · {fmtNumber(p.amount_cny)} tệ × {fmtNumber(p.fx_rate)}</span><span className="font-mono">{vnd(p.amount_vnd)}</span></li>)}
              </ul>
              {(sp.data ?? []).length ? <p className="mt-2 text-xs text-muted">Đã trả NCC {fmtNumber((sp.data ?? []).reduce((a, x) => a + Number(x.amount_cny), 0))} / {fmtNumber(o.goods_cny)} tệ · {vnd(spVnd)}</p> : null}
              {s.can("finance.receipt.write") ? (
                <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-brand-strong">+ Ghi nhận thanh toán NCC</summary>
                  <Form className="mt-3 grid gap-3" resetOnOk invalidate={[["supplier-pay", id], ["profit", id]]} onSubmit={async (f) => {
                    const amount_cny = Number(String(f.get("amount_cny") ?? "").replace(",", "."));
                    const fx_rate = Number(String(f.get("fx_rate") ?? "").replace(",", "."));
                    if (!(amount_cny > 0) || !(fx_rate > 0)) return { error: "Nhập số tệ và tỷ giá thực tế" };
                    const { error } = await supabase.from("supplier_payments").insert({ order_id: o.id, amount_cny, fx_rate, method: f.get("method"), paid_at: f.get("paid_at") || undefined, note: String(f.get("note") ?? "") || null });
                    return error ? { error: viError(error) } : { ok: true };
                  }}>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Số tệ"><input name="amount_cny" inputMode="decimal" className={inputCls + " font-mono"} /></Field>
                      <Field label="Tỷ giá thực tế"><input name="fx_rate" inputMode="decimal" className={inputCls + " font-mono"} /></Field>
                      <Field label="Hình thức"><select name="method" className={inputCls}><option value="nam_trung">Nam Trung trả</option><option value="khach_tra_ho">Khách trả hộ / cọc trực tiếp</option></select></Field>
                      <Field label="Ngày trả"><input name="paid_at" type="date" className={inputCls} /></Field>
                    </div>
                    <Field label="Ghi chú"><input name="note" className={inputCls} /></Field>
                    <div className="flex justify-end"><Submit>Ghi nhận</Submit></div>
                  </Form>
                </details>
              ) : null}
            </Card>
          ) : null}

          {s.can("finance.profit.read") && profit.data ? (
            <Card title="Lợi nhuận đơn (nội bộ)">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-xs text-muted">Doanh thu chưa VAT</dt><dd className="font-mono font-semibold">{vnd(profit.data.revenue_ex_vat)}</dd></div>
                <div><dt className="text-xs text-muted">Giá vốn đã có</dt><dd className="font-mono font-semibold">{vnd(profit.data.cost_vnd)}</dd></div>
                <div className="col-span-2"><dt className="text-xs text-muted">Lợi nhuận gộp</dt><dd className="font-mono text-lg font-semibold text-ok">{vnd(Number(profit.data.revenue_ex_vat ?? 0) - Number(profit.data.cost_vnd ?? 0))}</dd></div>
              </dl>
              {profit.data.missing_cost_lines > 0 ? <p className="mt-2 text-xs text-amber-700">{profit.data.missing_cost_lines} khoản chưa có giá vốn → lợi nhuận đang tính cao hơn thực tế. Bổ sung giá vốn ở Biểu phí.</p> : null}
            </Card>
          ) : null}

          <Card title="Lịch sử trạng thái">
            <ol className="space-y-2 text-sm">{(history.data ?? []).map((h) => <li key={h.id} className="flex justify-between gap-2"><span>{ORDER_STATUS[h.to_status]?.label}</span><span className="font-mono text-xs text-muted">{fmtDateTime(h.changed_at)}</span></li>)}</ol>
          </Card>
        </div>
      </div>
    </>
  );
}

export default function Page() { return <Suspense fallback={<Skeleton rows={8} />}><Detail /></Suspense>; }
