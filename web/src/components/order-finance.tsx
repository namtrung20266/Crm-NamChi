"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { rpc, PAYMENT_STATE } from "@/lib/meta";
import { STATEMENT_KIND } from "@/lib/status";
import { Card, Badge, Empty, Field, inputCls, btn, Notice } from "./ui";
import { Form, Submit, ActionButton } from "./ui/form";
import { Modal } from "./modal";
import { Thumb } from "./files";
import { uploadFile, useAttachments } from "@/lib/files";
import { vnd, fmtNumber, fmtDate, fmtDateTime, parseMoney } from "@/lib/format";
import { viError } from "@/lib/errors";

type Stmt = { id: string; version: number; kind: string; status: string; subtotal_vnd: number; vat_rate: number; vat_vnd: number; total_vnd: number; deposit_vnd: number; fx_rate: number; created_at: string; confirmed_at: string | null };
type Line = { id: string; label: string; basis_vnd: number | null; rate: number | null; amount_vnd: number; source: string; visible_to_customer: boolean };
type Ledger = { id: number; amount_vnd: number; kind: string; note: string | null; created_at: string; reverses_id: number | null };
export type Progress = { total_vnd: number; deposit_vnd: number; paid_vnd: number; remaining_vnd: number; payment_state: string; wallet_balance_vnd: number };
const KIND: Record<string, string> = { coc: "Đặt cọc", thanh_toan: "Thanh toán", hoan_don: "Hoàn về ví", dao: "Đảo bút toán" };

