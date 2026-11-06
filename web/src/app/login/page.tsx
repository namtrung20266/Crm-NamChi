import { AuthFrame } from "@/components/auth-frame";
import { LoginForm } from "./login-form";

export const metadata = { title: "Đăng nhập · NAMCHI" };

const NOTICES: Record<string, string> = {
  inactive: "Tài khoản chưa được kích hoạt hoặc đã bị khóa. Liên hệ Nam Trung.",
  link: "Link đã hết hạn hoặc đã được dùng. Xin quản trị viên gửi link mới.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <AuthFrame title="Đăng nhập" subtitle="Theo dõi đơn hàng, kiện, chứng từ và công nợ – dành cho nhân viên Nam Trung và khách hàng được cấp tài khoản.">
      <LoginForm next={next} notice={error ? NOTICES[error] : undefined} />
    </AuthFrame>
  );
}
