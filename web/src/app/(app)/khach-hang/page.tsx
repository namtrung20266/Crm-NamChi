"use client";

import Link from "next/link";
import { useState } from "react";
import { useSession } from "@/lib/session";
import { useCustomers } from "@/lib/data";
import { PageHeader, Card, DataList, Badge, Empty, LinkButton, inputCls, Skeleton } from "@/components/ui";
import { fmtNumber } from "@/lib/format";

const STATUS = { active: ["Đang hoạt động", "ok"], paused: ["Tạm dừng", "warn"], closed: ["Đã đóng", "neutral"] } as const;

export default function CustomersPage() {
  const s = useSession();
  const { data, isLoading } = useCustomers();
  const [qtext, setQ] = useState("");
  const rows = (data ?? []).filter((c) => !qtext || (c.code + " " + c.name).toLowerCase().includes(qtext.toLowerCase()));
  const st = (k: string) => STATUS[k as keyof typeof STATUS] ?? STATUS.active;
  return (
    <>
      <PageHeader eyebrow="CRM" title="Khách hàng" desc={s.can("customer.read_all") ? "Toàn bộ khách hàng." : "Khách hàng anh/chị phụ trách."}
        actions={s.can("customer.write") ? <LinkButton href="/khach-hang/moi/">+ Thêm khách hàng</LinkButton> : null} />
      <Card>
        <input value={qtext} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo mã hoặc tên…" className={inputCls + " mb-4 max-w-sm"} />
        {isLoading ? <Skeleton /> : (
          <DataList rows={rows} empty={<Empty title="Chưa có khách hàng" />}
            columns={[
              { head: "Mã", cell: (r) => <Link href={`/khach-hang/chi-tiet/?id=${r.id}`} className="font-mono font-semibold text-brand-strong hover:underline">{r.code}</Link> },
              { head: "Tên khách hàng", cell: (r) => <Link href={`/khach-hang/chi-tiet/?id=${r.id}`} className="font-medium hover:underline">{r.name}</Link> },
              { head: "Công nợ", cell: (r) => `${r.payment_term_days} ngày`, className: "text-right" },
              { head: "Hạn mức (đ)", cell: (r) => fmtNumber(r.credit_limit_vnd), className: "text-right font-mono" },
              { head: "Trạng thái", cell: (r) => <Badge tone={st(r.status)[1]}>{st(r.status)[0]}</Badge> },
            ]}
            mobile={(r) => (
              <Link href={`/khach-hang/chi-tiet/?id=${r.id}`} className="block">
                <div className="flex justify-between"><span className="font-mono font-semibold text-brand-strong">{r.code}</span><Badge tone={st(r.status)[1]}>{st(r.status)[0]}</Badge></div>
                <div className="mt-1 font-medium">{r.name}</div>
              </Link>
            )} />
        )}
      </Card>
    </>
  );
}
