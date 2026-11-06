import { LoginForm } from "./login-form";

export const metadata = { title: "Đăng nhập · NAMCHI" };

const NOTICES: Record<string, string> = {
  inactive: "Tài khoản chưa được kích hoạt hoặc đã bị khóa. Liên hệ Nam Trung.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]" data-theme="staff">
      <section className="relative hidden overflow-hidden bg-ink lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="text-sm font-semibold tracking-[0.2em] text-white/60">NAM TRUNG GROUP</div>
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-brand">Quảng Châu · Bằng Tường · Lạng Sơn · Hà Nội</p>
          <h1 className="mt-4 max-w-md text-4xl font-semibold leading-tight text-white">
            Một nơi theo dõi đơn, kiện, chứng từ và dòng tiền.
          </h1>
        </div>
        <div aria-hidden className="pointer-events-none absolute -right-24 top-1/3 h-[420px] w-[420px] rounded-full border-[40px] border-brand/15" />
        <p className="text-xs text-white/40">NAMCHI · CRM &amp; Import Management</p>
      </section>
      <section className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <div className="text-xs font-semibold tracking-[0.2em] text-brand lg:hidden">NAM TRUNG GROUP</div>
            <h2 className="mt-2 text-2xl font-semibold text-ink">Đăng nhập NAMCHI</h2>
            <p className="mt-1 text-sm text-muted">Dành cho nhân viên Nam Trung và khách hàng được cấp tài khoản.</p>
          </div>
          <LoginForm next={next} notice={error ? NOTICES[error] : undefined} />
          <p className="mt-6 text-xs text-muted">Quên mật khẩu? Liên hệ quản trị viên Nam Trung để được cấp lại.</p>
        </div>
      </section>
    </main>
  );
}
