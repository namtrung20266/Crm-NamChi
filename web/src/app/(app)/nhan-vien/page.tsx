"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { useStaff } from "@/lib/data";
import { inviteUser, resetLink } from "@/lib/user-admin";
import { PageHeader, Card, DataList, Badge, Empty, Field, inputCls, Skeleton } from "@/components/ui";
import { Form, Submit, ActionButton, CopyLink } from "@/components/ui/form";
import { fmtDateTime } from "@/lib/format";

export default function StaffPage() {
  const s = useSession();
  const staff = useStaff();
  const roles = useQuery({ queryKey: ["roles", "staff"], queryFn: () => q<{ code: string; name: string }[]>(supabase.from("roles").select("code, name").eq("user_type", "staff").order("name")) });
  const [link, setLink] = useState<string | null>(null);
  if (!s.can("user.manage")) return <Empty title="Bạn không có quyền quản lý nhân viên" />;
  type R = NonNullable<typeof staff.data>[number];

  const RoleSelect = ({ r }: { r: R }) => (
    <select defaultValue={r.role_code ?? ""} disabled={r.user_id === s.user_id} className={inputCls + " h-8 w-44 text-xs"}
      onChange={async (e) => {
        const { error } = await supabase.rpc("set_staff_role", { p_user_id: r.user_id, p_role_code: e.target.value, p_reason: "Đổi vai trò" });
        if (error) alert(error.message); else staff.refetch();
      }}>
      {(roles.data ?? []).map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
    </select>
  );
  const Actions = ({ r }: { r: R }) => (
    <div className="flex flex-wrap justify-end gap-2">
      {r.is_active ? <ActionButton onClick={async () => { const x = await resetLink(r.user_id); if (!x.ok) throw new Error(x.error); setLink(x.link); }}>Link đặt mật khẩu</ActionButton> : null}
      {r.user_id !== s.user_id ? <ActionButton variant={r.is_active ? "danger" : "secondary"} invalidate={[["staff"]]} confirmText={r.is_active ? "Khóa tài khoản này?" : "Mở khóa?"}
        onClick={() => q(supabase.rpc("set_user_active", { p_user_id: r.user_id, p_active: !r.is_active, p_reason: r.is_active ? "Khóa tài khoản" : "Mở khóa tài khoản" }))}>{r.is_active ? "Khóa" : "Mở khóa"}</ActionButton> : null}
    </div>
  );

  return (
    <>
      <PageHeader eyebrow="Hệ thống" title="Nhân viên & vai trò" desc="Đổi vai trò có hiệu lực ngay và được ghi nhật ký." />
      {link ? <div className="mb-4"><CopyLink link={link} /></div> : null}
      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card title={`Nhân viên (${staff.data?.length ?? 0})`}>
          {staff.isLoading ? <Skeleton /> : (
            <DataList rows={staff.data ?? []} empty={<Empty title="Chưa có nhân viên" />}
              columns={[
                { head: "Họ tên", cell: (r) => <div><div className="font-medium">{r.full_name} {r.is_active ? null : <Badge tone="danger">Đã khóa</Badge>}</div><div className="text-xs text-muted">{r.email}</div></div> },
                { head: "Vai trò", cell: (r) => <RoleSelect r={r} /> },
                { head: "Đăng nhập gần nhất", cell: (r) => <span className="text-xs text-muted">{fmtDateTime(r.last_login_at)}</span> },
                { head: "", cell: (r) => <Actions r={r} />, className: "text-right" },
              ]}
              mobile={(r) => <div className="space-y-2"><div className="font-medium">{r.full_name}</div><RoleSelect r={r} /><Actions r={r} /></div>} />
          )}
        </Card>
        <Card title="Thêm nhân viên">
          <Form resetOnOk invalidate={[["staff"]]} onSubmit={async (f) => {
            const r = await inviteUser({ email: String(f.get("email") ?? ""), full_name: String(f.get("full_name") ?? ""), user_type: "staff", role_code: String(f.get("role_code") ?? "cs") });
            return r.ok ? { ok: true, message: `Đã tạo tài khoản ${r.email}.`, link: r.link } : { error: r.error };
          }}>
            <Field label="Họ tên"><input name="full_name" required className={inputCls} /></Field>
            <Field label="Email đăng nhập"><input name="email" type="email" required className={inputCls} /></Field>
            <Field label="Vai trò"><select name="role_code" className={inputCls} defaultValue="cs">{(roles.data ?? []).map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></Field>
            <div className="flex justify-end"><Submit>Tạo tài khoản &amp; lấy link</Submit></div>
          </Form>
          <p className="mt-4 text-xs text-muted">Hệ thống không gửi email. Chép link gửi cho nhân viên để họ tự đặt mật khẩu.</p>
        </Card>
      </div>
    </>
  );
}
