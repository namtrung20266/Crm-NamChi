"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import type { Entity } from "@/lib/data";
import { inviteUser, resetLink } from "@/lib/user-admin";
import { Card, DataList, Badge, Empty, Field, inputCls, Skeleton } from "@/components/ui";
import { Form, Submit, ActionButton, CopyLink } from "@/components/ui/form";
import { fmtDateTime } from "@/lib/format";
import { useState } from "react";

type Row = { user_id: string; full_name: string; email: string; role_names: string; is_active: boolean; last_login_at: string | null; entity_id: string | null };

export function AccountsPanel({ customerId, entities }: { customerId: string; entities: Entity[] }) {
  const s = useSession();
  const key = ["accounts", customerId];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => q<Row[]>(
    supabase.from("user_directory").select("user_id, full_name, email, role_names, is_active, last_login_at, entity_id").eq("customer_id", customerId).order("full_name")) });
  const canInvite = s.can("customer_user.invite") || s.can("user.manage");
  const canLock = s.can("user.manage");
  const lockedEntity = !s.isStaff && s.entity ? s.entity.id : null;
  const entName = (id: string | null) => (id ? entities.find((e) => e.id === id)?.legal_name ?? "—" : "Toàn bộ công ty con");
  const [link, setLink] = useState<string | null>(null);

  const Actions = ({ r }: { r: Row }) => (
    <div className="flex flex-wrap justify-end gap-2">
      {canInvite && r.is_active ? <ActionButton onClick={async () => { const x = await resetLink(r.user_id); if (!x.ok) throw new Error(x.error); setLink(x.link); }}>Link đặt mật khẩu</ActionButton> : null}
      {canLock ? (
        <ActionButton variant={r.is_active ? "danger" : "secondary"} invalidate={[key]}
          confirmText={r.is_active ? "Khóa tài khoản này?" : "Mở khóa tài khoản này?"}
          onClick={() => q(supabase.rpc("set_user_active", { p_user_id: r.user_id, p_active: !r.is_active, p_reason: r.is_active ? "Khóa tài khoản" : "Mở khóa tài khoản" }))}>
          {r.is_active ? "Khóa" : "Mở khóa"}
        </ActionButton>
      ) : !r.is_active ? <Badge tone="danger">Đã khóa</Badge> : null}
    </div>
  );

  return (
    <Card title={`Tài khoản đăng nhập (${data?.length ?? 0})`}>
      {link ? <div className="mb-4"><CopyLink link={link} /></div> : null}
      {isLoading ? <Skeleton rows={2} /> : (
        <DataList rows={data ?? []} empty={<Empty title="Chưa có tài khoản" desc="Mời tài khoản cho từng công ty con." />}
          columns={[
            { head: "Họ tên", cell: (r) => <div><div className="font-medium">{r.full_name}</div><div className="text-xs text-muted">{r.email}</div></div> },
            { head: "Phạm vi", cell: (r) => entName(r.entity_id) },
            { head: "Vai trò", cell: (r) => r.role_names },
            { head: "Đăng nhập gần nhất", cell: (r) => <span className="text-xs text-muted">{fmtDateTime(r.last_login_at)}</span> },
            { head: "", cell: (r) => <Actions r={r} />, className: "text-right" },
          ]}
          mobile={(r) => <div className="space-y-2"><div className="font-medium">{r.full_name}</div><div className="text-xs text-muted">{r.email} · {entName(r.entity_id)}</div><Actions r={r} /></div>} />
      )}
      {canInvite ? (
        <div className="mt-6 border-t border-line pt-5">
          <h3 className="mb-3 text-sm font-semibold">Mời tài khoản mới</h3>
          <Form className="grid gap-3 sm:grid-cols-2" resetOnOk invalidate={[key]} onSubmit={async (f) => {
            const r = await inviteUser({
              email: String(f.get("email") ?? ""), full_name: String(f.get("full_name") ?? ""), user_type: "customer",
              role_code: String(f.get("role_code") ?? "cust_member"), customer_id: customerId, entity_id: String(f.get("entity_id") ?? "") || null,
            });
            return r.ok ? { ok: true, message: `Đã tạo tài khoản ${r.email}.`, link: r.link } : { error: r.error };
          }}>
            <Field label="Họ tên"><input name="full_name" required className={inputCls} /></Field>
            <Field label="Email đăng nhập"><input name="email" type="email" required className={inputCls} /></Field>
            <Field label="Phạm vi xem dữ liệu">
              <select name="entity_id" className={inputCls} defaultValue={lockedEntity ?? ""}>
                {lockedEntity ? null : <option value="">Toàn bộ công ty con</option>}
                {entities.filter((e) => !lockedEntity || e.id === lockedEntity).map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}
              </select>
            </Field>
            <Field label="Vai trò">
              <select name="role_code" className={inputCls} defaultValue="cust_member">
                <option value="cust_member">Thành viên</option><option value="cust_admin">Quản trị (mời thêm người)</option>
              </select>
            </Field>
            <div className="flex justify-end sm:col-span-2"><Submit>Tạo tài khoản &amp; lấy link</Submit></div>
          </Form>
        </div>
      ) : null}
    </Card>
  );
}