// Phiếu tính tiền + thanh toán từ ví + thanh toán NCC (dùng chung cho nhân viên và khách)
export function OrderFinance({ order, progress, onChanged }: { order: { id: string; code: string; goods_cny: number; status: string }; progress?: Progress; onChanged: () => void }) {
  const s = useSession();
  const qc = useQueryClient();
  const id = order.id;
  const finRead = s.isStaff ? s.can("finance.read") : true;
  const stmt = useQuery({ queryKey: ["stmt", id], enabled: finRead, queryFn: () => q<Stmt | null>(supabase.from("order_statements").select("*").eq("order_id", id).neq("status", "superseded").order("version", { ascending: false }).limit(1).maybeSingle()) });
  const lines = useQuery({ queryKey: ["stmt-lines", stmt.data?.id], enabled: !!stmt.data?.id, queryFn: () => q<Line[]>(supabase.from("order_statement_lines").select("*").eq("statement_id", stmt.data!.id).order("sort_order")) });
  const ledger = useQuery({ queryKey: ["order-ledger", id], enabled: finRead, queryFn: () => q<Ledger[]>(supabase.from("wallet_ledger").select("id, amount_vnd, kind, note, created_at, reverses_id").eq("order_id", id).order("created_at")) });
  const sp = useQuery({ queryKey: ["supplier-pay", id], enabled: s.isStaff && s.can("finance.read"), queryFn: () => q<{ id: string; paid_at: string; method: string; amount_cny: number; fx_rate: number; amount_vnd: number; note: string | null }[]>(supabase.from("supplier_payments").select("*").eq("order_id", id).is("deleted_at", null).order("paid_at")) });
  const feeTypes = useQuery({ queryKey: ["fee-types-actual"], enabled: s.can("finance.statement.write"), queryFn: () => q<{ id: string; name: string }[]>(supabase.from("fee_types").select("id, name").eq("calc_method", "actual").order("sort_order")) });
  const bills = useAttachments("supplier_payment", (sp.data ?? []).map((x) => x.id));
  const [pay, setPay] = useState<null | "coc" | "thanh_toan">(null);
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!finRead) return null;
  const refresh = () => { ["stmt", "stmt-lines", "order-ledger", "supplier-pay", "order-progress", "order-profit", "wallets"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); onChanged(); };
  const st = stmt.data;
  const p = progress;
  const canPay = s.isStaff ? s.can("wallet.pay") : s.can("order.pay_own");
  const depositDue = p ? Math.max(0, Math.min(p.deposit_vnd, p.total_vnd) - p.paid_vnd) : 0;
  const build = async (kind: string, extra: unknown[] = []) => { await rpc("build_statement", { p_order_id: id, p_kind: kind, p_extra: extra }); refresh(); };
  const doPay = async () => {
    setBusy(true); setErr(null);
    try { await rpc("pay_order", { p_order_id: id, p_amount: parseMoney(amount), p_kind: pay }); setPay(null); refresh(); }
    catch (e) { setErr(viError(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <Card title={st ? `Phiếu tính tiền · ${STATEMENT_KIND[st.kind]} (bản ${st.version})` : "Phiếu tính tiền"}
        actions={st ? <Badge tone={st.status === "confirmed" ? "ok" : "warn"}>{st.status === "confirmed" ? `Đã chốt ${fmtDate(st.confirmed_at)}` : "Chưa chốt"}</Badge> : null}>
        {!st ? <Empty title="Chưa lập phiếu tính tiền" desc={s.can("finance.statement.write") ? "Bấm “Lập phiếu dự tính” để tính theo biểu phí." : "Nam Trung sẽ gửi phiếu sau khi chốt đơn."} /> : (
          <>
            <table className="w-full text-sm"><tbody>
              {(lines.data ?? []).map((l) => (
                <tr key={l.id} className="border-b border-line/70">
                  <td className="py-2 pr-2">{l.label}{!l.visible_to_customer ? <> <Badge>nội bộ</Badge></> : null}{l.source === "manual" ? <span className="ml-1 text-[12.5px] text-muted">phát sinh</span> : null}</td>
                  <td className="py-2 text-right text-xs text-muted">{l.rate && l.source === "rule" ? (l.basis_vnd ? `${fmtNumber(l.rate)}% × ${fmtNumber(l.basis_vnd)}` : `${fmtNumber(l.rate)} đ/kg`) : ""}</td>
                  <td className="py-2 text-right font-mono">{vnd(l.amount_vnd)}</td>
                </tr>
              ))}
              <tr><td className="pt-3 text-muted">Cộng</td><td /><td className="pt-3 text-right font-mono">{vnd(st.subtotal_vnd)}</td></tr>
              <tr><td className="text-muted">VAT {fmtNumber(st.vat_rate)}%</td><td /><td className="text-right font-mono">{vnd(st.vat_vnd)}</td></tr>
              <tr className="text-base font-semibold"><td className="pt-2">Tổng phải thanh toán</td><td /><td className="pt-2 text-right font-mono text-brand-strong">{vnd(st.total_vnd)}</td></tr>
              <tr><td className="text-muted">Cọc yêu cầu</td><td /><td className="text-right font-mono text-muted">{vnd(st.deposit_vnd)}</td></tr>
            </tbody></table>
            {st.status === "active" && (!s.isStaff || s.can("finance.statement.write")) ? (
              <div className="mt-4 flex justify-end"><ActionButton variant="primary" confirmText="Xác nhận phiếu tính tiền này?" onClick={async () => { await rpc("confirm_statement", { p_statement_id: st.id }); refresh(); }}>{s.isStaff ? "Xác nhận thay khách" : "Xác nhận phiếu"}</ActionButton></div>
            ) : null}
          </>
        )}
        {s.can("finance.statement.write") ? (
          <div className="mt-5 space-y-3 border-t border-line pt-4">
            <div className="flex flex-wrap gap-2">
              {Object.entries(STATEMENT_KIND).map(([k, v]) => (
                <ActionButton key={k} variant={k === "quyet_toan" ? "primary" : "secondary"} confirmText={`Lập phiếu ${v}? Phiếu hiện tại được thay thế (vẫn lưu lịch sử). Khách nhận thông báo.`} onClick={() => build(k)}>Lập phiếu {v.toLowerCase()}</ActionButton>
              ))}
            </div>
            <details><summary className="cursor-pointer text-sm font-semibold text-brand-strong">+ Thêm khoản phát sinh (kiểm định, ship, thuế NK…)</summary>
              <Form className="mt-3 grid gap-3 sm:grid-cols-2" resetOnOk onSubmit={async (f) => {
                const amt = parseMoney(f.get("amount")); const cost = String(f.get("cost") ?? "").replace(/\D/g, ""); const ft = String(f.get("fee_type_id") ?? "");
                const label = String(f.get("label") ?? "").trim() || feeTypes.data?.find((x) => x.id === ft)?.name || "";
                if (!label || !amt) return { error: "Nhập loại phí và số tiền" };
                await build(st?.kind ?? "tam_tinh", [{ label, amount_vnd: amt, cost_vnd: cost || null, fee_type_id: ft || null, visible: f.get("internal") !== "on" }]);
                return { ok: true, message: "Đã thêm và tính lại phiếu." };
              }}>
                <Field label="Loại phí"><select name="fee_type_id" className={inputCls}>{(feeTypes.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
                <Field label="Diễn giải"><input name="label" className={inputCls} placeholder="VD: Kiểm định lô 25/10 – 2 mẫu" /></Field>
                <Field label="Thu khách (đ)"><input name="amount" inputMode="numeric" required className={inputCls + " font-mono"} /></Field>
                <Field label="Giá vốn thực (đ)" hint="Trống nếu chưa có"><input name="cost" inputMode="numeric" className={inputCls + " font-mono"} /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="internal" className="h-4 w-4" /> Chỉ nội bộ</label>
                <div className="flex justify-end"><Submit>Thêm &amp; tính lại</Submit></div>
              </Form>
            </details>
          </div>
        ) : null}
      </Card>

      <Card title="Thanh toán của khách (trừ ví)" actions={p ? <Badge tone={PAYMENT_STATE[p.payment_state]?.tone}>{PAYMENT_STATE[p.payment_state]?.label}</Badge> : null}>
        {p ? (
          <div className="mb-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            {[["Phải thu", p.total_vnd, ""], ["Đã trả", p.paid_vnd, "text-ok"], ["Còn lại", p.remaining_vnd, p.remaining_vnd > 0 ? "text-danger" : "text-ok"], ["Số dư ví công ty", p.wallet_balance_vnd, "text-brand-strong"]].map(([l, v, c]) => (
              <div key={l as string} className="rounded-lg bg-surface p-2.5"><div className="text-[12.5px] text-muted">{l}</div><div className={`font-mono text-sm font-semibold ${c}`}>{vnd(v as number)}</div></div>
            ))}
          </div>
        ) : null}
        {canPay && p && p.total_vnd > 0 && p.remaining_vnd > 0 && order.status !== "huy" ? (
          <div className="mb-4 flex flex-wrap gap-2">
            {depositDue > 0 ? <button onClick={() => { setPay("coc"); setAmount(String(depositDue)); setErr(null); }} className={btn.primary}>Đặt cọc {vnd(depositDue)}</button> : null}
            <button onClick={() => { setPay("thanh_toan"); setAmount(String(p.remaining_vnd)); setErr(null); }} className={depositDue > 0 ? btn.secondary : btn.primary}>Thanh toán {vnd(p.remaining_vnd)}</button>
            
          </div>
        ) : null}
        {(ledger.data ?? []).length === 0 ? <p className="text-sm text-muted">Chưa có thanh toán.</p> : (
          <ul className="divide-y divide-line/70 text-sm">{(ledger.data ?? []).map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 py-2">
              <span><Badge tone={l.amount_vnd < 0 ? "brand" : "neutral"}>{KIND[l.kind] ?? l.kind}</Badge> <span className="text-xs text-muted">{fmtDateTime(l.created_at)} · #{l.id}{l.note ? ` · ${l.note}` : ""}</span></span>
              <span className="flex items-center gap-2"><span className="font-mono">{vnd(-l.amount_vnd)}</span>
                {s.isStaff && s.can("finance.receipt.write") && l.kind !== "dao" && !(ledger.data ?? []).some((x) => x.reverses_id === l.id) ? (
                  <ActionButton onClick={async () => { const r = prompt("Lý do đảo bút toán (tối thiểu 5 ký tự):"); if (!r) return; await rpc("reverse_wallet_entry", { p_entry_id: l.id, p_reason: r }); refresh(); }}>Đảo</ActionButton>
                ) : null}</span>
            </li>))}</ul>
        )}
        {s.isStaff && s.can("finance.receipt.write") && p && p.paid_vnd > 0 ? (
          <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-brand-strong">Hoàn tiền thừa về ví</summary>
            <Form className="mt-2 grid gap-2 sm:grid-cols-[1fr_2fr_auto]" resetOnOk onSubmit={async (f) => { await rpc("refund_order_to_wallet", { p_order_id: id, p_amount: parseMoney(f.get("amt")), p_reason: String(f.get("reason") ?? "") }); refresh(); return { ok: true, message: "Đã hoàn về ví." }; }}>
              <input name="amt" placeholder="Số tiền" inputMode="numeric" className={inputCls + " font-mono"} /><input name="reason" placeholder="Lý do (VD: quyết toán thấp hơn tạm tính)" className={inputCls} /><Submit>Hoàn</Submit>
            </Form></details>
        ) : null}
      </Card>

      {s.isStaff && s.can("finance.read") ? (
        <Card title="Thanh toán nhà cung cấp">
          <ul className="space-y-1.5 text-sm">
            {(sp.data ?? []).length === 0 ? <li className="text-muted">Chưa thanh toán NCC.</li> : null}
            {(sp.data ?? []).map((x) => (
              <li key={x.id} className="rounded-lg border border-line/70 p-2.5">
                <div className="flex justify-between gap-2"><span>{fmtDate(x.paid_at)} · {x.method === "khach_tra_ho" ? "Khách trả hộ" : "Nam Trung trả"} · {fmtNumber(x.amount_cny)} tệ × {fmtNumber(x.fx_rate)}{x.note ? ` · ${x.note}` : ""}</span><span className="font-semibold">{vnd(x.amount_vnd)}</span></div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {(bills.data ?? []).filter((a) => a.entity_ref_id === x.id).map((a) => <Thumb key={a.id} a={a} size={56} />)}
                  {!(bills.data ?? []).some((a) => a.entity_ref_id === x.id) ? <span className="text-[13px] text-amber-700">Chưa có ảnh bill</span> : null}
                  {s.can("finance.receipt.write") ? <label className="cursor-pointer rounded-md border border-dashed border-line px-2 py-1 text-[13px] text-muted hover:text-ink">+ Ảnh bill<input type="file" accept="image/*,.pdf" multiple hidden onChange={async (e) => {
                    const fs = Array.from(e.target.files ?? []); e.target.value = "";
                    try { for (const f of fs) await uploadFile(f, "supplier_payment", x.id, { category: "bao_gia_ncc", visibility: "internal" }); bills.refetch(); } catch (er) { alert(er instanceof Error ? er.message : String(er)); }
                  }} /></label> : null}
                </div>
              </li>
            ))}
          </ul>
          {(sp.data ?? []).length ? <p className="mt-2 text-xs text-muted">Đã trả {fmtNumber((sp.data ?? []).reduce((a, x) => a + Number(x.amount_cny), 0))} / {fmtNumber(order.goods_cny)} tệ. Trả đủ → đơn tự chuyển “Chờ shop giao”.</p> : null}
          {s.can("finance.receipt.write") ? (
            <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-brand-strong">+ Ghi nhận thanh toán NCC</summary>
              <Form className="mt-3 grid gap-3 sm:grid-cols-2" resetOnOk invalidate={[["supplier-pay", id], ["order-profit", id]]} onSubmit={async (f) => {
                const amount_cny = Number(String(f.get("amount_cny") ?? "").replace(",", ".")); const fx_rate = Number(String(f.get("fx_rate") ?? "").replace(",", "."));
                if (!(amount_cny > 0) || !(fx_rate > 0)) return { error: "Nhập số tệ và tỷ giá thực tế" };
                const { data: row, error } = await supabase.from("supplier_payments").insert({ order_id: id, amount_cny, fx_rate, method: f.get("method"), paid_at: f.get("paid_at") || undefined, note: String(f.get("note") ?? "") || null }).select("id").single();
                if (error) return { error: viError(error) };
                const files = (f.getAll("bill") as File[]).filter((x) => x && x.size > 0);
                for (const file of files) { try { await uploadFile(file, "supplier_payment", row.id, { category: "bao_gia_ncc", visibility: "internal" }); } catch (e) { refresh(); return { error: `Đã ghi nhận nhưng ảnh bill lỗi: ${e instanceof Error ? e.message : ""}` }; } }
                refresh(); bills.refetch(); return { ok: true, message: files.length ? `Đã ghi nhận kèm ${files.length} ảnh bill.` : "Đã ghi nhận (chưa có ảnh bill)." };
              }}>
                <Field label="Số tệ"><input name="amount_cny" inputMode="decimal" defaultValue={order.goods_cny - (sp.data ?? []).reduce((a, x) => a + Number(x.amount_cny), 0) || ""} className={inputCls + " font-mono"} /></Field>
                <Field label="Tỷ giá thực tế"><input name="fx_rate" inputMode="decimal" className={inputCls + " font-mono"} /></Field>
                <Field label="Hình thức"><select name="method" className={inputCls}><option value="nam_trung">Nam Trung trả</option><option value="khach_tra_ho">Khách trả hộ / cọc trực tiếp</option></select></Field>
                <Field label="Ngày trả"><input name="paid_at" type="date" className={inputCls} /></Field>
                <div className="sm:col-span-2"><Field label="Ghi chú"><input name="note" className={inputCls} /></Field></div>
                <div className="sm:col-span-2"><Field label="Ảnh bill / chứng từ thanh toán" hint="Lưu Google Drive, chỉ nội bộ"><input name="bill" type="file" accept="image/*,.pdf" multiple className="block w-full text-sm" /></Field></div>
                <div className="flex justify-end sm:col-span-2"><Submit>Ghi nhận</Submit></div>
              </Form>
            </details>
          ) : null}
        </Card>
      ) : null}

      <Modal open={!!pay} onClose={() => setPay(null)} title={`${pay === "coc" ? "Đặt cọc" : "Thanh toán"} đơn ${order.code} từ ví`}>
        <div className="space-y-3">
          <p className="text-sm">Số dư ví: <b className="font-mono">{vnd(p?.wallet_balance_vnd)}</b> · còn phải trả <b className="font-mono">{vnd(p?.remaining_vnd)}</b></p>
          <Field label="Số tiền (đ)"><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" className={inputCls + " font-mono text-lg"} autoFocus /></Field>
          {p && parseMoney(amount) > p.wallet_balance_vnd ? <p className="text-xs text-danger">Ví thiếu {vnd(parseMoney(amount) - p.wallet_balance_vnd)}. {s.isStaff ? "Nhắc khách nạp thêm." : "Vào mục Ví để nạp thêm."}</p> : null}
          {err ? <Notice>{err}</Notice> : null}
          <div className="flex justify-end gap-2"><button onClick={() => setPay(null)} className={btn.ghost}>Hủy</button><button onClick={doPay} disabled={busy} className={btn.primary}>{busy ? "…" : "Xác nhận trừ ví"}</button></div>
        </div>
      </Modal>
    </div>
  );
}

