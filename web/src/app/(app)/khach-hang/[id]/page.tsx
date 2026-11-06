import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession, can } from "@/lib/session";
import { PageHeader, Card, DataList, Badge, Empty, Field, inputCls, LinkButton } from "@/components/ui";
import { ActionForm, SubmitButton, ConfirmButton } from "@/components/ui/form";
import { CustomerFields } from "@/components/customer-form";
import { AccountsPanel } from "@/components/accounts-panel";
import { updateCustomer, addEntity, addContact, assignCs, endAssignment } from "../../actions";
import { fmtDate } from "@/lib/format";

export default async function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (s.userType !== "staff") redirect("/cong-ty");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();

  const [{ data: c }, { data: entities }, { data: contacts }, { data: assigns }] = await Promise.all([
    supabase.from("customers").select("*").eq("id", id).maybeSingle(),
    supabase.from("customer_entities").select("id, code, legal_name, tax_code, invoice_email, is_retail_buyer, status").eq("customer_id", id).is("deleted_at", null).order("code"),
    supabase.from("customer_contacts").select("id, name, phone, email, role_note, entity_id").eq("customer_id", id).order("name"),
    supabase.from("staff_customer_assignments").select("id, staff_user_id, valid_from, valid_to").eq("customer_id", id).order("valid_from", { ascending: false }),
  ]);
  if (!c) notFound(); // RLS: không thấy = không tồn tại với người này

  const write = can(s, "customer.write");
  const manage = can(s, "user.manage");
  const ents = entities ?? [];
  const entName = (eid: string | null) => (eid ? ents.find((e) => e.id === eid)?.legal_name ?? "—" : "Chung");

  // tên CSKH
  const staffIds = [...new Set((assigns ?? []).map((a) => a.staff_user_id))];
  const { data: staff } = manage || staffIds.length
    ? await supabase.from("user_directory").select("user_id, full_name, role_code").eq("user_type", "staff").eq("is_active", true)
    : { data: [] };
  const staffName = (uid: string) => staff?.find((x) => x.user_id === uid)?.full_name ?? "—";
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader eyebrow={`Khách hàng · ${c.code}`} title={c.name}
        desc={`${ents.length} công ty con · công nợ ${c.payment_term_days} ngày`}
        actions={<LinkButton href="/khach-hang" variant="secondary">← Danh sách</LinkButton>} />

      <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <div className="space-y-5">
          <Card title="Thông tin khách hàng">
            <ActionForm action={updateCustomer}>
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="row_version" value={c.row_version} />
              <CustomerFields c={c} readOnly={!write} />
              {write ? <div className="flex justify-end"><SubmitButton>Lưu thay đổi</SubmitButton></div> : null}
            </ActionForm>
          </Card>

          <Card title={`Công ty con nhận hóa đơn (${ents.length})`}>
            <DataList rows={ents}
              empty={<Empty title="Chưa có công ty con" desc="VD: Sen Vàng, Thịnh Vượng, Bán cho người tiêu dùng." />}
              columns={[
                { head: "Mã", cell: (e) => <span className="font-mono font-semibold">{e.code}</span> },
                { head: "Tên pháp lý", cell: (e) => <>{e.legal_name} {e.is_retail_buyer ? <Badge>Bán lẻ</Badge> : null}</> },
                { head: "MST", cell: (e) => <span className="font-mono text-xs">{e.tax_code ?? "—"}</span> },
                { head: "Email nhận HĐ", cell: (e) => <span className="text-xs">{e.invoice_email ?? "—"}</span> },
              ]}
              mobile={(e) => <div><span className="font-mono font-semibold">{e.code}</span> · {e.legal_name}<div className="text-xs text-muted">MST {e.tax_code ?? "—"} · {e.invoice_email ?? "—"}</div></div>} />
            {write ? (
              <details className="mt-5 border-t border-line pt-4">
                <summary className="cursor-pointer text-sm font-semibold text-brand-strong">+ Thêm công ty con</summary>
                <ActionForm action={addEntity} className="mt-4 grid gap-3 sm:grid-cols-2" resetOnOk>
                  <input type="hidden" name="customer_id" value={c.id} />
                  <Field label="Mã (VD: SV)"><input name="code" required maxLength={20} className={inputCls + " font-mono uppercase"} /></Field>
                  <Field label="Tên pháp lý"><input name="legal_name" required className={inputCls} /></Field>
                  <Field label="Mã số thuế"><input name="tax_code" className={inputCls + " font-mono"} /></Field>
                  <Field label="Email nhận hóa đơn"><input name="invoice_email" type="email" className={inputCls} /></Field>
                  <div className="sm:col-span-2"><Field label="Địa chỉ xuất hóa đơn"><input name="invoice_address" className={inputCls} /></Field></div>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_retail_buyer" className="h-4 w-4 accent-[var(--brand)]" /> Bán cho người tiêu dùng (không MST)</label>
                  <div className="flex justify-end"><SubmitButton>Thêm</SubmitButton></div>
                </ActionForm>
              </details>
            ) : null}
          </Card>

          <AccountsPanel session={s} customerId={c.id} entities={ents} />
        </div>

        <div className="space-y-5">
          <Card title="CSKH phụ trách">
            <ul className="space-y-2">
              {(assigns ?? []).length === 0 ? <Empty title="Chưa phân công CSKH" /> : null}
              {(assigns ?? []).map((a) => {
                const active = !a.valid_to || a.valid_to >= today;
                return (
                  <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                    <div>
                      <div className="text-sm font-medium">{staffName(a.staff_user_id)}</div>
                      <div className="text-xs text-muted">Từ {fmtDate(a.valid_from)}{a.valid_to ? ` đến ${fmtDate(a.valid_to)}` : ""}</div>
                    </div>
                    {active ? (manage ? (
                      <form action={endAssignment}><input type="hidden" name="id" value={a.id} />
                        <ConfirmButton message="Kết thúc phân công? CSKH này mất quyền xem khách ngay.">Kết thúc</ConfirmButton></form>
                    ) : <Badge tone="ok">Đang phụ trách</Badge>) : <Badge>Đã kết thúc</Badge>}
                  </li>
                );
              })}
            </ul>
            {manage ? (
              <ActionForm action={assignCs} className="mt-4 flex gap-2" resetOnOk>
                <input type="hidden" name="customer_id" value={c.id} />
                <select name="staff_user_id" required className={inputCls} defaultValue="">
                  <option value="" disabled>Chọn CSKH…</option>
                  {(staff ?? []).filter((x) => x.role_code === "cs").map((x) => <option key={x.user_id} value={x.user_id}>{x.full_name}</option>)}
                </select>
                <SubmitButton>Phân công</SubmitButton>
              </ActionForm>
            ) : null}
          </Card>

          <Card title={`Người liên hệ (${contacts?.length ?? 0})`}>
            <ul className="space-y-2">
              {(contacts ?? []).length === 0 ? <Empty title="Chưa có người liên hệ" /> : null}
              {(contacts ?? []).map((ct) => (
                <li key={ct.id} className="rounded-lg border border-line px-3 py-2">
                  <div className="flex justify-between gap-2"><span className="text-sm font-medium">{ct.name}</span><Badge>{entName(ct.entity_id)}</Badge></div>
                  <div className="text-xs text-muted">{[ct.role_note, ct.phone, ct.email].filter(Boolean).join(" · ") || "—"}</div>
                </li>
              ))}
            </ul>
            {write ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-semibold text-brand-strong">+ Thêm người liên hệ</summary>
                <ActionForm action={addContact} className="mt-3 grid gap-3" resetOnOk>
                  <input type="hidden" name="customer_id" value={c.id} />
                  <Field label="Họ tên"><input name="name" required className={inputCls} /></Field>
                  <Field label="Thuộc công ty">
                    <select name="entity_id" className={inputCls} defaultValue=""><option value="">Chung (Lanchi)</option>
                      {ents.map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}</select>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Điện thoại"><input name="phone" className={inputCls} /></Field>
                    <Field label="Email"><input name="email" type="email" className={inputCls} /></Field>
                  </div>
                  <Field label="Vai trò (VD: Kế toán)"><input name="role_note" className={inputCls} /></Field>
                  <div className="flex justify-end"><SubmitButton>Thêm</SubmitButton></div>
                </ActionForm>
              </details>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}
