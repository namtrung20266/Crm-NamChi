"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { useCustomers, useEntities, useStaff } from "@/lib/data";
import { useLookups, rpc } from "@/lib/meta";
import { uploadFile } from "@/lib/files";
import { INVOICE_TYPE } from "@/lib/status";
import { PageHeader, Card, Field, inputCls, Empty, btn, Notice } from "@/components/ui";
import { vnd, fmtNumber } from "@/lib/format";
import { viError } from "@/lib/errors";

type Preview = { fx_rate: number; goods_vnd: number; lines: { label: string; method: string; rate: number; amount_vnd: number }[]; subtotal_vnd: number; vat_vnd: number; total_vnd: number; deposit_vnd: number; deposit_rate: number };
const num = (v: string) => Number(v.replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")) || 0;
function Section({ n, title, desc, children }: { n: number; title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-line/70 py-5 last:border-0 lg:grid-cols-[220px_1fr]">
      <div><div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft font-mono text-xs font-bold text-brand-strong">{n}</span><h3 className="text-sm font-semibold">{title}</h3></div>
        {desc ? <p className="mt-1 pl-8 text-xs text-muted">{desc}</p> : null}</div>
      <div>{children}</div>
    </section>
  );
}

export default function NewOrderPage() {
  const s = useSession();
  const router = useRouter();
  const customers = useCustomers();
  const staff = useStaff();
  const groups = useLookups("goods_group");
  const sources = useLookups("order_source");
  const [v, setV] = useState({
    customer_id: s.customer?.id ?? "", entity_id: s.entity?.id ?? "", customer_ref: "", source_channel: "", supplier_name: "", supplier_link: "", supplier_contact: "",
    goods_group: "", goods_desc: "", china_invoice_type: "HDPT", goods_qty: "", goods_cny: "", fx_rate: "", vat_rate: "8", deposit_rate: "", order_week: "", expected_week: "",
    require_label_check: false, require_inspection: false, delivery_address: "", note: "", internal_note: "", cs_owner_id: "",
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV((p) => ({ ...p, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));
  const ents = useEntities(v.customer_id || null);
  const fx = useQuery({ queryKey: ["default-fx"], enabled: s.isStaff, queryFn: () => q<unknown>(supabase.rpc("get_setting", { p_key: "finance.default_fx_rate" })) });
  useEffect(() => { if (fx.data && !v.fx_rate) setV((p) => ({ ...p, fx_rate: String(fx.data) })); }, [fx.data, v.fx_rate]);
  const ent = ents.data?.find((e) => e.id === v.entity_id);
  useEffect(() => { if (ent?.invoice_address && !v.delivery_address) setV((p) => ({ ...p, delivery_address: ent.invoice_address ?? "" })); }, [ent, v.delivery_address]);

  // ước tính phí theo biểu phí (giá bán)
  const [preview, setPreview] = useState<Preview | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!v.customer_id || !(num(v.goods_cny) > 0)) { setPreview(null); return; }
    timer.current = setTimeout(() => {
      rpc<Preview>("preview_order_fees", { p_customer_id: v.customer_id, p_goods_cny: num(v.goods_cny), p_fx: num(v.fx_rate), p_invoice_type: v.china_invoice_type,
        p_goods_group: v.goods_group, p_weight_kg: 0, p_vat_rate: num(v.vat_rate) || 8 }).then(setPreview).catch(() => setPreview(null));
    }, 400);
  }, [v.customer_id, v.goods_cny, v.fx_rate, v.china_invoice_type, v.goods_group, v.vat_rate]);

  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const missing = useMemo(() => [
    !v.customer_id && "khách hàng", !v.entity_id && "công ty nhận hàng/HĐ", !v.goods_desc.trim() && "mô tả hàng", !(num(v.goods_cny) > 0) && "tổng tiền hàng",
    s.isStaff && !(num(v.fx_rate) > 0) && "tỷ giá",
  ].filter(Boolean) as string[], [v, s.isStaff]);

  if (!s.can("order.write") && !s.can("order.create_own")) return <Empty title="Bạn không có quyền tạo đơn" />;

  const save = async (send: boolean) => {
    if (missing.length) { setErr(`Còn thiếu: ${missing.join(", ")}`); return; }
    setErr(null); setBusy("Đang tạo đơn…");
    const opt = (x: string) => x.trim() || null;
    const payload: Record<string, unknown> = {
      customer_id: v.customer_id, entity_id: v.entity_id, customer_ref: opt(v.customer_ref), source_channel: opt(v.source_channel), supplier_name: opt(v.supplier_name),
      supplier_link: opt(v.supplier_link), supplier_contact: opt(v.supplier_contact), goods_group: opt(v.goods_group), goods_desc: opt(v.goods_desc),
      china_invoice_type: v.china_invoice_type, goods_qty: num(v.goods_qty), goods_cny: num(v.goods_cny), order_week: opt(v.order_week),
      require_label_check: v.require_label_check, require_inspection: v.require_inspection, delivery_address: opt(v.delivery_address), note: opt(v.note),
      status: send ? "cho_bao_gia" : "dang_len_don", fx_rate: s.isStaff ? num(v.fx_rate) : 1,
    };
    if (s.isStaff) Object.assign(payload, { vat_rate: num(v.vat_rate) || 8, deposit_rate: v.deposit_rate ? num(v.deposit_rate) : null, expected_week: opt(v.expected_week),
      internal_note: opt(v.internal_note), cs_owner_id: v.cs_owner_id || null, submitted_at: send ? new Date().toISOString() : null });
    const { data, error } = await supabase.from("orders").insert(payload).select("id").single();
    if (error) { setBusy(null); setErr(viError(error)); return; }
    const failed: string[] = [];
    for (const [i, f] of files.entries()) {
      setBusy(`Đang tải file ${i + 1}/${files.length} lên Drive…`);
      try { await uploadFile(f, "order", data.id, { category: f.type.startsWith("image/") ? "anh_san_pham" : "file_don" }); } catch (e) { failed.push(`${f.name} (${e instanceof Error ? e.message : ""})`); }
    }
    if (failed.length) alert(`Đơn đã tạo nhưng ${failed.length} file chưa tải được:\n${failed.join("\n")}\nVào đơn để tải lại.`);
    router.push(`/don-hang/chi-tiet/?id=${data.id}`);
  };

  return (
    <>
      <PageHeader eyebrow="Vận hành · Đơn hàng" title="Tạo đơn hàng" desc="Điền đủ 5 phần để CSKH báo giá ngay, không phải hỏi lại khách. Dòng khai báo chi tiết nhập ở trang đơn (dán thẳng từ Excel)." />
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <Card>
          <Section n={1} title="Khách & công ty" desc="Công ty con nhận hàng và hóa đơn. Mỗi công ty có ví và công nợ riêng.">
            <div className="grid gap-3 sm:grid-cols-2">
              {s.isStaff ? <Field label="Khách hàng *"><select value={v.customer_id} onChange={(e) => setV({ ...v, customer_id: e.target.value, entity_id: "" })} className={inputCls}>
                <option value="">Chọn khách…</option>{(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field> : null}
              {s.entity ? <Field label="Công ty"><input disabled value={s.entity.legal_name} className={inputCls + " bg-surface"} /></Field> : (
                <Field label="Công ty con nhận hàng/HĐ *"><select value={v.entity_id} onChange={set("entity_id")} className={inputCls}><option value="">Chọn công ty…</option>
                  {(ents.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.code} · {e.legal_name}</option>)}</select></Field>
              )}
              <Field label="Mã đơn / PO của khách" hint="Để đối chiếu với file theo dõi của khách"><input value={v.customer_ref} onChange={set("customer_ref")} className={inputCls} /></Field>
              <Field label="Nguồn đơn"><select value={v.source_channel} onChange={set("source_channel")} className={inputCls}><option value="">—</option>{(sources.data ?? []).filter((x) => x.is_active).map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select></Field>
              {s.isStaff ? <Field label="CSKH phụ trách" hint="Trống = theo phân công khách"><select value={v.cs_owner_id} onChange={set("cs_owner_id")} className={inputCls}><option value="">Tự động</option>
                {(staff.data ?? []).filter((x) => x.is_active).map((x) => <option key={x.user_id} value={x.user_id}>{x.full_name}</option>)}</select></Field> : null}
            </div>
          </Section>
          <Section n={2} title="Hàng & nhà cung cấp">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><Field label="Mô tả hàng *"><input value={v.goods_desc} onChange={set("goods_desc")} placeholder="VD: Lì xì Tết 6 mẫu, treo cành mai…" className={inputCls} /></Field></div>
              <Field label="Nhóm hàng" hint="Ảnh hưởng mức cước/kg"><select value={v.goods_group} onChange={set("goods_group")} className={inputCls}><option value="">Chung</option>{(groups.data ?? []).filter((x) => x.is_active && x.code !== "chung").map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select></Field>
              <Field label="Shop / NCC"><input value={v.supplier_name} onChange={set("supplier_name")} className={inputCls} /></Field>
              <Field label="Link shop / sản phẩm"><input value={v.supplier_link} onChange={set("supplier_link")} placeholder="https://…" className={inputCls} /></Field>
              <Field label="Liên hệ NCC (WeChat / SĐT)"><input value={v.supplier_contact} onChange={set("supplier_contact")} className={inputCls} /></Field>
            </div>
          </Section>
          <Section n={3} title="Giá trị & hóa đơn" desc="Tiền hàng theo tệ. Hệ thống ước tính phí theo biểu phí hiện hành.">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Tổng tiền hàng (tệ) *"><input value={v.goods_cny} onChange={set("goods_cny")} inputMode="decimal" className={inputCls + " font-mono"} /></Field>
              <Field label="Tổng số lượng"><input value={v.goods_qty} onChange={set("goods_qty")} inputMode="decimal" className={inputCls + " font-mono"} /></Field>
              <Field label="Hình thức HĐ Trung Quốc"><select value={v.china_invoice_type} onChange={set("china_invoice_type")} className={inputCls}>{Object.entries(INVOICE_TYPE).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select></Field>
              {s.isStaff ? <>
                <Field label="Tỷ giá chốt *"><input value={v.fx_rate} onChange={set("fx_rate")} inputMode="decimal" className={inputCls + " font-mono"} /></Field>
                <Field label="VAT tạm tính (%)"><input value={v.vat_rate} onChange={set("vat_rate")} inputMode="decimal" className={inputCls + " font-mono"} /></Field>
                <Field label="Tỷ lệ cọc riêng (%)" hint={`Trống = mặc định ${preview?.deposit_rate ?? 80}%`}><input value={v.deposit_rate} onChange={set("deposit_rate")} inputMode="decimal" className={inputCls + " font-mono"} /></Field>
              </> : null}
            </div>
          </Section>
          <Section n={4} title="Yêu cầu & tiến độ">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tuần đặt hàng" hint="VD: 45/2026"><input value={v.order_week} onChange={set("order_week")} className={inputCls} /></Field>
              {s.isStaff ? <Field label="Dự kiến về (tuần)"><input value={v.expected_week} onChange={set("expected_week")} className={inputCls} /></Field> : <div />}
              <label className="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-sm"><input type="checkbox" checked={v.require_label_check} onChange={set("require_label_check")} className="h-4 w-4" /> Cần check tem / nhãn mác</label>
              <label className="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-sm"><input type="checkbox" checked={v.require_inspection} onChange={set("require_inspection")} className="h-4 w-4" /> Cần kiểm định / hợp quy</label>
              <div className="sm:col-span-2"><Field label="Địa chỉ giao hàng tại VN"><input value={v.delivery_address} onChange={set("delivery_address")} className={inputCls} /></Field></div>
              <div className="sm:col-span-2"><Field label="Ghi chú (khách thấy)"><textarea value={v.note} onChange={set("note")} rows={2} className={inputCls + " h-auto py-2"} /></Field></div>
              {s.isStaff ? <div className="sm:col-span-2"><Field label="Ghi chú nội bộ"><textarea value={v.internal_note} onChange={set("internal_note")} rows={2} className={inputCls + " h-auto py-2"} /></Field></div> : null}
            </div>
          </Section>
          <Section n={5} title="Ảnh & file đơn" desc="Ảnh sản phẩm, file Excel đơn, báo giá NCC. Lưu lên Google Drive khi tạo đơn.">
            <div tabIndex={0} onPaste={(e) => { const f = Array.from(e.clipboardData.files); if (f.length) { e.preventDefault(); setFiles((p) => [...p, ...f]); } }}
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setFiles((p) => [...p, ...Array.from(e.dataTransfer.files)]); }}
              className="rounded-xl border-2 border-dashed border-line bg-white/60 p-4 outline-none focus:border-brand/60">
              <label className="cursor-pointer rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white">+ Chọn file<input type="file" multiple hidden accept="image/*,.pdf,.xlsx,.xls,.docx,.csv,.zip" onChange={(e) => { setFiles((p) => [...p, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} /></label>
              <span className="ml-2 text-sm text-muted">hoặc kéo thả / dán ảnh (Ctrl+V)</span>
              {files.length ? <ul className="mt-3 flex flex-wrap gap-2">{files.map((f, i) => (
                <li key={i} className="flex items-center gap-1.5 rounded-md bg-surface px-2 py-1 text-xs">{f.type.startsWith("image/") ? "🖼" : "📄"} {f.name}
                  <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-danger">✕</button></li>))}</ul> : null}
            </div>
          </Section>
        </Card>

        <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <Card title="Ước tính phí (theo biểu phí)">
            {!preview ? <p className="text-sm text-muted">Chọn khách và nhập tổng tiền hàng để xem ước tính.</p> : (
              <table className="w-full text-[13px]"><tbody>
                <tr><td className="py-1">Tiền hàng ({fmtNumber(num(v.goods_cny))} × {fmtNumber(preview.fx_rate)})</td><td className="text-right font-mono">{vnd(preview.goods_vnd)}</td></tr>
                {preview.lines.map((l) => <tr key={l.label}><td className="py-1 text-muted">{l.label} <span className="text-[11px]">({fmtNumber(l.rate)}{l.method === "per_kg" ? "đ/kg" : "%"})</span></td><td className="text-right font-mono">{l.method === "per_kg" ? "theo cân" : vnd(l.amount_vnd)}</td></tr>)}
                <tr className="border-t border-line"><td className="py-1 text-muted">VAT</td><td className="text-right font-mono">{vnd(preview.vat_vnd)}</td></tr>
                <tr className="font-semibold"><td className="py-1">Ước tính (chưa gồm cước)</td><td className="text-right font-mono text-brand-strong">{vnd(preview.total_vnd)}</td></tr>
                <tr><td className="py-1 text-muted">Cọc dự kiến ({preview.deposit_rate}%)</td><td className="text-right font-mono">{vnd(preview.deposit_vnd)}</td></tr>
              </tbody></table>
            )}
            <p className="mt-3 text-[11px] text-muted">Số chính thức theo phiếu tính tiền CSKH lập sau khi chốt cân nặng và phí phát sinh.</p>
          </Card>
          <Card>
            {missing.length ? <p className="mb-3 text-xs text-amber-700">Còn thiếu: {missing.join(", ")}</p> : <p className="mb-3 text-xs text-ok">Đủ thông tin để gửi.</p>}
            {err ? <div className="mb-3"><Notice>{err}</Notice></div> : null}
            {busy ? <p className="mb-3 text-xs text-brand-strong">{busy}</p> : null}
            <div className="grid gap-2">
              <button disabled={!!busy} onClick={() => save(true)} className={btn.primary}>{s.isStaff ? "Tạo đơn · chuyển Chờ báo giá" : "Gửi đơn cho Nam Trung"}</button>
              <button disabled={!!busy} onClick={() => save(false)} className={btn.secondary}>Lưu nháp</button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