// Phiếu tính tiền bản mới nhất (gọn) cho tab Tổng quan
export function StatementSummary({ orderId, onOpen }: { orderId: string; onOpen?: () => void }) {
  const s = useSession();
  const ok = s.isStaff ? s.can("finance.read") : true;
  const stmt = useQuery({ queryKey: ["stmt", orderId], enabled: ok, queryFn: () => q<Stmt | null>(supabase.from("order_statements").select("*").eq("order_id", orderId).neq("status", "superseded").order("version", { ascending: false }).limit(1).maybeSingle()) });
  const lines = useQuery({ queryKey: ["stmt-lines", stmt.data?.id], enabled: !!stmt.data?.id, queryFn: () => q<Line[]>(supabase.from("order_statement_lines").select("*").eq("statement_id", stmt.data!.id).order("sort_order")) });
  if (!ok) return null;
  const st = stmt.data;
  return (
    <Card title={st ? `Phiếu tính tiền · ${STATEMENT_KIND[st.kind]} (bản ${st.version})` : "Phiếu tính tiền"}
      actions={<div className="flex items-center gap-2">{st ? <Badge tone={st.status === "confirmed" ? "ok" : "warn"}>{st.status === "confirmed" ? "Đã chốt" : "Chưa chốt"}</Badge> : null}
        {onOpen ? <button onClick={onOpen} className="text-sm font-semibold text-brand-strong">Chi tiết →</button> : null}</div>}>
      {!st ? <p className="text-sm text-muted">Chưa lập phiếu tính tiền.</p> : (
        <table className="w-full text-[14px]"><tbody>
          {(lines.data ?? []).filter((l) => s.isStaff || l.visible_to_customer).map((l) => (
            <tr key={l.id} className="border-b border-line/60"><td className="py-1.5">{l.label}</td><td className="py-1.5 text-right">{vnd(l.amount_vnd)}</td></tr>
          ))}
          <tr><td className="pt-2 text-muted">VAT {fmtNumber(st.vat_rate)}%</td><td className="pt-2 text-right">{vnd(st.vat_vnd)}</td></tr>
          <tr className="text-[15px] font-semibold"><td className="py-1">Tổng phải thanh toán</td><td className="py-1 text-right text-brand-strong">{vnd(st.total_vnd)}</td></tr>
          <tr><td className="text-muted">Cọc yêu cầu</td><td className="text-right text-muted">{vnd(st.deposit_vnd)}</td></tr>
        </tbody></table>
      )}
    </Card>
  );
}
