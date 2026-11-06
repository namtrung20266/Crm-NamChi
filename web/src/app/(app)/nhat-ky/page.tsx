import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession, can } from "@/lib/session";
import { PageHeader, Card, Badge, Empty, inputCls, btn } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";

const TABLE: Record<string, string> = {
  "public.customers": "Khách hàng", "public.customer_entities": "Công ty con", "public.customer_contacts": "Liên hệ",
  "public.customer_users": "Tài khoản khách", "public.profiles": "Hồ sơ người dùng", "public.user_roles": "Vai trò người dùng",
  "public.role_permissions": "Phân quyền", "public.staff_customer_assignments": "Phân công CSKH", "public.trade_parties": "Đối tác",
  "public.app_settings": "Cài đặt", "public.attachments": "File",
};
const ACT = { INSERT: ["Tạo", "ok"], UPDATE: ["Sửa", "warn"], DELETE: ["Xóa", "danger"] } as const;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ t?: string; d?: string }> }) {
  const s = await getSession();
  if (!can(s, "audit.read")) redirect("/");
  const { t = "", d = "" } = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("audit_log_view").select("id, table_name, row_id, action, changed_fields, old_data, new_data, actor_id, reason, at")
    .order("at", { ascending: false }).limit(150);
  if (t && TABLE[t]) q = q.eq("table_name", t);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) q = q.gte("at", `${d}T00:00:00+07:00`).lt("at", `${d}T23:59:59.999+07:00`);
  const { data } = await q;
  const logs = data ?? [];
  const actorIds = [...new Set(logs.map((l) => l.actor_id).filter(Boolean))] as string[];
  const { data: actors } = actorIds.length ? await supabase.from("user_directory").select("user_id, full_name").in("user_id", actorIds) : { data: [] };
  const who = (id: string | null) => (id ? actors?.find((a) => a.user_id === id)?.full_name ?? "Người dùng khác" : "Hệ thống");

  return (
    <>
      <PageHeader eyebrow="Hệ thống" title="Nhật ký hệ thống" desc="Mọi thay đổi dữ liệu đều được ghi lại: ai, lúc nào, trước – sau, lý do. Nhật ký không sửa, không xóa được." />
      <Card>
        <form className="mb-4 flex flex-wrap gap-2">
          <select name="t" defaultValue={t} className={inputCls + " w-auto"}>
            <option value="">Tất cả dữ liệu</option>
            {Object.entries(TABLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input type="date" name="d" defaultValue={d} className={inputCls + " w-auto"} />
          <button className={btn.secondary}>Lọc</button>
        </form>
        {logs.length === 0 ? <Empty title="Không có thay đổi nào" /> : (
          <ol className="relative space-y-3 border-l border-line pl-5">
            {logs.map((l) => {
              const [label, tone] = ACT[l.action as keyof typeof ACT];
              const fields = (l.changed_fields ?? []) as string[];
              const oldD = (l.old_data ?? {}) as Record<string, unknown>;
              const newD = (l.new_data ?? {}) as Record<string, unknown>;
              return (
                <li key={l.id} className="relative">
                  <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand ring-1 ring-brand/30" />
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone={tone}>{label}</Badge>
                    <span className="font-medium">{TABLE[l.table_name] ?? l.table_name}</span>
                    <span className="text-muted">bởi</span><span className="font-medium">{who(l.actor_id)}</span>
                    <span className="ml-auto font-mono text-xs text-muted">{fmtDateTime(l.at)}</span>
                  </div>
                  {l.reason ? <p className="mt-1 text-xs text-muted">Lý do: {l.reason}</p> : null}
                  {fields.length ? (
                    <div className="mt-2 overflow-x-auto rounded-md bg-surface p-2 font-mono text-[11px]">
                      {fields.map((f) => (
                        <div key={f}><span className="text-muted">{f}:</span> <span className="text-danger line-through">{JSON.stringify(oldD[f])}</span> → <span className="text-ok">{JSON.stringify(newD[f])}</span></div>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </>
  );
}
