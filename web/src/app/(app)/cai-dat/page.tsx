import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession, can } from "@/lib/session";
import { PageHeader, Card, DataList, Badge, Empty, Field, inputCls } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { newSetting, addTradeParty } from "../actions";
import { fmtDate } from "@/lib/format";

const LABEL: Record<string, string> = {
  "shipping.volumetric_divisor": "Hệ số quy đổi khối → kg (D×R×C / hệ số)",
  "finance.writeoff_threshold_vnd": "Ngưỡng xử lý chênh (VND)",
  "file.max_size_bytes": "Dung lượng file tối đa (byte)",
  "file.signed_url_ttl_seconds": "Thời hạn link tải file (giây)",
};
const ROLE = { importer: "Đứng tên nhập khẩu", exporter: "Người xuất khẩu", supplier: "Nhà cung cấp" } as const;

export default async function SettingsPage() {
  const s = await getSession();
  if (!can(s, "settings.manage")) redirect("/");
  const supabase = await createClient();
  const [{ data: settings }, { data: parties }] = await Promise.all([
    supabase.from("app_settings").select("id, key, value_json, valid_from, valid_to, note").order("key").order("valid_from", { ascending: false }),
    supabase.from("trade_parties").select("id, code, party_role, legal_name, tax_code, country").order("party_role").order("code"),
  ]);
  const now = Date.now();
  const rows = settings ?? [];
  const keys = [...new Set(rows.map((r) => r.key))];

  return (
    <>
      <PageHeader eyebrow="Hệ thống" title="Cài đặt" desc="Mỗi lần đổi tạo một bản mới có ngày hiệu lực; bản cũ giữ nguyên để giao dịch trước đó không bị tính lại." />
      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Card title="Tham số đang dùng & lịch sử">
          <DataList rows={rows} empty={<Empty title="Chưa có tham số" />}
            columns={[
              { head: "Tham số", cell: (r) => <div><div className="font-medium">{LABEL[r.key] ?? r.key}</div><div className="font-mono text-[11px] text-muted">{r.key}</div></div> },
              { head: "Giá trị", cell: (r) => <span className="font-mono">{JSON.stringify(r.value_json)}</span> },
              { head: "Hiệu lực", cell: (r) => <span className="text-xs">{fmtDate(r.valid_from)} → {r.valid_to ? fmtDate(r.valid_to) : "nay"}</span> },
              { head: "", cell: (r) => {
                  const start = new Date(r.valid_from).getTime();
                  return r.valid_to && new Date(r.valid_to).getTime() <= now ? <Badge>Đã thay</Badge>
                    : start > now ? <Badge tone="warn">Sắp áp dụng</Badge> : <Badge tone="ok">Đang dùng</Badge>;
                } },
            ]}
            mobile={(r) => <div><div className="font-medium">{LABEL[r.key] ?? r.key}</div><div className="font-mono text-sm">{JSON.stringify(r.value_json)}</div><div className="text-xs text-muted">{fmtDate(r.valid_from)} → {r.valid_to ? fmtDate(r.valid_to) : "nay"}</div></div>} />
        </Card>
        <Card title="Đặt giá trị mới">
          <ActionForm action={newSetting} resetOnOk>
            <Field label="Tham số">
              <select name="key" className={inputCls}>{keys.map((k) => <option key={k} value={k}>{LABEL[k] ?? k}</option>)}</select>
            </Field>
            <Field label="Giá trị mới" hint="Số (VD 6000) hoặc JSON."><input name="value" required className={inputCls + " font-mono"} /></Field>
            <Field label="Áp dụng từ ngày" hint="Để trống = áp dụng ngay."><input name="valid_from" type="date" className={inputCls} /></Field>
            <Field label="Lý do / ghi chú"><input name="note" className={inputCls} /></Field>
            <div className="flex justify-end"><SubmitButton>Lưu bản mới</SubmitButton></div>
          </ActionForm>
        </Card>
      </div>

      <div className="mt-5">
        <Card title="Đối tác thương mại">
          <DataList rows={parties ?? []} empty={<Empty title="Chưa có đối tác" />}
            columns={[
              { head: "Mã", cell: (r) => <span className="font-mono font-semibold">{r.code}</span> },
              { head: "Vai trò", cell: (r) => <Badge tone="brand">{ROLE[r.party_role as keyof typeof ROLE]}</Badge> },
              { head: "Tên pháp lý", cell: (r) => r.legal_name },
              { head: "MST", cell: (r) => <span className="font-mono text-xs">{r.tax_code ?? "—"}</span> },
              { head: "Nước", cell: (r) => r.country },
            ]}
            mobile={(r) => <div><span className="font-mono font-semibold">{r.code}</span> · {ROLE[r.party_role as keyof typeof ROLE]}<div className="text-sm">{r.legal_name}</div></div>} />
          <details className="mt-5 border-t border-line pt-4">
            <summary className="cursor-pointer text-sm font-semibold text-brand-strong">+ Thêm đối tác</summary>
            <ActionForm action={addTradeParty} className="mt-4 grid gap-3 sm:grid-cols-2" resetOnOk>
              <Field label="Mã"><input name="code" required className={inputCls + " font-mono uppercase"} /></Field>
              <Field label="Vai trò"><select name="party_role" className={inputCls}><option value="exporter">Người xuất khẩu</option><option value="importer">Đứng tên nhập khẩu</option><option value="supplier">Nhà cung cấp</option></select></Field>
              <Field label="Tên pháp lý"><input name="legal_name" required className={inputCls} /></Field>
              <Field label="Mã số thuế"><input name="tax_code" className={inputCls + " font-mono"} /></Field>
              <Field label="Quốc gia (VN, CN)"><input name="country" defaultValue="CN" maxLength={2} className={inputCls + " uppercase"} /></Field>
              <div className="flex items-end justify-end"><SubmitButton>Thêm</SubmitButton></div>
            </ActionForm>
          </details>
        </Card>
      </div>
    </>
  );
}
