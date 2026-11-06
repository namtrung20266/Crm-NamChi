import { createClient } from "@/lib/supabase/server";
import type { SessionContext } from "@/lib/session";
import { Card, DataList, Badge, Empty, Field, inputCls } from "@/components/ui";
import { ActionForm, SubmitButton, ConfirmButton } from "@/components/ui/form";
import { inviteAccount, makeResetLink, toggleActive } from "@/app/(app)/actions";
import { fmtDateTime } from "@/lib/format";

type Entity = { id: string; code: string; legal_name: string };

// Danh sách + mời tài khoản khách. Dùng chung cho màn nội bộ và cổng khách.
export async function AccountsPanel({ session, customerId, entities }: { session: SessionContext; customerId: string; entities: Entity[] }) {
  const supabase = await createClient();
  const { data } = await supabase.from("user_directory")
    .select("user_id, full_name, email, role_names, is_active, last_login_at, entity_id")
    .eq("customer_id", customerId).order("full_name");
  const rows = data ?? [];
  const canInvite = session.permissions.has("customer_user.invite") || session.permissions.has("user.manage");
  const canLock = session.permissions.has("user.manage");
  const entityName = (id: string | null) => (id ? entities.find((e) => e.id === id)?.legal_name ?? "—" : "Toàn bộ công ty con");
  const lockedToEntity = session.userType === "customer" && session.entity;

  return (
    <Card title={`Tài khoản đăng nhập (${rows.length})`}>
      <DataList rows={rows}
        empty={<Empty title="Chưa có tài khoản" desc="Mời tài khoản cho từng công ty con để họ tự theo dõi đơn của mình." />}
        columns={[
          { head: "Họ tên", cell: (r) => <div><div className="font-medium">{r.full_name}</div><div className="text-xs text-muted">{r.email}</div></div> },
          { head: "Phạm vi", cell: (r) => entityName(r.entity_id) },
          { head: "Vai trò", cell: (r) => r.role_names },
          { head: "Đăng nhập gần nhất", cell: (r) => <span className="text-xs text-muted">{fmtDateTime(r.last_login_at)}</span> },
          { head: "", cell: (r) => <RowActions r={r} canInvite={canInvite} canLock={canLock} /> , className: "text-right" },
        ]}
        mobile={(r) => (
          <div>
            <div className="flex items-center justify-between gap-2"><span className="font-medium">{r.full_name}</span>
              {r.is_active ? <Badge tone="ok">Hoạt động</Badge> : <Badge tone="danger">Đã khóa</Badge>}</div>
            <div className="text-xs text-muted">{r.email} · {entityName(r.entity_id)} · {r.role_names}</div>
            <div className="mt-2"><RowActions r={r} canInvite={canInvite} canLock={canLock} /></div>
          </div>
        )} />

      {canInvite ? (
        <div className="mt-6 border-t border-line pt-5">
          <h3 className="mb-3 text-sm font-semibold">Mời tài khoản mới</h3>
          <ActionForm action={inviteAccount} className="grid gap-3 sm:grid-cols-2" resetOnOk>
            <input type="hidden" name="user_type" value="customer" />
            <input type="hidden" name="customer_id" value={customerId} />
            <Field label="Họ tên"><input name="full_name" required className={inputCls} /></Field>
            <Field label="Email đăng nhập"><input name="email" type="email" required className={inputCls} /></Field>
            <Field label="Phạm vi xem dữ liệu">
              <select name="entity_id" className={inputCls} defaultValue={lockedToEntity ? session.entity!.id : ""}>
                {lockedToEntity ? null : <option value="">Toàn bộ công ty con</option>}
                {entities.filter((e) => !lockedToEntity || e.id === session.entity!.id)
                  .map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}
              </select>
            </Field>
            <Field label="Vai trò">
              <select name="role_code" className={inputCls} defaultValue="cust_member">
                <option value="cust_member">Thành viên (xem, đặt hàng)</option>
                <option value="cust_admin">Quản trị (được mời thêm người)</option>
              </select>
            </Field>
            <div className="sm:col-span-2 flex justify-end"><SubmitButton>Tạo tài khoản &amp; lấy link</SubmitButton></div>
          </ActionForm>
        </div>
      ) : null}
    </Card>
  );
}

function RowActions({ r, canInvite, canLock }: { r: { user_id: string; is_active: boolean }; canInvite: boolean; canLock: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-end gap-2">
      {canInvite && r.is_active ? (
        <ActionForm action={makeResetLink} className="flex flex-col items-end gap-2">
          <input type="hidden" name="user_id" value={r.user_id} />
          <SubmitButton variant="secondary">Link đặt mật khẩu</SubmitButton>
        </ActionForm>
      ) : null}
      {canLock ? (
        <form action={toggleActive}>
          <input type="hidden" name="user_id" value={r.user_id} />
          <input type="hidden" name="active" value={String(!r.is_active)} />
          <ConfirmButton variant={r.is_active ? "danger" : "secondary"} message={r.is_active ? "Khóa tài khoản này? Người dùng sẽ bị đăng xuất khỏi hệ thống." : "Mở khóa tài khoản này?"}>
            {r.is_active ? "Khóa" : "Mở khóa"}
          </ConfirmButton>
        </form>
      ) : !r.is_active ? <Badge tone="danger">Đã khóa</Badge> : null}
    </div>
  );
}
