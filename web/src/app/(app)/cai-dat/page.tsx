"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { PageHeader, Card, DataList, Badge, Empty, Field, inputCls, Skeleton } from "@/components/ui";
import { Form, Submit } from "@/components/ui/form";
import { fmtDate } from "@/lib/format";
import { viError } from "@/lib/errors";

const LABEL: Record<string, string> = {
  "shipping.volumetric_divisor": "Hệ số quy đổi khối → kg (D×R×C / hệ số)",
  "finance.writeoff_threshold_vnd": "Ngưỡng xử lý chênh (VND)",
  "finance.deposit_rate_percent": "Tỷ lệ cọc L1 (% tiền hàng)",
  "finance.default_fx_rate": "Tỷ giá mặc định khi tạo đơn",
  "file.max_size_bytes": "Dung lượng file tối đa (byte)",
  "file.signed_url_ttl_seconds": "Thời hạn link tải file (giây)",
};
const ROLE = { importer: "Đứng tên nhập khẩu", exporter: "Người xuất khẩu", supplier: "Nhà cung cấp" } as const;

export default function SettingsPage() {
  const s = useSession();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => q<{ id: string; key: string; value_json: unknown; valid_from: string; valid_to: string | null }[]>(
    supabase.from("app_settings").select("id, key, value_json, valid_from, valid_to").order("key").order("valid_from", { ascending: false })) });
  const parties = useQuery({ queryKey: ["parties"], queryFn: () => q<{ id: string; code: string; party_role: string; legal_name: string; tax_code: string | null; country: string }[]>(
    supabase.from("trade_parties").select("id, code, party_role, legal_name, tax_code, country").order("party_role").order("code")) });
  if (!s.can("settings.manage")) return <Empty title="Bạn không có quyền cài đặt" />;
  const now = Date.now();
  const rows = settings.data ?? [];
  const keys = [...new Set(rows.map((r) => r.key))];
  return (
    <>
      <PageHeader eyebrow="Hệ thống" title="Cài đặt" desc="Mỗi lần đổi tạo bản mới có ngày hiệu lực; bản cũ giữ nguyên cho giao dịch trước đó." />
      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Card title="Tham số & lịch sử">
          {settings.isLoading ? <Skeleton /> : (
            <DataList rows={rows} empty={<Empty title="Chưa có tham số" />}
              columns={[
                { head: "Tham số", cell: (r) => <div><div className="font-medium">{LABEL[r.key] ?? r.key}</div><div className="font-mono text-[11px] text-muted">{r.key}</div></div> },
                { head: "Giá trị", cell: (r) => <span className="font-mono">{JSON.stringify(r.value_json)}</span> },
                { head: "Hiệu lực", cell: (r) => <span className="text-xs">{fmtDate(r.valid_from)} → {r.valid_to ? fmtDate(r.valid_to) : "nay"}</span> },
                { head: "", cell: (r) => r.valid_to && new Date(r.valid_to).getTime() <= now ? <Badge>Đã thay</Badge> : new Date(r.valid_from).getTime() > now ? <Badge tone="warn">Sắp áp dụng</Badge> : <Badge tone="ok">Đang dùng</Badge> },
              ]}
              mobile={(r) => <div><div className="font-medium">{LABEL[r.key] ?? r.key}</div><div className="font-mono text-sm">{JSON.stringify(r.value_json)}</div></div>} />
          )}
        </Card>
        <Card title="Đặt giá trị mới">
          <Form resetOnOk invalidate={[["settings"]]} onSubmit={async (f) => {
            let v: unknown;
            try { v = JSON.parse(String(f.get("value") ?? "")); } catch { return { error: "Giá trị phải là số hoặc JSON" }; }
            const d = String(f.get("valid_from") ?? "");
            const { error } = await supabase.rpc("set_setting", { p_key: f.get("key"), p_value: v, p_valid_from: d ? new Date(d + "T00:00:00+07:00").toISOString() : new Date().toISOString(), p_note: String(f.get("note") ?? "") || null });
            return error ? { error: viError(error) } : { ok: true, message: "Đã tạo bản cài đặt mới." };
          }}>
            <Field label="Tham số"><select name="key" className={inputCls}>{keys.map((k) => <option key={k} value={k}>{LABEL[k] ?? k}</option>)}</select></Field>
            <Field label="Giá trị mới"><input name="value" required className={inputCls + " font-mono"} /></Field>
            <Field label="Áp dụng từ ngày" hint="Để trống = áp dụng ngay."><input name="valid_from" type="date" className={inputCls} /></Field>
            <Field label="Lý do"><input name="note" className={inputCls} /></Field>
            <div className="flex justify-end"><Submit>Lưu bản mới</Submit></div>
          </Form>
        </Card>
      </div>
      <div className="mt-5">
        <Card title="Đối tác thương mại">
          <DataList rows={parties.data ?? []} empty={<Empty title="Chưa có đối tác" />}
            columns={[
              { head: "Mã", cell: (r) => <span className="font-mono font-semibold">{r.code}</span> },
              { head: "Vai trò", cell: (r) => <Badge tone="brand">{ROLE[r.party_role as keyof typeof ROLE]}</Badge> },
              { head: "Tên pháp lý", cell: (r) => r.legal_name },
              { head: "MST", cell: (r) => <span className="font-mono text-xs">{r.tax_code ?? "—"}</span> },
            ]}
            mobile={(r) => <div><span className="font-mono font-semibold">{r.code}</span> · {r.legal_name}</div>} />
          <details className="mt-5 border-t border-line pt-4"><summary className="cursor-pointer text-sm font-semibold text-brand-strong">+ Thêm đối tác</summary>
            <Form className="mt-4 grid gap-3 sm:grid-cols-2" resetOnOk invalidate={[["parties"]]} onSubmit={async (f) => {
              const code = String(f.get("code") ?? "").trim().toUpperCase();
              if (!/^[A-Z0-9_-]{2,30}$/.test(code)) return { error: "Mã 2–30 ký tự in hoa/số" };
              const { error } = await supabase.from("trade_parties").insert({ code, party_role: f.get("party_role"), legal_name: String(f.get("legal_name") ?? "").trim(), tax_code: String(f.get("tax_code") ?? "").trim() || null, country: String(f.get("country") ?? "VN").toUpperCase() });
              return error ? { error: viError(error) } : { ok: true };
            }}>
              <Field label="Mã"><input name="code" required className={inputCls + " font-mono uppercase"} /></Field>
              <Field label="Vai trò"><select name="party_role" className={inputCls}><option value="exporter">Người xuất khẩu</option><option value="importer">Đứng tên nhập khẩu</option><option value="supplier">Nhà cung cấp</option></select></Field>
              <Field label="Tên pháp lý"><input name="legal_name" required className={inputCls} /></Field>
              <Field label="Mã số thuế"><input name="tax_code" className={inputCls + " font-mono"} /></Field>
              <Field label="Quốc gia"><input name="country" defaultValue="CN" maxLength={2} className={inputCls + " uppercase"} /></Field>
              <div className="flex items-end justify-end"><Submit>Thêm</Submit></div>
            </Form>
          </details>
        </Card>
      </div>
    </>
  );
}
