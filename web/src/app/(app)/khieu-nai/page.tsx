"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { CLAIM_STATUS, CLAIM_TYPE } from "@/lib/status";
import { PageHeader, Card, Badge, Empty, Field, inputCls, Skeleton } from "@/components/ui";
import { Form, Submit } from "@/components/ui/form";
import { fmtDate, vnd } from "@/lib/format";
import { viError } from "@/lib/errors";

type Claim = { id: string; code: string; order_id: string; claim_type: string; description: string; requested_vnd: number | null; status: string; due_date: string | null; created_at: string; orders: { code: string; customer_entities: { legal_name: string } | null } | null };

export default function ClaimsPage() {
  const s = useSession();
  const router = useRouter();
  const claims = useQuery({ queryKey: ["claims"], queryFn: () => q<Claim[]>(supabase.from("claims").select("*, orders(code, customer_entities(legal_name))").order("created_at", { ascending: false }).limit(300)) });
  const orders = useQuery({ queryKey: ["claim-orders"], queryFn: () => q<{ id: string; code: string; customer_entities: { legal_name: string } | null }[]>(supabase.from("orders").select("id, code, customer_entities(legal_name)").order("created_at", { ascending: false }).limit(300)) });
  const canCreate = s.can("claim.write") || s.can("claim.create_own");
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader eyebrow="Chăm sóc khách hàng" title="Khiếu nại" desc="Luồng riêng, không chặn đơn. Bồi thường phải qua credit note được duyệt mới trừ công nợ." />
      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          {claims.isLoading ? <Skeleton /> : (claims.data ?? []).length === 0 ? <Empty title="Chưa có khiếu nại" /> : (
            <ul className="divide-y divide-line/70">{(claims.data ?? []).map((c) => {
              const late = c.due_date && c.due_date < today && !["da_giai_quyet", "dong", "tu_choi"].includes(c.status);
              return (
                <li key={c.id}><Link href={`/khieu-nai/chi-tiet/?id=${c.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:text-brand-strong">
                  <div className="min-w-0"><div><span className="font-mono font-semibold">{c.code}</span> · {CLAIM_TYPE[c.claim_type]} · <span className="font-mono text-sm">{c.orders?.code}</span></div>
                    <div className="truncate text-xs text-muted">{c.orders?.customer_entities?.legal_name} · {c.description}</div></div>
                  <div className="flex items-center gap-2">{c.requested_vnd ? <span className="font-mono text-xs">{vnd(c.requested_vnd)}</span> : null}{late ? <Badge tone="danger">Quá hạn {fmtDate(c.due_date)}</Badge> : null}<Badge tone={CLAIM_STATUS[c.status].tone}>{CLAIM_STATUS[c.status].label}</Badge></div>
                </Link></li>);
            })}</ul>
          )}
        </Card>
        {canCreate ? (
          <Card title="Tạo khiếu nại">
            <Form onSubmit={async (f) => {
              const req = String(f.get("req") ?? "").replace(/\D/g, "");
              const { data, error } = await supabase.from("claims").insert({ order_id: f.get("order"), claim_type: f.get("type"), description: String(f.get("desc") ?? "").trim(), requested_vnd: req ? Number(req) : null }).select("id").single();
              if (error) return { error: viError(error) };
              router.push(`/khieu-nai/chi-tiet/?id=${data.id}`);
            }}>
              <Field label="Đơn hàng"><select name="order" className={inputCls}>{(orders.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.code} · {o.customer_entities?.legal_name}</option>)}</select></Field>
              <Field label="Loại"><select name="type" className={inputCls}>{Object.entries(CLAIM_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="Mô tả"><textarea name="desc" required rows={3} className={inputCls + " h-auto py-2"} /></Field>
              <Field label="Đề nghị bồi thường (đ)"><input name="req" inputMode="numeric" className={inputCls + " font-mono"} /></Field>
              <div className="flex justify-end"><Submit>Gửi khiếu nại</Submit></div>
            </Form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
