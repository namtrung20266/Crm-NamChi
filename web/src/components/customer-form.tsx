import { Field, inputCls } from "@/components/ui";

type C = { code?: string; name?: string; tax_code?: string | null; address?: string | null; payment_term_days?: number;
  credit_limit_vnd?: number; status?: string; note?: string | null };

export function CustomerFields({ c = {}, readOnly = false }: { c?: C; readOnly?: boolean }) {
  return (
    <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
      <Field label="Mã khách hàng" hint="VD: LC. Dùng in trên mã đơn, không đổi sau khi có đơn.">
        <input name="code" required defaultValue={c.code} className={inputCls + " font-mono uppercase"} maxLength={20} />
      </Field>
      <Field label="Tên khách hàng"><input name="name" required defaultValue={c.name} className={inputCls} /></Field>
      <Field label="Mã số thuế"><input name="tax_code" defaultValue={c.tax_code ?? ""} className={inputCls + " font-mono"} /></Field>
      <Field label="Trạng thái">
        <select name="status" defaultValue={c.status ?? "active"} className={inputCls}>
          <option value="active">Đang hoạt động</option><option value="paused">Tạm dừng</option><option value="closed">Đã đóng</option>
        </select>
      </Field>
      <div className="sm:col-span-2"><Field label="Địa chỉ"><input name="address" defaultValue={c.address ?? ""} className={inputCls} /></Field></div>
      <Field label="Thời hạn công nợ (ngày)"><input name="payment_term_days" type="number" min={0} max={365} defaultValue={c.payment_term_days ?? 30} className={inputCls} /></Field>
      <Field label="Hạn mức công nợ (VND)"><input name="credit_limit_vnd" inputMode="numeric" defaultValue={c.credit_limit_vnd ?? 0} className={inputCls + " font-mono"} /></Field>
      <div className="sm:col-span-2"><Field label="Ghi chú nội bộ"><textarea name="note" rows={2} defaultValue={c.note ?? ""} className={inputCls + " h-auto py-2"} /></Field></div>
    </fieldset>
  );
}
