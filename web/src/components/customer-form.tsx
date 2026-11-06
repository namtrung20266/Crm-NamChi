import { Field, inputCls } from "@/components/ui";
import type { Customer } from "@/lib/data";

export function CustomerFields({ c, readOnly = false }: { c?: Partial<Customer>; readOnly?: boolean }) {
  return (
    <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
      <Field label="Mã khách hàng" hint="VD: LC. Dùng trên mã đơn."><input name="code" required defaultValue={c?.code} className={inputCls + " font-mono uppercase"} maxLength={20} /></Field>
      <Field label="Tên khách hàng"><input name="name" required defaultValue={c?.name} className={inputCls} /></Field>
      <Field label="Mã số thuế"><input name="tax_code" defaultValue={c?.tax_code ?? ""} className={inputCls + " font-mono"} /></Field>
      <Field label="Trạng thái">
        <select name="status" defaultValue={c?.status ?? "active"} className={inputCls}>
          <option value="active">Đang hoạt động</option><option value="paused">Tạm dừng</option><option value="closed">Đã đóng</option>
        </select>
      </Field>
      <div className="sm:col-span-2"><Field label="Địa chỉ"><input name="address" defaultValue={c?.address ?? ""} className={inputCls} /></Field></div>
      <Field label="Thời hạn công nợ (ngày)"><input name="payment_term_days" type="number" min={0} max={365} defaultValue={c?.payment_term_days ?? 30} className={inputCls} /></Field>
      <Field label="Hạn mức công nợ (VND)"><input name="credit_limit_vnd" inputMode="numeric" defaultValue={c?.credit_limit_vnd ?? 0} className={inputCls + " font-mono"} /></Field>
      <div className="sm:col-span-2"><Field label="Ghi chú nội bộ"><textarea name="note" rows={2} defaultValue={c?.note ?? ""} className={inputCls + " h-auto py-2"} /></Field></div>
    </fieldset>
  );
}

export function readCustomer(f: FormData) {
  const code = String(f.get("code") ?? "").trim().toUpperCase();
  const name = String(f.get("name") ?? "").trim();
  if (!/^[A-Z0-9_-]{2,20}$/.test(code)) return { error: "Mã khách 2–20 ký tự, chữ in hoa/số" } as const;
  if (name.length < 2) return { error: "Cần nhập tên khách hàng" } as const;
  const opt = (k: string) => { const v = String(f.get(k) ?? "").trim(); return v || null; };
  return { data: {
    code, name, tax_code: opt("tax_code"), address: opt("address"), note: opt("note"),
    status: String(f.get("status") ?? "active"),
    payment_term_days: Math.min(365, Math.max(0, Number(f.get("payment_term_days") || 30))),
    credit_limit_vnd: Number(String(f.get("credit_limit_vnd") ?? "0").replace(/\D/g, "") || 0),
  } } as const;
}
