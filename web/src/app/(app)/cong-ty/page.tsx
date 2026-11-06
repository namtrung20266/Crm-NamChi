import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { PageHeader, Card, Badge, Empty } from "@/components/ui";

export default async function MyCompanyPage() {
  const s = await getSession();
  if (s.userType !== "customer" || !s.customer) redirect("/");
  const supabase = await createClient();
  const [{ data: c }, { data: ents }, { data: contacts }] = await Promise.all([
    supabase.from("customers").select("code, name, tax_code, address, payment_term_days").eq("id", s.customer.id).maybeSingle(),
    supabase.from("customer_entities").select("id, code, legal_name, tax_code, invoice_address, invoice_email, is_retail_buyer").order("code"),
    supabase.from("customer_contacts").select("id, name, phone, email, role_note, entity_id").order("name"),
  ]);
  return (
    <>
      <PageHeader eyebrow={s.entity ? s.customer.name : "Khách hàng"} title={s.entity ? s.entity.legalName : (c?.name ?? s.customer.name)}
        desc="Thông tin xuất hóa đơn và người liên hệ. Cần thay đổi, vui lòng báo CSKH Nam Trung." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Thông tin chung">
          <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
            <dt className="text-muted">Mã khách</dt><dd className="font-mono font-semibold">{c?.code}</dd>
            <dt className="text-muted">Mã số thuế</dt><dd className="font-mono">{c?.tax_code ?? "—"}</dd>
            <dt className="text-muted">Địa chỉ</dt><dd>{c?.address ?? "—"}</dd>
            <dt className="text-muted">Thời hạn công nợ</dt><dd>{c?.payment_term_days} ngày</dd>
          </dl>
        </Card>
        <Card title="Người liên hệ">
          {(contacts ?? []).length === 0 ? <Empty title="Chưa có người liên hệ" /> : (
            <ul className="space-y-2">{(contacts ?? []).map((ct) => (
              <li key={ct.id} className="rounded-lg border border-line px-3 py-2 text-sm"><span className="font-medium">{ct.name}</span>
                <div className="text-xs text-muted">{[ct.role_note, ct.phone, ct.email].filter(Boolean).join(" · ")}</div></li>))}</ul>)}
        </Card>
      </div>
      <div className="mt-5">
        <Card title={`Đơn vị nhận hóa đơn (${ents?.length ?? 0})`}>
          {(ents ?? []).length === 0 ? <Empty title="Chưa có đơn vị nhận hóa đơn" /> : (
            <div className="grid gap-3 sm:grid-cols-2">
              {(ents ?? []).map((e) => (
                <div key={e.id} className="rounded-xl border border-line p-4">
                  <div className="flex items-center justify-between"><span className="font-mono text-sm font-semibold text-brand-strong">{e.code}</span>{e.is_retail_buyer ? <Badge>Bán lẻ</Badge> : null}</div>
                  <div className="mt-1 font-medium">{e.legal_name}</div>
                  <div className="mt-2 space-y-0.5 text-xs text-muted"><div>MST: {e.tax_code ?? "—"}</div><div>{e.invoice_address ?? "—"}</div><div>{e.invoice_email ?? "—"}</div></div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
