import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { PageHeader, Card, Field, inputCls } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { updateProfile, changePassword } from "../actions";

export default async function ProfilePage() {
  const s = await getSession();
  const supabase = await createClient();
  const { data: p } = await supabase.from("profiles").select("full_name, phone").eq("user_id", s.userId).single();
  return (
    <>
      <PageHeader eyebrow="Cá nhân" title="Hồ sơ của tôi" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Thông tin">
          <ActionForm action={updateProfile}>
            <Field label="Email đăng nhập"><input disabled value={s.email} className={inputCls + " bg-surface"} /></Field>
            <Field label="Họ tên"><input name="full_name" required defaultValue={p?.full_name} className={inputCls} /></Field>
            <Field label="Điện thoại"><input name="phone" defaultValue={p?.phone ?? ""} className={inputCls} /></Field>
            <div className="flex justify-end"><SubmitButton>Lưu</SubmitButton></div>
          </ActionForm>
        </Card>
        <Card title="Đổi mật khẩu">
          <ActionForm action={changePassword} resetOnOk>
            <Field label="Mật khẩu mới" hint="Tối thiểu 10 ký tự."><input name="password" type="password" autoComplete="new-password" required minLength={10} className={inputCls} /></Field>
            <Field label="Nhập lại"><input name="confirm" type="password" autoComplete="new-password" required className={inputCls} /></Field>
            <div className="flex justify-end"><SubmitButton>Đổi mật khẩu</SubmitButton></div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
