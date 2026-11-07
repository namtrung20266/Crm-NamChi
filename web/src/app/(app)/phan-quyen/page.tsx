"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { PageHeader, Card, Empty, Skeleton } from "@/components/ui";

export default function PermissionsPage() {
  const s = useSession();
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ["perm-matrix"], queryFn: async () => {
    const [roles, perms, rp] = await Promise.all([
      q<{ id: string; code: string; name: string; user_type: string }[]>(supabase.from("roles").select("id, code, name, user_type").order("user_type", { ascending: false }).order("name")),
      q<{ id: string; code: string; module: string; description: string }[]>(supabase.from("permissions").select("id, code, module, description").order("module").order("code")),
      q<{ role_id: string; permission_id: string }[]>(supabase.from("role_permissions").select("role_id, permission_id")),
    ]);
    return { roles, perms, has: new Set(rp.map((x) => `${x.role_id}:${x.permission_id}`)) };
  } });
  if (!s.can("role.manage")) return <Empty title="Bạn không có quyền phân quyền" />;
  if (!data.data) return <Skeleton rows={8} />;
  const { roles, perms, has } = data.data;
  const toggle = async (roleId: string, permId: string, on: boolean) => {
    const r = on
      ? await supabase.from("role_permissions").insert({ role_id: roleId, permission_id: permId })
      : await supabase.from("role_permissions").delete().eq("role_id", roleId).eq("permission_id", permId);
    if (r.error) alert(r.error.message);
    qc.invalidateQueries({ queryKey: ["perm-matrix"] });
  };
  return (
    <>
      <PageHeader eyebrow="Hệ thống" title="Phân quyền" desc="Bấm ô để bật/tắt. Có hiệu lực ngay với mọi tài khoản thuộc vai trò, được ghi nhật ký." />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead><tr className="border-b border-line">
              <th className="sticky left-0 bg-white px-3 py-2 text-left text-xs font-medium uppercase text-muted">Quyền</th>
              {roles.map((r) => <th key={r.id} className={`px-2 py-2 text-center text-xs font-semibold ${r.user_type === "customer" ? "text-[#c81e1e]" : "text-brand-strong"}`}>{r.name}</th>)}
            </tr></thead>
            <tbody>
              {perms.map((p) => (
                <tr key={p.id} className="border-b border-line/70">
                  <td className="sticky left-0 bg-white px-3 py-2.5"><div className="font-medium">{p.description}</div><div className="font-mono text-[12.5px] text-muted">{p.code}</div></td>
                  {roles.map((r) => {
                    const on = has.has(`${r.id}:${p.id}`);
                    const lock = r.code === "admin" && (p.code === "role.manage" || p.code === "user.manage");
                    return <td key={r.id} className="px-2 py-2 text-center">
                      <button disabled={lock} onClick={() => toggle(r.id, p.id, !on)} aria-label={`${on ? "Tắt" : "Bật"} ${p.code} cho ${r.name}`}
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-xs font-bold transition ${on ? "border-brand bg-brand text-white" : "border-line bg-white text-transparent hover:border-brand/50"} ${lock ? "opacity-60" : ""}`}>✓</button>
                    </td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
