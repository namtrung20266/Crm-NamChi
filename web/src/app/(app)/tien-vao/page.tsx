"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { useCustomers } from "@/lib/data";
import { PageHeader, Card, Badge, Empty, Field, inputCls, Skeleton } from "@/components/ui";
import { Form, Submit } from "@/components/ui/form";
import { vnd, fmtDate } from "@/lib/format";
import { viError } from "@/lib/errors";

type Rec = { receipt_id: string; customer_id: string; received_at: string; amount_vnd: number; bank_ref: string | null; payer_note: string | null; allocated_vnd: number; unallocated_vnd: number };
type OpenOrder = { order_id: string; code: string; total_vnd: number; paid_vnd: number; remaining_vnd: number; entity_id: string };

export default function ReceiptsPage() {
  const s = useSession();
  const customers = useCustomers();
  const [cust, setCust] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const recs = useQuery({ queryKey: ["receipts", cust], queryFn: () => {
    let x = supabase.from("receipt_balance").select("*").order("received_at", { ascending: false }).limit(300);
    if (cust) x = x.eq("customer_id", cust);
    return q<Rec[]>(x);
  } });
  const write = s.can("finance.receipt.write");
  const cname = (id: string) => customers.data?.find((c) => c.id === id)?.code ?? "";
  const totalUnalloc = (recs.data ?? []).reduce((a, r) => a + Number(r.unallocated_vnd), 0);
  if (!s.isStaff || !s.can("finance.read")) return <Empty title="Bạn không có quyền xem tiền vào" />;

  return (
    <>
      <PageHeader eyebrow="Tài chính" title="Tiền vào & phân bổ" desc={`Mỗi giao dịch ngân hàng một dòng; phân bổ vào nhiều đơn với nhãn L1 (cọc) / L2 (thanh toán). Chưa phân bổ: ${vnd(totalUnalloc)}`} />
      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <select value={cust} onChange={(e) => setCust(e.target.value)} className={inputCls + " mb-4 max-w-xs"}>
            <option value="">Mọi khách hàng</option>{(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </select>
          {recs.isLoading ? <Skeleton /> : (recs.data ?? []).length === 0 ? <Empty title="Chưa có giao dịch" /> : (
            <ul className="space-y-2">
              {(recs.data ?? []).map((r) => (
                <li key={r.receipt_id} className="rounded-xl border border-line p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><span className="font-mono text-sm font-semibold">{vnd(r.amount_vnd)}</span> <span className="text-xs text-muted">· {cname(r.customer_id)} · {fmtDate(r.received_at)} {r.bank_ref ? `· ${r.bank_ref}` : ""}</span></div>
                    {Number(r.unallocated_vnd) > 0 ? <Badge tone="warn">Chưa phân bổ {vnd(r.unallocated_vnd)}</Badge> : <Badge tone="ok">Đã phân bổ hết</Badge>}
                  </div>
                  {r.payer_note ? <p className="mt-1 text-xs text-muted">{r.payer_note}</p> : null}
                  {write && Number(r.unallocated_vnd) > 0 ? (
                    open === r.receipt_id ? <Allocate r={r} onDone={() => setOpen(null)} /> :
                      <button onClick={() => setOpen(r.receipt_id)} className="mt-2 text-sm font-semibold text-brand-strong">Phân bổ vào đơn →</button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {write ? (
          <Card title="Ghi nhận tiền vào">
            <Form resetOnOk invalidate={[["receipts"]]} onSubmit={async (f) => {
              const amount_vnd = Number(String(f.get("amount") ?? "").replace(/\D/g, ""));
              if (!f.get("customer_id") || !(amount_vnd > 0)) return { error: "Chọn khách và nhập số tiền" };
              const { error } = await supabase.from("bank_receipts").insert({ customer_id: f.get("customer_id"), amount_vnd, received_at: f.get("received_at") || undefined, bank_ref: String(f.get("bank_ref") ?? "") || null, payer_note: String(f.get("payer_note") ?? "") || null });
              return error ? { error: viError(error) } : { ok: true, message: "Đã ghi nhận. Bấm “Phân bổ vào đơn” để gán tiền." };
            }}>
              <Field label="Khách hàng"><select name="customer_id" className={inputCls} defaultValue={cust}><option value="">Chọn khách…</option>{(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>
              <Field label="Số tiền (đ)"><input name="amount" inputMode="numeric" className={inputCls + " font-mono"} /></Field>
              <Field label="Ngày nhận"><input name="received_at" type="date" className={inputCls} /></Field>
              <Field label="Mã giao dịch ngân hàng"><input name="bank_ref" className={inputCls} /></Field>
              <Field label="Nội dung chuyển khoản"><input name="payer_note" className={inputCls} /></Field>
              <div className="flex justify-end"><Submit>Ghi nhận</Submit></div>
            </Form>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function Allocate({ r, onDone }: { r: Rec; onDone: () => void }) {
  const orders = useQuery({ queryKey: ["open-orders", r.customer_id], queryFn: () => q<OpenOrder[]>(
    supabase.from("order_finance").select("order_id, code, total_vnd, paid_vnd, remaining_vnd, entity_id").eq("customer_id", r.customer_id).gt("remaining_vnd", 0).order("created_at")) });
  return (
    <Form className="mt-3 grid gap-3 rounded-lg bg-surface p-3 sm:grid-cols-4" invalidate={[["receipts"], ["open-orders", r.customer_id], ["orders"], ["allocs"]]} onSubmit={async (f) => {
      const amount_vnd = Number(String(f.get("amount") ?? "").replace(/\D/g, ""));
      if (!f.get("order_id") || !(amount_vnd > 0)) return { error: "Chọn đơn và số tiền" };
      const { error } = await supabase.from("receipt_allocations").insert({ receipt_id: r.receipt_id, order_id: f.get("order_id"), kind: f.get("kind"), amount_vnd, customer_id: r.customer_id, entity_id: (orders.data ?? []).find((o) => o.order_id === f.get("order_id"))?.entity_id });
      if (error) return { error: viError(error) };
      onDone();
      return { ok: true };
    }}>
      <div className="sm:col-span-2"><Field label="Đơn còn phải thu"><select name="order_id" className={inputCls}>{(orders.data ?? []).map((o) => <option key={o.order_id} value={o.order_id}>{o.code} · còn {vnd(o.remaining_vnd)}</option>)}</select></Field></div>
      <Field label="Loại"><select name="kind" className={inputCls}><option value="L1">L1 – cọc</option><option value="L2">L2 – thanh toán</option><option value="khac">Khác</option></select></Field>
      <Field label="Số tiền"><input name="amount" inputMode="numeric" defaultValue={r.unallocated_vnd} className={inputCls + " font-mono"} /></Field>
      <div className="flex justify-end gap-2 sm:col-span-4"><button type="button" onClick={onDone} className="text-sm text-muted">Hủy</button><Submit>Phân bổ</Submit></div>
    </Form>
  );
}
