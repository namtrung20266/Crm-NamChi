"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { ORDER_STATUS } from "@/lib/status";
import { Card, Badge, Skeleton } from "@/components/ui";
import { vnd, fmtDate } from "@/lib/format";
import { AdminDashboard } from "@/components/admin-dashboard";

type O = { id: string; code: string; status: string; created_at: string; goods_desc: string | null; customer_entities: { legal_name: string } | null };

export default function HomePage() {
  const s = useSession();
  return s.isStaff ? <AdminDashboard /> : <CustomerHome />;
}

function CustomerHome() {
  const s = useSession();
  const showMoney = !s.isStaff || s.can("finance.read");
  const orders = useQuery({ queryKey: ["home-orders"], queryFn: () => q<O[]>(supabase.from("orders").select("id, code, status, created_at, goods_desc, customer_entities(legal_name)").order("created_at", { ascending: false }).limit(400)) });
  const fin = useQuery({ queryKey: ["home-fin"], enabled: showMoney, queryFn: () => q<{ total_vnd: number; paid_vnd: number; remaining_vnd: number }[]>(supabase.from("order_finance").select("total_vnd, paid_vnd, remaining_vnd")) });
  const h = new Date().getHours();
  const hello = h < 12 ? "Chào buổi sáng" : h < 18 ? "Chào buổi chiều" : "Chào buổi tối";
  const O = orders.data ?? [];
  const byStatus = Object.keys(ORDER_STATUS).map((k) => [k, O.filter((o) => o.status === k).length] as const).filter(([, n]) => n > 0);
  const active = O.filter((o) => !["hoan_tat", "huy", "da_giao"].includes(o.status)).length;
  const sum = (k: "total_vnd" | "paid_vnd" | "remaining_vnd") => (fin.data ?? []).reduce((a, r) => a + Number(r[k]), 0);

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl bg-[#0f0d0c] px-6 py-8 text-white sm:px-9">
        <div className="pointer-events-none absolute -right-24 -top-32 h-96 w-96 rounded-full bg-[radial-gradient(closest-side,var(--brand),transparent)] opacity-45" />
        <div className="pointer-events-none absolute inset-0 opacity-[.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:36px_36px]" />
        <p className="relative font-mono text-[11px] uppercase tracking-[0.3em] text-white/50">{s.isStaff ? "Nam Trung · nội bộ" : s.customer?.name}</p>
        <h1 className="relative mt-2 text-2xl font-semibold tracking-tight sm:text-4xl">{hello}, {s.full_name}</h1>
        <p className="relative mt-1 text-sm text-white/60">{s.roles.map((r) => r.name).join(", ")} · {s.isStaff ? (s.can("customer.read_all") ? "xem mọi khách hàng" : "khách được phân công") : s.entity ? s.entity.legal_name : "toàn bộ công ty con"}</p>
        <div className="relative mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[["Đơn đang chạy", String(active)], ["Tổng đơn", String(O.length)], ...(showMoney ? [["Phải thu", vnd(sum("total_vnd"))], ["Còn phải thu", vnd(sum("remaining_vnd"))]] : [])].map(([l, v]) => (
            <div key={l} className="rounded-2xl border border-white/10 bg-white/[.04] p-4 backdrop-blur"><div className="text-[11px] text-white/50">{l}</div><div className="mt-1 font-mono text-lg font-semibold">{v}</div></div>
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <Card title="Đơn theo trạng thái">
          {orders.isLoading ? <Skeleton rows={5} /> : byStatus.length === 0 ? <p className="text-sm text-muted">Chưa có đơn.</p> : (
            <ul className="space-y-2.5">
              {byStatus.map(([k, n]) => (
                <li key={k}>
                  <div className="mb-1 flex justify-between text-sm"><span>{ORDER_STATUS[k].label}</span><span className="font-mono font-semibold">{n}</span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface"><div className="h-full rounded-full bg-brand transition-all duration-700" style={{ width: `${Math.max(4, (n / O.length) * 100)}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Đơn mới nhất" actions={<Link href="/don-hang/" className="text-xs font-semibold text-brand-strong">Tất cả →</Link>}>
          {orders.isLoading ? <Skeleton rows={5} /> : (
            <ul className="divide-y divide-line/70">
              {O.slice(0, 8).map((o) => (
                <li key={o.id}><Link href={`/don-hang/chi-tiet/?id=${o.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-brand-strong">
                  <div className="min-w-0"><div className="font-mono text-sm font-semibold">{o.code}</div><div className="truncate text-xs text-muted">{o.customer_entities?.legal_name} · {o.goods_desc ?? "—"}</div></div>
                  <div className="flex shrink-0 items-center gap-2"><Badge tone={ORDER_STATUS[o.status]?.tone}>{ORDER_STATUS[o.status]?.label}</Badge><span className="hidden text-xs text-muted sm:inline">{fmtDate(o.created_at)}</span></div>
                </Link></li>
              ))}
              {O.length === 0 ? <li className="py-6 text-center text-sm text-muted">Chưa có đơn. {s.can("order.write") || s.can("order.create_own") ? <Link href="/don-hang/moi/" className="font-semibold text-brand-strong">Tạo đơn đầu tiên →</Link> : null}</li> : null}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
