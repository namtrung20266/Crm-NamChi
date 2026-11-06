import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSession, can } from "@/lib/session";
import { Card, Badge } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";

export default async function HomePage() {
  const s = await getSession();
  const supabase = await createClient();
  const isStaff = s.userType === "staff";
  const hello = new Date().getHours() < 12 ? "Chào buổi sáng" : new Date().getHours() < 18 ? "Chào buổi chiều" : "Chào buổi tối";

  const count = async (t: string, f?: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    let q = supabase.from(t).select("*", { count: "exact", head: true });
    if (f) q = f(q);
    const { count } = await q;
    return count ?? 0;
  };
  const [customers, entities, custUsers, staffUsers] = await Promise.all([
    count("customers", (q) => q.is("deleted_at", null)),
    count("customer_entities", (q) => q.is("deleted_at", null)),
    count("user_directory", (q) => q.eq("user_type", "customer").eq("is_active", true)),
    isStaff ? count("user_directory", (q) => q.eq("user_type", "staff").eq("is_active", true)) : Promise.resolve(0),
  ]);
  const { data: recent } = can(s, "audit.read")
    ? await supabase.from("audit_log_view").select("id, table_name, action, at").order("at", { ascending: false }).limit(6)
    : { data: null };

  const stats = isStaff
    ? [["Khách hàng", customers, "/khach-hang"], ["Công ty con nhận HĐ", entities, "/khach-hang"], ["Tài khoản khách", custUsers, "/khach-hang"], ["Nhân viên hoạt động", staffUsers, "/nhan-vien"]]
    : [["Đơn vị nhận hóa đơn", entities, "/cong-ty"], ["Tài khoản của công ty", custUsers, can(s, "customer_user.invite") ? "/tai-khoan" : "/cong-ty"]];

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl bg-[#0f0d0c] px-6 py-7 text-white sm:px-8">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(closest-side,var(--brand),transparent)] opacity-40" />
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-white/50">{isStaff ? "Nam Trung · nội bộ" : s.customer?.name}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{hello}, {s.fullName}</h1>
        <p className="mt-1 text-sm text-white/60">
          {s.roles.map((r) => r.name).join(", ")} · {isStaff
            ? (can(s, "customer.read_all") ? "xem mọi khách hàng" : "xem khách được phân công")
            : (s.entity ? `chỉ dữ liệu của ${s.entity.legalName}` : "toàn bộ công ty con")}
        </p>
      </section>

      <section className={`grid gap-4 ${stats.length > 2 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2"}`}>
        {stats.map(([label, value, href]) => (
          <Link key={label as string} href={href as string} className="group rounded-xl border border-line bg-white p-5 transition hover:border-brand/40 hover:shadow-[0_10px_30px_-18px_rgba(232,89,12,.6)]">
            <div className="text-xs font-medium text-muted">{label}</div>
            <div className="mt-2 font-mono text-3xl font-semibold tracking-tight group-hover:text-brand-strong">{value as number}</div>
          </Link>
        ))}
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Lộ trình triển khai">
          <ol className="space-y-3 text-sm">
            {[["Giai đoạn 1 – Nền tảng: tài khoản, khách hàng, phân quyền, nhật ký", "ok", "Đang dùng"],
              ["Giai đoạn 2 – Đơn hàng, phiếu tính tiền, tiền vào, công nợ", "warn", "Tiếp theo"],
              ["Giai đoạn 3 – Kho TQ, khai báo, list bốc, list xe, chứng từ", "neutral", "Kế hoạch"],
              ["Giai đoạn 4–5 – Kho VN, phân bổ, hóa đơn, khiếu nại", "neutral", "Kế hoạch"]].map(([t, tone, b]) => (
              <li key={t} className="flex items-start justify-between gap-3"><span>{t}</span><Badge tone={tone as "ok"}>{b}</Badge></li>
            ))}
          </ol>
        </Card>
        {recent ? (
          <Card title="Thay đổi gần đây" actions={<Link href="/nhat-ky" className="text-xs font-semibold text-brand-strong">Xem tất cả →</Link>}>
            <ul className="space-y-2 text-sm">
              {recent.length === 0 ? <li className="text-muted">Chưa có thay đổi.</li> : null}
              {recent.map((r) => (
                <li key={r.id} className="flex justify-between gap-2"><span className="truncate">{r.action === "INSERT" ? "Tạo" : r.action === "UPDATE" ? "Sửa" : "Xóa"} · {r.table_name.replace("public.", "")}</span>
                  <span className="shrink-0 font-mono text-xs text-muted">{fmtDateTime(r.at)}</span></li>
              ))}
            </ul>
          </Card>
        ) : (
          <Card title="Hỗ trợ"><p className="text-sm text-muted">Cần hỗ trợ, liên hệ CSKH Nam Trung phụ trách công ty anh/chị.</p></Card>
        )}
      </div>
    </div>
  );
}
