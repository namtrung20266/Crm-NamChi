import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession, can } from "@/lib/session";
import { PageHeader, Card } from "@/components/ui";
import { togglePermission } from "../actions";

const MODULE = { customer: "Khách hàng", system: "Hệ thống", file: "File", finance: "Tài chính" } as Record<string, string>;

export default async function PermissionsPage() {
  const s = await getSession();
  if (!can(s, "role.manage")) redirect("/");
  const supabase = await createClient();
  const [{ data: roles }, { data: perms }, { data: rp }] = await Promise.all([
    supabase.from("roles").select("id, code, name, user_type").order("user_type", { ascending: false }).order("name"),
    supabase.from("permissions").select("id, code, module, description").order("module").order("code"),
    supabase.from("role_permissions").select("role_id, permission_id"),
  ]);
  const has = new Set((rp ?? []).map((x) => `${x.role_id}:${x.permission_id}`));

  return (
    <>
      <PageHeader eyebrow="Hệ thống" title="Phân quyền" desc="Bấm ô để bật/tắt quyền cho vai trò. Thay đổi có hiệu lực ngay với mọi tài khoản thuộc vai trò đó và được ghi nhật ký." />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="sticky left-0 bg-white px-3 py-2 text-left text-xs font-medium uppercase text-muted">Quyền</th>
                {(roles ?? []).map((r) => (
                  <th key={r.id} className="px-2 py-2 text-center text-xs font-semibold">
                    <div className={r.user_type === "customer" ? "text-[#c81e1e]" : "text-brand-strong"}>{r.name}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(perms ?? []).map((p) => (
                <tr key={p.id} className="border-b border-line/70">
                  <td className="sticky left-0 bg-white px-3 py-2.5">
                    <div className="font-medium">{p.description}</div>
                    <div className="font-mono text-[11px] text-muted">{MODULE[p.module] ?? p.module} · {p.code}</div>
                  </td>
                  {(roles ?? []).map((r) => {
                    const on = has.has(`${r.id}:${p.id}`);
                    const lockSelf = r.code === "admin" && (p.code === "role.manage" || p.code === "user.manage");
                    return (
                      <td key={r.id} className="px-2 py-2 text-center">
                        <form action={togglePermission}>
                          <input type="hidden" name="role_id" value={r.id} /><input type="hidden" name="permission_id" value={p.id} />
                          <input type="hidden" name="on" value={String(!on)} />
                          <button disabled={lockSelf} aria-label={`${on ? "Tắt" : "Bật"} ${p.code} cho ${r.name}`}
                            className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-xs font-bold transition ${on ? "border-brand bg-brand text-white" : "border-line bg-white text-transparent hover:border-brand/50"} ${lockSelf ? "opacity-60" : ""}`}>
                            ✓
                          </button>
                        </form>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-muted">Quyền quản lý người dùng và phân quyền của Admin bị khóa để tránh tự khóa mình khỏi hệ thống.</p>
      </Card>
    </>
  );
}
