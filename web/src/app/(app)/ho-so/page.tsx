"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { PageHeader, Card, Field, inputCls, Skeleton } from "@/components/ui";
import { Form, Submit } from "@/components/ui/form";
import { viError } from "@/lib/errors";

export default function ProfilePage() {
  const s = useSession();
  const p = useQuery({ queryKey: ["me"], queryFn: () => q<{ full_name: string; phone: string | null; row_version: number }>(supabase.from("profiles").select("full_name, phone, row_version").eq("user_id", s.user_id).single()) });
  return (
    <>
      <PageHeader eyebrow="Cá nhân" title="Hồ sơ của tôi" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Thông tin">
          {!p.data ? <Skeleton rows={3} /> : (
            <Form invalidate={[["me"], ["ctx"]]} onSubmit={async (f) => {
              const full_name = String(f.get("full_name") ?? "").trim();
              if (full_name.length < 2) return { error: "Cần nhập họ tên" };
              const { error } = await supabase.from("profiles").update({ full_name, phone: String(f.get("phone") ?? "").trim() || null, row_version: p.data!.row_version }).eq("user_id", s.user_id);
              return error ? { error: viError(error) } : { ok: true, message: "Đã lưu." };
            }}>
              <Field label="Email đăng nhập"><input disabled value={s.email} className={inputCls + " bg-surface"} /></Field>
              <Field label="Họ tên"><input name="full_name" defaultValue={p.data.full_name} className={inputCls} /></Field>
              <Field label="Điện thoại"><input name="phone" defaultValue={p.data.phone ?? ""} className={inputCls} /></Field>
              <div className="flex justify-end"><Submit>Lưu</Submit></div>
            </Form>
          )}
        </Card>
        <Card title="Đổi mật khẩu">
          <Form resetOnOk onSubmit={async (f) => {
            const pw = String(f.get("password") ?? ""), c = String(f.get("confirm") ?? "");
            if (pw.length < 10) return { error: "Mật khẩu tối thiểu 10 ký tự" };
            if (pw !== c) return { error: "Hai lần nhập không khớp" };
            const { error } = await supabase.auth.updateUser({ password: pw });
            return error ? { error: "Không đổi được mật khẩu." } : { ok: true, message: "Đã đổi mật khẩu." };
          }}>
            <Field label="Mật khẩu mới"><input name="password" type="password" autoComplete="new-password" className={inputCls} /></Field>
            <Field label="Nhập lại"><input name="confirm" type="password" autoComplete="new-password" className={inputCls} /></Field>
            <div className="flex justify-end"><Submit>Đổi mật khẩu</Submit></div>
          </Form>
        </Card>
      </div>
    </>
  );
}
