import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthFrame } from "@/components/auth-frame";
import { SetPasswordForm } from "./form";

export const metadata = { title: "Đặt mật khẩu · NAMCHI" };

export default async function SetPasswordPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?error=link");
  return (
    <AuthFrame title="Đặt mật khẩu" subtitle={`Tài khoản ${user.email}. Mật khẩu tối thiểu 10 ký tự, nên gồm chữ và số.`}>
      <SetPasswordForm />
    </AuthFrame>
  );
}
