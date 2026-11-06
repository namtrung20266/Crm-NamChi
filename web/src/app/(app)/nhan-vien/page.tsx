import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession, can } from "@/lib/session";
import { PageHeader, Card, DataList, Badge, Empty, Field, inputCls, btn } from "@/components/ui";
import { ActionForm, SubmitButton, ConfirmButton } from "@/components/ui/form";
import { inviteAccount, makeResetLink, toggleActive, changeStaffRole } from "../actions";
import { fmtDateTime } from "@/lib/format";

export default async function StaffPage() {
  const s = await getSession();
  if (!can(s, "user.manage")) redirect("/");
  const supabase = await createClient();
  const [{ data: staff }, { data: roles }] = await Promise.all([
    supabase.from("user_directory").select("user_id, full_name, email, role_code, role_names, is_active, last_login_at").eq("user_type", "staff").order("full_name"),
    supabase.from("roles").select("code, name").eq("user_type", "staff").order("name"),
  ]);
  const rows = staff ?? [];

  const RoleSelect = ({ r }: { r: (typeof rows)[number] }) => (
    <form action={changeStaffRole} className="flex gap-1.5">
      <input type="hidden" name="user_id" value={r.user_id} />
      <select name="role_code" defaultValue={r.role_code ?? ""} className={inputCls + " h-8 w-40 text-xs"} disabled={r.user_id === s.userId}>
        {(roles ?? []).map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
      </select>
      {r.user_id === s.userId ? null : <button className={btn.secondary + " h-8 px-2.5 text-xs"}>Lưu</button>}
    </form>
  );
  const Actions = ({ r }: { r: (typeof rows)[number] }) => (
    <div className="flex flex-wrap justify-end gap-2">
      {r.is_active ? (
        <ActionForm action={makeResetLink} className="flex flex-col items-end gap-2">
          <input type="hidden" name="user_id" value={r.user_id} />
          <SubmitButton variant="secondary">Link đặt mật khẩu</SubmitButton>
        </ActionForm>
      ) : null}
      {r.user_id !== s.userId ? (
        <form action={toggleActive}>
          <input type="hidden" name="user_id" value={r.user_id} /><input type="hidden" name="active" value={String(!r.is_active)} />
          <ConfirmButton variant={r.is_active ? "danger" : "secondary"} message={r.is_active ? "Khóa tài khoản nhân viên này?" : "Mở khóa tài khoản này?"}>{r.is_active ? "Khóa" : "Mở khóa"}</ConfirmButton>
        </form>
      ) : null}
    </div>
  );

  return (
    <>
      <PageHeader eyebrow="Hệ thống" title="Nhân viên & vai trò" desc="Mỗi nhân viên một vai trò chính. Đổi vai trò có hiệu lực ngay và được ghi nhật ký." />
      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card title={`Nhân viên (${rows.length})`}>
          <DataList rows={rows} empty={<Empty title="Chưa có nhân viên" />}
            columns={[
              { head: "Họ tên", cell: (r) => <div><div className="font-medium">{r.full_name} {r.is_active ? null : <Badge tone="danger">Đã khóa</Badge>}</div><div className="text-xs text-muted">{r.email}</div></div> },
              { head: "Vai trò", cell: (r) => <RoleSelect r={r} /> },
              { head: "Đăng nhập gần nhất", cell: (r) => <span className="text-xs text-muted">{fmtDateTime(r.last_login_at)}</span> },
              { head: "", cell: (r) => <Actions r={r} />, className: "text-right" },
            ]}
            mobile={(r) => (
              <div className="space-y-2">
                <div><span className="font-medium">{r.full_name}</span> {r.is_active ? null : <Badge tone="danger">Đã khóa</Badge>}<div className="text-xs text-muted">{r.email}</div></div>
                <RoleSelect r={r} /><Actions r={r} />
              </div>
            )} />
        </Card>
        <Card title="Thêm nhân viên">
          <ActionForm action={inviteAccount} resetOnOk>
            <input type="hidden" name="user_type" value="staff" />
            <Field label="Họ tên"><input name="full_name" required className={inputCls} /></Field>
            <Field label="Email đăng nhập"><input name="email" type="email" required className={inputCls} /></Field>
            <Field label="Vai trò">
              <select name="role_code" required className={inputCls} defaultValue="cs">
                {(roles ?? []).map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
              </select>
            </Field>
            <div className="flex justify-end"><SubmitButton>Tạo tài khoản &amp; lấy link</SubmitButton></div>
          </ActionForm>
          <p className="mt-4 text-xs text-muted">Hệ thống không gửi email. Anh/chị chép link và gửi cho nhân viên; họ tự đặt mật khẩu khi mở link.</p>
        </Card>
      </div>
    </>
  );
}
