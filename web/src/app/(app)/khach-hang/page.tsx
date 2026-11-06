import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession, can } from "@/lib/session";
import { PageHeader, Card, DataList, Badge, Empty, LinkButton, inputCls, btn } from "@/components/ui";
import { fmtNumber } from "@/lib/format";

const STATUS = { active: ["Đang hoạt động", "ok"], paused: ["Tạm dừng", "warn"], closed: ["Đã đóng", "neutral"] } as const;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await getSession();
  if (s.userType !== "staff") redirect("/cong-ty");
  const { q = "" } = await searchParams;
  const supabase = await createClient();
  let query = supabase.from("customers")
    .select("id, code, name, tax_code, status, payment_term_days, credit_limit_vnd, customer_entities(count), customer_users(count)")
    .is("deleted_at", null).order("code");
  if (q.trim()) query = query.or(`code.ilike.%${q.trim().replace(/[%,()]/g, "")}%,name.ilike.%${q.trim().replace(/[%,()]/g, "")}%`);
  const { data: rows = [] } = await query;

  type Row = NonNullable<typeof rows>[number] & { customer_entities: { count: number }[]; customer_users: { count: number }[] };
  const list = (rows ?? []) as Row[];

  return (
    <>
      <PageHeader eyebrow="CRM" title="Khách hàng"
        desc={can(s, "customer.read_all") ? "Toàn bộ khách hàng của Nam Trung." : "Các khách hàng anh/chị đang phụ trách."}
        actions={can(s, "customer.write") ? <LinkButton href="/khach-hang/moi">+ Thêm khách hàng</LinkButton> : null} />
      <Card>
        <form className="mb-4 flex gap-2">
          <input name="q" defaultValue={q} placeholder="Tìm theo mã hoặc tên…" className={inputCls + " max-w-sm"} />
          <button className={btn.secondary}>Tìm</button>
        </form>
        <DataList rows={list}
          empty={<Empty title="Chưa có khách hàng" desc={can(s, "customer.write") ? "Bấm “Thêm khách hàng” để bắt đầu." : "Liên hệ Admin để được phân công khách."} />}
          columns={[
            { head: "Mã", cell: (r) => <Link href={`/khach-hang/${r.id}`} className="font-mono font-semibold text-brand-strong hover:underline">{r.code}</Link> },
            { head: "Tên khách hàng", cell: (r) => <Link href={`/khach-hang/${r.id}`} className="font-medium hover:underline">{r.name}</Link> },
            { head: "Công ty con", cell: (r) => r.customer_entities?.[0]?.count ?? 0, className: "text-right" },
            { head: "Tài khoản", cell: (r) => r.customer_users?.[0]?.count ?? 0, className: "text-right" },
            { head: "Công nợ", cell: (r) => `${r.payment_term_days} ngày`, className: "text-right" },
            { head: "Hạn mức (đ)", cell: (r) => fmtNumber(r.credit_limit_vnd), className: "text-right font-mono" },
            { head: "Trạng thái", cell: (r) => <Badge tone={STATUS[r.status as keyof typeof STATUS][1]}>{STATUS[r.status as keyof typeof STATUS][0]}</Badge> },
          ]}
          mobile={(r) => (
            <Link href={`/khach-hang/${r.id}`} className="block">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-semibold text-brand-strong">{r.code}</span>
                <Badge tone={STATUS[r.status as keyof typeof STATUS][1]}>{STATUS[r.status as keyof typeof STATUS][0]}</Badge>
              </div>
              <div className="mt-1 font-medium">{r.name}</div>
              <div className="mt-1 text-xs text-muted">{r.customer_entities?.[0]?.count ?? 0} công ty con · {r.customer_users?.[0]?.count ?? 0} tài khoản · công nợ {r.payment_term_days} ngày</div>
            </Link>
          )} />
      </Card>
    </>
  );
}
