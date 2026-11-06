"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { PageHeader, Card, Badge, Empty, inputCls, Skeleton } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";

const TABLE: Record<string, string> = {
  "public.customers": "Khách hàng", "public.customer_entities": "Công ty con", "public.customer_contacts": "Liên hệ", "public.customer_users": "Tài khoản khách",
  "public.profiles": "Hồ sơ người dùng", "public.user_roles": "Vai trò", "public.role_permissions": "Phân quyền", "public.staff_customer_assignments": "Phân công CSKH",
  "public.trade_parties": "Đối tác", "public.app_settings": "Cài đặt", "public.orders": "Đơn hàng", "public.order_statements": "Phiếu tính tiền",
  "public.order_statement_lines": "Dòng phiếu tính tiền", "public.bank_receipts": "Tiền vào", "public.receipt_allocations": "Phân bổ tiền",
  "public.supplier_payments": "Thanh toán NCC", "public.fee_rules": "Quy tắc phí", "public.fee_types": "Loại phí", "public.order_costs": "Giá vốn",
};
const ACT = { INSERT: ["Tạo", "ok"], UPDATE: ["Sửa", "warn"], DELETE: ["Xóa", "danger"] } as const;
type Log = { id: number; table_name: string; action: keyof typeof ACT; changed_fields: string[] | null; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; actor_id: string | null; reason: string | null; at: string };

export default function AuditPage() {
  const s = useSession();
  const [t, setT] = useState(""); const [d, setD] = useState("");
  const logs = useQuery({ queryKey: ["audit", t, d], queryFn: () => {
    let x = supabase.from("audit_log_view").select("id, table_name, action, changed_fields, old_data, new_data, actor_id, reason, at").order("at", { ascending: false }).limit(150);
    if (t) x = x.eq("table_name", t);
    if (d) x = x.gte("at", `${d}T00:00:00+07:00`).lt("at", `${d}T23:59:59.999+07:00`);
    return q<Log[]>(x);
  } });
  const actors = useQuery({ queryKey: ["actors"], queryFn: () => q<{ user_id: string; full_name: string }[]>(supabase.from("user_directory").select("user_id, full_name")) });
  if (!s.can("audit.read")) return <Empty title="Bạn không có quyền xem nhật ký" />;
  const who = (id: string | null) => (id ? actors.data?.find((a) => a.user_id === id)?.full_name ?? "Người dùng khác" : "Hệ thống");
  return (
    <>
      <PageHeader eyebrow="Hệ thống" title="Nhật ký hệ thống" desc="Ai, lúc nào, trước – sau, lý do. Không sửa, không xóa được." />
      <Card>
        <div className="mb-4 flex flex-wrap gap-2">
          <select value={t} onChange={(e) => setT(e.target.value)} className={inputCls + " w-auto"}><option value="">Tất cả dữ liệu</option>{Object.entries(TABLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <input type="date" value={d} onChange={(e) => setD(e.target.value)} className={inputCls + " w-auto"} />
        </div>
        {logs.isLoading ? <Skeleton rows={6} /> : (logs.data ?? []).length === 0 ? <Empty title="Không có thay đổi" /> : (
          <ol className="relative space-y-3 border-l border-line pl-5">
            {(logs.data ?? []).map((l) => {
              const [label, tone] = ACT[l.action];
              return (
                <li key={l.id} className="relative">
                  <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand" />
                  <div className="flex flex-wrap items-center gap-2 text-sm"><Badge tone={tone}>{label}</Badge><span className="font-medium">{TABLE[l.table_name] ?? l.table_name}</span>
                    <span className="text-muted">bởi</span><span className="font-medium">{who(l.actor_id)}</span><span className="ml-auto font-mono text-xs text-muted">{fmtDateTime(l.at)}</span></div>
                  {l.reason ? <p className="mt-1 text-xs text-muted">Lý do: {l.reason}</p> : null}
                  {l.changed_fields?.length ? <div className="mt-2 overflow-x-auto rounded-md bg-surface p-2 font-mono text-[11px]">
                    {l.changed_fields.map((f) => <div key={f}><span className="text-muted">{f}:</span> <span className="text-danger line-through">{JSON.stringify(l.old_data?.[f])}</span> → <span className="text-ok">{JSON.stringify(l.new_data?.[f])}</span></div>)}
                  </div> : null}
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </>
  );
}
