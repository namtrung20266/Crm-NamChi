"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { useEntities } from "@/lib/data";
import { PageHeader, Card, Badge, Empty } from "@/components/ui";

export default function MyCompanyPage() {
  const s = useSession();
  const ents = useEntities();
  const contacts = useQuery({ queryKey: ["my-contacts"], queryFn: () => q<{ id: string; name: string; phone: string | null; email: string | null; role_note: string | null }[]>(supabase.from("customer_contacts").select("id, name, phone, email, role_note").is("deleted_at", null)) });
  if (s.isStaff || !s.customer) return <Empty title="Trang dành cho khách hàng" />;
  return (
    <>
      <PageHeader eyebrow={s.customer.name} title={s.entity ? s.entity.legal_name : s.customer.name} desc="Cần thay đổi thông tin, vui lòng báo CSKH Nam Trung." />
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card title={`Đơn vị nhận hóa đơn (${ents.data?.length ?? 0})`}>
          <div className="grid gap-3 sm:grid-cols-2">
            {(ents.data ?? []).map((e) => (
              <div key={e.id} className="rounded-xl border border-line p-4">
                <div className="flex justify-between"><span className="font-mono text-sm font-semibold text-brand-strong">{e.code}</span>{e.is_retail_buyer ? <Badge>Bán lẻ</Badge> : null}</div>
                <div className="mt-1 font-medium">{e.legal_name}</div>
                <div className="mt-2 space-y-0.5 text-xs text-muted"><div>MST: {e.tax_code ?? "—"}</div><div>{e.invoice_address ?? "—"}</div><div>{e.invoice_email ?? "—"}</div></div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Người liên hệ">
          {(contacts.data ?? []).length === 0 ? <Empty title="Chưa có người liên hệ" /> : (
            <ul className="space-y-2">{(contacts.data ?? []).map((c) => <li key={c.id} className="rounded-lg border border-line px-3 py-2 text-sm"><span className="font-medium">{c.name}</span><div className="text-xs text-muted">{[c.role_note, c.phone, c.email].filter(Boolean).join(" · ")}</div></li>)}</ul>
          )}
        </Card>
      </div>
    </>
  );
}
