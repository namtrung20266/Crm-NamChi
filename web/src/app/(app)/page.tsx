import { getSession } from "@/lib/session";

export default async function HomePage() {
  const s = await getSession();
  const isStaff = s.userType === "staff";
  const scope = isStaff
    ? s.permissions.has("customer.read_all")
      ? "Mọi khách hàng"
      : "Chỉ khách hàng được phân công"
    : s.entity
      ? `Chỉ công ty ${s.entity.legalName}`
      : `Toàn bộ công ty con của ${s.customer?.name ?? "khách hàng"}`;

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-brand">Tổng quan</p>
        <h1 className="mt-1 text-2xl font-semibold">Xin chào, {s.fullName}</h1>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <Card label="Vai trò" value={s.roles.map((r) => r.name).join(", ") || "Chưa gán"} />
        <Card label="Phạm vi dữ liệu" value={scope} />
        <Card label="Tài khoản" value={s.email} mono />
      </section>

      <section className="rounded-lg border border-line bg-white">
        <div className="border-b border-line px-5 py-3 text-sm font-semibold">Quyền đang có</div>
        <ul className="flex flex-wrap gap-2 p-5">
          {[...s.permissions].sort().map((p) => (
            <li key={p} className="rounded bg-brand-soft px-2 py-1 font-mono text-xs text-brand-strong">{p}</li>
          ))}
          {s.permissions.size === 0 ? <li className="text-sm text-muted">Chưa có quyền nào. Liên hệ Admin.</li> : null}
        </ul>
      </section>

      <p className="text-sm text-muted">
        Các màn hình khách hàng, nhân viên, phân quyền, cài đặt và nhật ký mở ở Bước 4 của Giai đoạn 1.
      </p>
    </div>
  );
}

function Card({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-white p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-2 break-words text-[15px] font-medium ${mono ? "font-mono text-sm" : ""}`}>{value}</div>
    </div>
  );
}
