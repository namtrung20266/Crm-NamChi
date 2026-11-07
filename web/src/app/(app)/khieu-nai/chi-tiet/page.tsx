"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { CLAIM_STATUS, CLAIM_TYPE, CREDIT_KIND } from "@/lib/status";
import { PageHeader, Card, Badge, Empty, Field, inputCls, LinkButton, Skeleton } from "@/components/ui";
import { Form, Submit, ActionButton } from "@/components/ui/form";
import { fmtDate, fmtDateTime, vnd } from "@/lib/format";
import { viError } from "@/lib/errors";

type Claim = { id: string; code: string; order_id: string; claim_type: string; description: string; requested_vnd: number | null; status: string; due_date: string | null; created_at: string; row_version: number; orders: { code: string; customer_entities: { legal_name: string } | null } | null };

function Detail() {
  const id = useSearchParams().get("id") ?? "";
  const s = useSession();
  const claim = useQuery({ queryKey: ["claim", id], queryFn: () => q<Claim | null>(supabase.from("claims").select("*, orders(code, customer_entities(legal_name))").eq("id", id).maybeSingle()) });
  const msgs = useQuery({ queryKey: ["claim-msgs", id], queryFn: () => q<{ id: number; body: string; internal: boolean; created_by: string; created_at: string }[]>(supabase.from("claim_messages").select("*").eq("claim_id", id).order("created_at")) });
  const people = useQuery({ queryKey: ["actors"], queryFn: () => q<{ user_id: string; full_name: string; user_type: string }[]>(supabase.from("user_directory").select("user_id, full_name, user_type")) });
  const credits = useQuery({ queryKey: ["claim-credits", id], enabled: s.isStaff, queryFn: () => q<{ id: string; kind: string; amount_vnd: number; reason: string; status: string; created_by: string }[]>(supabase.from("credit_notes").select("*").eq("claim_id", id).order("created_at")) });
  if (claim.isLoading) return <Skeleton rows={6} />;
  const c = claim.data;
  if (!c) return <Empty title="Không tìm thấy khiếu nại" />;
  const write = s.can("claim.write");
  const who = (u: string) => people.data?.find((p) => p.user_id === u);

  return (
    <>
      <PageHeader eyebrow={`Khiếu nại · ${CLAIM_TYPE[c.claim_type]}`} title={c.code} desc={`Đơn ${c.orders?.code} · ${c.orders?.customer_entities?.legal_name} · hạn xử lý ${fmtDate(c.due_date)}`}
        actions={<><Badge tone={CLAIM_STATUS[c.status].tone}>{CLAIM_STATUS[c.status].label}</Badge><LinkButton href="/khieu-nai/" variant="secondary">← Khiếu nại</LinkButton></>} />
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Card title="Trao đổi">
          <div className="mb-4 rounded-lg bg-surface p-3 text-sm"><div className="text-xs text-muted">Nội dung ban đầu {c.requested_vnd ? `· đề nghị ${vnd(c.requested_vnd)}` : ""}</div>{c.description}</div>
          <ul className="space-y-3">{(msgs.data ?? []).map((m) => { const p = who(m.created_by); const mine = m.created_by === s.user_id; return (
            <li key={m.id} className={`flex ${mine ? "justify-end" : ""}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${m.internal ? "border border-dashed border-amber-300 bg-amber-50" : mine ? "bg-brand text-white" : "bg-surface"}`}>
                <div className={`text-[12.5px] ${mine && !m.internal ? "text-white/70" : "text-muted"}`}>{p?.full_name ?? "—"} · {fmtDateTime(m.created_at)}{m.internal ? " · nội bộ" : ""}</div>{m.body}
              </div>
            </li>); })}</ul>
          <Form className="mt-4 space-y-2" resetOnOk invalidate={[["claim-msgs", id]]} onSubmit={async (f) => {
            const { error } = await supabase.from("claim_messages").insert({ claim_id: id, body: String(f.get("body") ?? "").trim(), internal: f.get("internal") === "on" });
            return error ? { error: viError(error) } : { ok: true };
          }}>
            <textarea name="body" rows={2} required placeholder="Nhập trao đổi…" className={inputCls + " h-auto py-2"} />
            <div className="flex items-center justify-between">{s.isStaff ? <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" name="internal" className="h-4 w-4" /> Ghi chú nội bộ (khách không thấy)</label> : <span />}<Submit>Gửi</Submit></div>
          </Form>
        </Card>
        <div className="space-y-5">
          {write ? (
            <Card title="Xử lý">
              <select defaultValue={c.status} onChange={async (e) => { const { error } = await supabase.from("claims").update({ status: e.target.value, row_version: c.row_version }).eq("id", c.id); if (error) alert(viError(error)); claim.refetch(); }} className={inputCls}>
                {Object.entries(CLAIM_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <p className="mt-2 text-xs text-muted"><Link href={`/don-hang/chi-tiet/?id=${c.order_id}`} className="font-semibold text-brand-strong">Mở đơn {c.orders?.code} →</Link></p>
            </Card>
          ) : null}
          {s.isStaff ? (
            <Card title="Credit note (bồi thường / giảm trừ)">
              <ul className="space-y-2 text-sm">{(credits.data ?? []).map((cn) => (
                <li key={cn.id} className="rounded-lg border border-line px-3 py-2">
                  <div className="flex justify-between"><span>{CREDIT_KIND[cn.kind]} · <span className="font-mono">{vnd(cn.amount_vnd)}</span></span>
                    {cn.status === "da_duyet" ? <Badge tone="ok">Đã duyệt</Badge> : cn.status === "huy" ? <Badge>Hủy</Badge> : <Badge tone="warn">Chờ duyệt</Badge>}</div>
                  <div className="text-xs text-muted">{cn.reason}</div>
                  {cn.status === "nhap" && s.can("credit.approve") && cn.created_by !== s.user_id ? <div className="mt-2 flex justify-end"><ActionButton variant="primary" invalidate={[["claim-credits", id]]} onClick={() => q(supabase.rpc("approve_credit_note", { p_id: cn.id }))}>Duyệt</ActionButton></div> : null}
                </li>))}</ul>
              {write ? (
                <Form className="mt-3 grid gap-2" resetOnOk invalidate={[["claim-credits", id]]} onSubmit={async (f) => {
                  const amount = Number(String(f.get("amount") ?? "").replace(/[^\d-]/g, ""));
                  const { error } = await supabase.from("credit_notes").insert({ order_id: c.order_id, claim_id: c.id, kind: f.get("kind"), amount_vnd: amount, reason: String(f.get("reason") ?? "") });
                  return error ? { error: viError(error) } : { ok: true, message: "Đã lập, chờ người khác duyệt (trên ngưỡng cần Admin)." };
                }}>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Loại"><select name="kind" className={inputCls}>{Object.entries(CREDIT_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                    <Field label="Số tiền giảm (đ)"><input name="amount" inputMode="numeric" className={inputCls + " font-mono"} /></Field>
                  </div>
                  <Field label="Lý do"><input name="reason" required minLength={5} className={inputCls} /></Field>
                  <div className="flex justify-end"><Submit>Lập credit note</Submit></div>
                </Form>
              ) : null}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

export default function Page() { return <Suspense fallback={<Skeleton rows={6} />}><Detail /></Suspense>; }
