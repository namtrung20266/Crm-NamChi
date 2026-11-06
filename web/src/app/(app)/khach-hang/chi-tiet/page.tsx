"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { useEntities, useStaff, type Customer } from "@/lib/data";
import { PageHeader, Card, DataList, Badge, Empty, Field, inputCls, LinkButton, Skeleton } from "@/components/ui";
import { Form, Submit, ActionButton } from "@/components/ui/form";
import { CustomerFields, readCustomer } from "@/components/customer-form";
import { AccountsPanel } from "@/components/accounts-panel";
import { fmtDate } from "@/lib/format";
import { viError } from "@/lib/errors";

function Detail() {
  const id = useSearchParams().get("id") ?? "";
  const s = useSession();
  const write = s.can("customer.write"), manage = s.can("user.manage");
  const cust = useQuery({ queryKey: ["customer", id], enabled: !!id, queryFn: () => q<Customer | null>(supabase.from("customers").select("*").eq("id", id).maybeSingle()) });
  const ents = useEntities(id);
  const contacts = useQuery({ queryKey: ["contacts", id], queryFn: () => q<{ id: string; name: string; phone: string | null; email: string | null; role_note: string | null; entity_id: string | null }[]>(
    supabase.from("customer_contacts").select("id, name, phone, email, role_note, entity_id").eq("customer_id", id).is("deleted_at", null).order("name")) });
  const assigns = useQuery({ queryKey: ["assigns", id], queryFn: () => q<{ id: string; staff_user_id: string; valid_from: string; valid_to: string | null; row_version: number }[]>(
    supabase.from("staff_customer_assignments").select("id, staff_user_id, valid_from, valid_to, row_version").eq("customer_id", id).order("valid_from", { ascending: false })) });
  const staff = useStaff();

  if (cust.isLoading) return <Skeleton rows={6} />;
  const c = cust.data;
  if (!c) return <Empty title="Không tìm thấy khách hàng" desc="Có thể anh/chị không có quyền xem khách này." />;
  const E = ents.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const staffName = (u: string) => staff.data?.find((x) => x.user_id === u)?.full_name ?? "—";
  const entName = (e: string | null) => (e ? E.find((x) => x.id === e)?.legal_name ?? "—" : "Chung");

  return (
    <>
      <PageHeader eyebrow={`Khách hàng · ${c.code}`} title={c.name} desc={`${E.length} công ty con · công nợ ${c.payment_term_days} ngày`}
        actions={<LinkButton href="/khach-hang/" variant="secondary">← Danh sách</LinkButton>} />
      <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <div className="space-y-5">
          <Card title="Thông tin khách hàng">
            <Form invalidate={[["customer", id], ["customers"]]} onSubmit={async (f) => {
              const p = readCustomer(f);
              if ("error" in p) return { error: p.error };
              const { error } = await supabase.from("customers").update({ ...p.data, row_version: c.row_version }).eq("id", c.id);
              return error ? { error: viError(error) } : { ok: true, message: "Đã lưu." };
            }}>
              <CustomerFields c={c} readOnly={!write} />
              {write ? <div className="flex justify-end"><Submit>Lưu thay đổi</Submit></div> : null}
            </Form>
          </Card>

          <Card title={`Công ty con nhận hóa đơn (${E.length})`}>
            <DataList rows={E} empty={<Empty title="Chưa có công ty con" />}
              columns={[
                { head: "Mã", cell: (e) => <span className="font-mono font-semibold">{e.code}</span> },
                { head: "Tên pháp lý", cell: (e) => <>{e.legal_name} {e.is_retail_buyer ? <Badge>Bán lẻ</Badge> : null}</> },
                { head: "MST", cell: (e) => <span className="font-mono text-xs">{e.tax_code ?? "—"}</span> },
                { head: "Email nhận HĐ", cell: (e) => <span className="text-xs">{e.invoice_email ?? "—"}</span> },
              ]}
              mobile={(e) => <div><span className="font-mono font-semibold">{e.code}</span> · {e.legal_name}</div>} />
            {write ? (
              <details className="mt-5 border-t border-line pt-4">
                <summary className="cursor-pointer text-sm font-semibold text-brand-strong">+ Thêm công ty con</summary>
                <Form className="mt-4 grid gap-3 sm:grid-cols-2" resetOnOk invalidate={[["entities", id], ["entities", "all"]]} onSubmit={async (f) => {
                  const code = String(f.get("code") ?? "").trim().toUpperCase();
                  if (!/^[A-Z0-9_-]{1,20}$/.test(code)) return { error: "Mã 1–20 ký tự in hoa/số" };
                  const o = (k: string) => String(f.get(k) ?? "").trim() || null;
                  const { error } = await supabase.from("customer_entities").insert({ customer_id: id, code, legal_name: String(f.get("legal_name") ?? "").trim(),
                    tax_code: o("tax_code"), invoice_email: o("invoice_email"), invoice_address: o("invoice_address"), is_retail_buyer: f.get("is_retail_buyer") === "on" });
                  return error ? { error: viError(error) } : { ok: true, message: "Đã thêm công ty con." };
                }}>
                  <Field label="Mã (VD: SV)"><input name="code" required maxLength={20} className={inputCls + " font-mono uppercase"} /></Field>
                  <Field label="Tên pháp lý"><input name="legal_name" required minLength={2} className={inputCls} /></Field>
                  <Field label="Mã số thuế"><input name="tax_code" className={inputCls + " font-mono"} /></Field>
                  <Field label="Email nhận hóa đơn"><input name="invoice_email" type="email" className={inputCls} /></Field>
                  <div className="sm:col-span-2"><Field label="Địa chỉ xuất hóa đơn"><input name="invoice_address" className={inputCls} /></Field></div>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_retail_buyer" className="h-4 w-4" /> Bán cho người tiêu dùng</label>
                  <div className="flex justify-end"><Submit>Thêm</Submit></div>
                </Form>
              </details>
            ) : null}
          </Card>

          <AccountsPanel customerId={id} entities={E} />
        </div>

        <div className="space-y-5">
          <Card title="CSKH phụ trách">
            <ul className="space-y-2">
              {(assigns.data ?? []).length === 0 ? <Empty title="Chưa phân công CSKH" /> : null}
              {(assigns.data ?? []).map((a) => {
                const on = !a.valid_to || a.valid_to >= today;
                return (
                  <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                    <div><div className="text-sm font-medium">{staffName(a.staff_user_id)}</div><div className="text-xs text-muted">Từ {fmtDate(a.valid_from)}{a.valid_to ? ` đến ${fmtDate(a.valid_to)}` : ""}</div></div>
                    {on ? (manage ? <ActionButton confirmText="Kết thúc phân công? CSKH mất quyền xem khách ngay." invalidate={[["assigns", id]]}
                      onClick={() => q(supabase.from("staff_customer_assignments").update({ valid_to: a.valid_from >= today ? today : new Date(Date.now() - 864e5).toISOString().slice(0, 10), row_version: a.row_version }).eq("id", a.id))}>Kết thúc</ActionButton>
                      : <Badge tone="ok">Đang phụ trách</Badge>) : <Badge>Đã kết thúc</Badge>}
                  </li>
                );
              })}
            </ul>
            {manage ? (
              <Form className="mt-4 flex gap-2" invalidate={[["assigns", id]]} onSubmit={async (f) => {
                const u = String(f.get("staff_user_id") ?? "");
                if (!u) return { error: "Chọn CSKH" };
                const { error } = await supabase.from("staff_customer_assignments").insert({ customer_id: id, staff_user_id: u });
                return error ? { error: viError(error) } : { ok: true };
              }}>
                <select name="staff_user_id" className={inputCls} defaultValue=""><option value="" disabled>Chọn CSKH…</option>
                  {(staff.data ?? []).filter((x) => x.role_code === "cs" && x.is_active).map((x) => <option key={x.user_id} value={x.user_id}>{x.full_name}</option>)}</select>
                <Submit>Phân công</Submit>
              </Form>
            ) : null}
          </Card>

          <Card title={`Người liên hệ (${contacts.data?.length ?? 0})`}>
            <ul className="space-y-2">
              {(contacts.data ?? []).map((ct) => (
                <li key={ct.id} className="rounded-lg border border-line px-3 py-2">
                  <div className="flex justify-between gap-2"><span className="text-sm font-medium">{ct.name}</span><Badge>{entName(ct.entity_id)}</Badge></div>
                  <div className="text-xs text-muted">{[ct.role_note, ct.phone, ct.email].filter(Boolean).join(" · ") || "—"}</div>
                </li>
              ))}
            </ul>
            {write ? (
              <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold text-brand-strong">+ Thêm người liên hệ</summary>
                <Form className="mt-3 grid gap-3" resetOnOk invalidate={[["contacts", id]]} onSubmit={async (f) => {
                  const o = (k: string) => String(f.get(k) ?? "").trim() || null;
                  const { error } = await supabase.from("customer_contacts").insert({ customer_id: id, entity_id: o("entity_id"), name: String(f.get("name") ?? "").trim(), phone: o("phone"), email: o("email"), role_note: o("role_note") });
                  return error ? { error: viError(error) } : { ok: true };
                }}>
                  <Field label="Họ tên"><input name="name" required minLength={2} className={inputCls} /></Field>
                  <Field label="Thuộc công ty"><select name="entity_id" className={inputCls} defaultValue=""><option value="">Chung</option>{E.map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}</select></Field>
                  <div className="grid grid-cols-2 gap-3"><Field label="Điện thoại"><input name="phone" className={inputCls} /></Field><Field label="Email"><input name="email" type="email" className={inputCls} /></Field></div>
                  <Field label="Vai trò (VD: Kế toán)"><input name="role_note" className={inputCls} /></Field>
                  <div className="flex justify-end"><Submit>Thêm</Submit></div>
                </Form>
              </details>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}

export default function Page() { return <Suspense fallback={<Skeleton rows={6} />}><Detail /></Suspense>; }
