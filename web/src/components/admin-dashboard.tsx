"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/session";
import { useCustomers, useEntities } from "@/lib/data";
import { rpc, PHASES, type Tone } from "@/lib/meta";
import { Card, Badge, Skeleton, inputCls } from "./ui";
import { AdminOrderTable } from "./admin-orders";
import { RecentChat } from "./recent-chat";
import { vnd, fmtNumber } from "@/lib/format";

type Dash = {
  period: { from: string; to: string };
  kpi: Record<string, number>;
  money: Record<string, number> | null;
  profit: { revenue_ex_vat: number; cost: number; profit: number; orders_missing_cost: number; orders_counted: number } | null;
  by_status: { code: string; label: string; tone: Tone; phase: string; rank: number; count: number; overdue: number }[];
  by_entity: { entity_id: string; code: string; legal_name: string; customer_code: string; orders: number; active: number; new_period: number; revenue_period: number | null; receivable: number | null; wallet: number | null }[];
  by_cs: { name: string; user_id: string | null; active: number; overdue: number; new_period: number }[];
  trend: { week: string; orders: number; goods_cny: number; revenue: number | null }[];
  alerts: { severity: number; type: string; order_id: string; code: string; entity: string; text: string }[];
};

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
function preset(k: string): [string, string] {
  const n = new Date();
  if (k === "30d") return [iso(new Date(n.getTime() - 29 * 864e5)), iso(n)];
  if (k === "quarter") return [iso(new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3, 1)), iso(n)];
  if (k === "year") return [iso(new Date(n.getFullYear(), 0, 1)), iso(n)];
  if (k === "lastmonth") return [iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), iso(new Date(n.getFullYear(), n.getMonth(), 0))];
  return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), iso(n)];
}
const TONE_BG: Record<Tone, string> = { neutral: "bg-stone-300", brand: "bg-brand", warn: "bg-amber-400", ok: "bg-emerald-500", danger: "bg-danger", info: "bg-blue-500" };
const ALERT: Record<string, string> = { qua_han: "⏰", chua_thu_du_da_giao: "💸", chua_bao_gia: "🧾", thieu_hd: "📄", thieu_gia_von: "⚠️" };

function Kpi({ label, value, sub, tone = "ink", href }: { label: string; value: string; sub?: string; tone?: "ink" | "danger" | "ok" | "brand"; href?: string }) {
  const c = { ink: "text-ink", danger: "text-danger", ok: "text-ok", brand: "text-brand-strong" }[tone];
  const body = (
    <div className="card h-full p-4 transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="text-[13px] font-medium text-muted">{label}</div>
      <div className={`mt-1 font-mono text-xl font-semibold tracking-tight ${c}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-[12.5px] text-muted">{sub}</div> : null}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function AdminDashboard() {
  const s = useSession();
  const [p, setP] = useState("month");
  const [range, setRange] = useState<[string, string]>(preset("month"));
  const [cust, setCust] = useState("");
  const [ent, setEnt] = useState("");
  const customers = useCustomers();
  const ents = useEntities(cust || null);
  const d = useQuery({ queryKey: ["dashboard", range, cust, ent], refetchInterval: 120_000,
    queryFn: () => rpc<Dash>("admin_dashboard", { p_from: range[0], p_to: range[1], p_customer_id: cust || null, p_entity_id: ent || null }) });
  const x = d.data;
  const maxStatus = Math.max(1, ...(x?.by_status ?? []).filter((b) => !["hoan_tat", "huy"].includes(b.code)).map((b) => b.count));
  const maxTrend = Math.max(1, ...(x?.trend ?? []).map((t) => t.orders));
  const maxRev = Math.max(1, ...(x?.trend ?? []).map((t) => t.revenue ?? 0));
  const margin = x?.profit && x.profit.revenue_ex_vat > 0 ? (x.profit.profit / x.profit.revenue_ex_vat) * 100 : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-[12.5px] uppercase tracking-[0.22em] text-brand">Nam Trung · quản trị</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Dashboard vận hành</h1>
          <p className="text-sm text-muted">{s.full_name} · số liệu từ hệ thống, tự làm mới 2 phút/lần</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-white p-0.5 ring-1 ring-line">
            {[["month", "Tháng này"], ["lastmonth", "Tháng trước"], ["30d", "30 ngày"], ["quarter", "Quý"], ["year", "Năm"]].map(([k, v]) => (
              <button key={k} onClick={() => { setP(k); setRange(preset(k)); }} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${p === k ? "bg-ink text-white" : "text-muted hover:text-ink"}`}>{v}</button>
            ))}
          </div>
          <input type="date" value={range[0]} onChange={(e) => { setP(""); setRange([e.target.value, range[1]]); }} className={inputCls + " h-9 w-[140px]"} />
          <input type="date" value={range[1]} onChange={(e) => { setP(""); setRange([range[0], e.target.value]); }} className={inputCls + " h-9 w-[140px]"} />
          <select value={cust} onChange={(e) => { setCust(e.target.value); setEnt(""); }} className={inputCls + " h-9 w-auto"}>
            <option value="">Mọi khách</option>{(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </select>
          <select value={ent} onChange={(e) => setEnt(e.target.value)} className={inputCls + " h-9 w-auto"}>
            <option value="">Mọi công ty con</option>{(ents.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}
          </select>
        </div>
      </div>

      {d.isLoading || !x ? <Skeleton rows={8} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Kpi label="Đơn mới trong kỳ" value={fmtNumber(x.kpi.orders_new)} sub={`${fmtNumber(x.kpi.goods_cny_period)} tệ tiền hàng`} href="/don-hang/" />
            <Kpi label="Đơn đang chạy" value={fmtNumber(x.kpi.orders_active)} sub={`${fmtNumber(x.kpi.packages_active)} kiện · ${fmtNumber(x.kpi.weight_kg_active)} kg`} />
            <Kpi label="Quá hạn xử lý" value={fmtNumber(x.kpi.orders_overdue)} sub={`Tạm giữ ${x.kpi.orders_hold}`} tone={x.kpi.orders_overdue ? "danger" : "ok"} />
            <Kpi label="Hoàn tất trong kỳ" value={fmtNumber(x.kpi.orders_done_period)} sub={`Nháp của khách ${x.kpi.orders_draft}`} tone="ok" />
            {x.money ? <>
              <Kpi label="Doanh thu kỳ (phiếu)" value={vnd(x.money.revenue_period)} sub={`Nạp ví kỳ ${vnd(x.money.topups_period_vnd)}`} tone="brand" />
              <Kpi label="Còn phải thu" value={vnd(x.money.receivable)} sub={`Hàng đã về: ${vnd(x.money.receivable_delivered)}`} tone="danger" />
              <Kpi label="Chờ khách cọc" value={vnd(x.money.deposit_waiting)} sub={`${x.money.quotes_waiting} báo giá chờ xác nhận`} />
              <Kpi label="Số dư ví khách" value={vnd(x.money.wallet_total)} sub={x.money.overpaid ? `Trả thừa ${vnd(x.money.overpaid)}` : "Tiền khách đang gửi"} />
              <Kpi label="Nạp ví chờ duyệt" value={fmtNumber(x.money.topups_pending)} sub={vnd(x.money.topups_pending_vnd)} tone={x.money.topups_pending ? "danger" : "ink"} href="/vi/" />
            </> : null}
            {x.profit ? <>
              <Kpi label="Lợi nhuận gộp kỳ" value={vnd(x.profit.profit)} sub={margin != null ? `Biên ${margin.toFixed(1)}% trên ${vnd(x.profit.revenue_ex_vat)}` : "Chưa có phiếu"} tone="ok" />
              <Kpi label="Đơn thiếu giá vốn" value={fmtNumber(x.profit.orders_missing_cost)} sub={`/${x.profit.orders_counted} đơn có phiếu`} tone={x.profit.orders_missing_cost ? "danger" : "ok"} />
            </> : null}
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.1fr_1fr_1fr]">
            <Card title="Đơn đang ở đâu" actions={<span className="text-xs text-muted">đỏ = quá hạn SLA của bước</span>}>
              <div className="space-y-4">
                {Object.entries(PHASES).filter(([k]) => k !== "ket_thuc").map(([ph, label]) => {
                  const st = x.by_status.filter((b) => b.phase === ph);
                  if (!st.some((b) => b.count)) return null;
                  return (
                    <div key={ph}>
                      <div className="mb-1.5 text-[12.5px] font-semibold uppercase tracking-wider text-muted">{label} · {st.reduce((a, b) => a + b.count, 0)}</div>
                      <ul className="space-y-1.5">
                        {st.filter((b) => b.count > 0).map((b) => (
                          <li key={b.code} className="grid grid-cols-[150px_1fr_56px] items-center gap-2 text-[14px]">
                            <span className="truncate">{b.label}</span>
                            <span className="flex h-2.5 overflow-hidden rounded-full bg-surface">
                              <span className={TONE_BG[b.tone]} style={{ width: `${((b.count - b.overdue) / maxStatus) * 100}%` }} />
                              <span className="bg-danger" style={{ width: `${(b.overdue / maxStatus) * 100}%` }} />
                            </span>
                            <span className="text-right font-mono font-semibold">{b.count}{b.overdue ? <span className="text-danger"> ·{b.overdue}</span> : null}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
                {!x.by_status.some((b) => b.count) ? <p className="text-sm text-muted">Chưa có đơn.</p> : null}
              </div>
            </Card>

            <RecentChat height={420} />
            <Card title={`Cần xử lý (${x.alerts.length})`}>
              {x.alerts.length === 0 ? <p className="text-sm text-ok">Không có cảnh báo. Mọi đơn đang đúng tiến độ.</p> : (
                <ul className="max-h-[420px] divide-y divide-line/70 overflow-y-auto">
                  {x.alerts.map((a, i) => (
                    <li key={i}><Link href={`/don-hang/chi-tiet/?id=${a.order_id}`} className="flex gap-2.5 py-2 text-[14px] hover:text-brand-strong">
                      <span>{ALERT[a.type] ?? "•"}</span>
                      <span className="min-w-0 flex-1"><span className="font-mono font-semibold">{a.code}</span> <span className="text-muted">· {a.entity}</span><span className="block text-xs text-ink/80">{a.text}</span></span>
                      <Badge tone={a.severity === 1 ? "danger" : a.severity === 2 ? "warn" : "neutral"}>{a.severity === 1 ? "Gấp" : a.severity === 2 ? "Cần làm" : "Theo dõi"}</Badge>
                    </Link></li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
            <Card title="Xu hướng 12 tuần" actions={<span className="text-xs text-muted">cột = số đơn{x.money ? " · đường = phải thu" : ""}</span>}>
              <div className="relative h-48">
                <div className="absolute inset-0 flex items-end gap-1.5">
                  {x.trend.map((t) => (
                    <div key={t.week} className="group relative flex h-full flex-1 flex-col justify-end">
                      <div className="rounded-t bg-brand/80 transition group-hover:bg-brand" style={{ height: `${(t.orders / maxTrend) * 85}%`, minHeight: t.orders ? 4 : 0 }} />
                      <div className="mt-1 text-center font-mono text-[11px] text-muted">{t.week}</div>
                      <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink px-2 py-1 text-[12.5px] text-white group-hover:block">
                        {t.orders} đơn · {fmtNumber(t.goods_cny)} tệ{t.revenue != null ? ` · ${vnd(t.revenue)}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
                {x.money ? (
                  <svg className="pointer-events-none absolute inset-0 h-[calc(100%-16px)] w-full" viewBox={`0 0 ${x.trend.length * 10} 100`} preserveAspectRatio="none">
                    <polyline fill="none" stroke="currentColor" className="text-ink/70" strokeWidth="0.8" vectorEffect="non-scaling-stroke"
                      points={x.trend.map((t, i) => `${i * 10 + 5},${100 - ((t.revenue ?? 0) / maxRev) * 85}`).join(" ")} />
                  </svg>
                ) : null}
              </div>
            </Card>
            <Card title="Theo CSKH phụ trách">
              <table className="w-full text-[14px]">
                <thead><tr className="text-left text-[12.5px] uppercase text-muted"><th className="pb-2">Nhân viên</th><th className="pb-2 text-right">Đang chạy</th><th className="pb-2 text-right">Quá hạn</th><th className="pb-2 text-right">Mới kỳ</th></tr></thead>
                <tbody>{x.by_cs.map((c) => (
                  <tr key={c.user_id ?? "none"} className="border-t border-line/70"><td className={`py-1.5 ${c.user_id ? "" : "text-danger"}`}>{c.name}</td><td className="text-right font-mono">{c.active}</td>
                    <td className={`text-right font-mono ${c.overdue ? "font-semibold text-danger" : ""}`}>{c.overdue}</td><td className="text-right font-mono">{c.new_period}</td></tr>
                ))}</tbody>
              </table>
            </Card>
          </div>

          <Card title="Theo công ty con (khách vận hành)">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[14px]">
                <thead><tr className="text-left text-[12.5px] uppercase text-muted"><th className="pb-2">Công ty</th><th className="pb-2 text-right">Tổng đơn</th><th className="pb-2 text-right">Đang chạy</th><th className="pb-2 text-right">Mới kỳ</th>
                  {x.money ? <><th className="pb-2 text-right">Doanh thu kỳ</th><th className="pb-2 text-right">Còn phải thu</th><th className="pb-2 text-right">Số dư ví</th></> : null}</tr></thead>
                <tbody>{x.by_entity.map((e) => (
                  <tr key={e.entity_id} className="border-t border-line/70 hover:bg-surface">
                    <td className="py-2"><button onClick={() => { setEnt(e.entity_id); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="text-left font-medium hover:text-brand-strong">{e.legal_name}</button><div className="font-mono text-[12px] text-muted">{e.customer_code} · {e.code}</div></td>
                    <td className="text-right font-mono">{e.orders}</td><td className="text-right font-mono">{e.active}</td><td className="text-right font-mono">{e.new_period}</td>
                    {x.money ? <><td className="text-right font-mono">{vnd(e.revenue_period)}</td><td className={`text-right font-mono ${Number(e.receivable) > 0 ? "text-danger" : ""}`}>{vnd(e.receivable)}</td>
                      <td className={`text-right font-mono ${Number(e.wallet) < 0 ? "text-danger" : "text-ok"}`}>{vnd(e.wallet)}</td></> : null}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <Card title="Chi tiết toàn bộ đơn hàng">
        <AdminOrderTable />
      </Card>
    </div>
  );
}
