"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { useStaff } from "@/lib/data";
import { useLookups, lookupLabel, rpc } from "@/lib/meta";
import { Card, Badge, Field, inputCls, btn } from "./ui";
import { viError } from "@/lib/errors";

type Ent = { id: string; customer_id: string; code: string; legal_name: string; tax_code: string | null; invoice_address: string | null; invoice_email: string | null;
  contact_name: string | null; contact_phone: string | null; note: string | null; status: string; settings: Record<string, string | number | null> };
type Asg = { staff_user_id: string; entity_id: string | null; role: string; valid_from: string; valid_to: string | null };
const SET_KEYS: [string, string, "num" | "text" | "kind" | "payer"][] = [
  ["deposit_rate", "Tỷ lệ cọc (%)", "num"], ["vat_rate", "VAT bán (%)", "num"], ["china_invoice_kind", "Loại HĐ TQ mặc định", "kind"],
  ["china_tax_payer", "Thuế HĐ TQ do ai chịu", "payer"], ["delivery_address", "Địa chỉ giao hàng", "text"], ["receiver_name", "Người nhận hàng", "text"], ["receiver_phone", "SĐT người nhận", "text"],
];
const CS_SETTINGS = ["delivery_address", "receiver_name", "receiver_phone"];

function useAssignments(customerId: string) {
  return useQuery({ queryKey: ["assignments", customerId], queryFn: () => q<Asg[]>(supabase.from("staff_customer_assignments").select("staff_user_id, entity_id, role, valid_from, valid_to").eq("customer_id", customerId)) });
}
function AssignPick({ customerId, entityId, role, label }: { customerId: string; entityId: string | null; role: "cs" | "accountant"; label: string }) {
  const s = useSession();
  const qc = useQueryClient();
  const staff = useStaff();
  const asg = useAssignments(customerId);
  const today = new Date().toISOString().slice(0, 10);
  const cur = (asg.data ?? []).find((a) => a.entity_id === entityId && a.role === role && a.valid_from <= today && (!a.valid_to || a.valid_to >= today));
  const can = s.can("customer.write") || s.can("user.manage");
  const name = staff.data?.find((x) => x.user_id === cur?.staff_user_id)?.full_name;
  return (
    <Field label={label}>
      {can ? <select value={cur?.staff_user_id ?? ""} onChange={async (e) => {
        try { await rpc("set_assignment", { p_customer_id: customerId, p_entity_id: entityId, p_role: role, p_staff_user_id: e.target.value || null, p_move_open_orders: role === "cs" && !!entityId });
          qc.invalidateQueries({ queryKey: ["assignments"] }); qc.invalidateQueries({ queryKey: ["admin-orders"] }); } catch (x) { alert(viError(x)); } }} className={inputCls}>
        <option value="">— Chưa phân công —</option>{(staff.data ?? []).filter((x) => x.is_active).map((x) => <option key={x.user_id} value={x.user_id}>{x.full_name}</option>)}
      </select> : <div className="py-2 font-medium">{name ?? "—"}</div>}
    </Field>
  );
}

// Ô cấu hình: để trống = lấy của khách tổng (hiện mờ phía dưới)
function SettingsForm({ kind, id, value, parent, canFull, onSaved }: { kind: "customer" | "entity"; id: string; value: Record<string, unknown>; parent?: Record<string, unknown>; canFull: boolean; onSaved: () => void }) {
  const kinds = useLookups("china_invoice_kind");
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(SET_KEYS.map(([k]) => [k, value[k] == null ? "" : String(value[k])])));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const settings: Record<string, unknown> = {};
    for (const [k, , t] of SET_KEYS) { if (!canFull && !CS_SETTINGS.includes(k)) continue; settings[k] = v[k] === "" ? null : t === "num" ? Number(v[k].replace(",", ".")) : v[k]; }
    try { await rpc("update_customer_profile", { p_kind: kind, p_id: id, p_patch: { settings } }); onSaved(); } catch (e) { alert(viError(e)); } finally { setBusy(false); }
  };
  const inh = (k: string) => { const x = parent?.[k]; if (x == null || x === "") return kind === "entity" ? "theo cấu hình hệ thống" : "theo cấu hình hệ thống";
    return `khách tổng: ${k === "china_invoice_kind" ? lookupLabel(kinds.data, String(x)) : k === "china_tax_payer" ? (x === "cong_ty" ? "Nam Trung" : "Khách") : String(x)}`; };
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {SET_KEYS.map(([k, label, t]) => {
        const dis = !canFull && !CS_SETTINGS.includes(k);
        const common = { value: v[k], disabled: dis, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value }), className: inputCls + (dis ? " bg-surface" : "") };
        return (
          <Field key={k} label={label} hint={kind === "entity" ? `Trống = ${inh(k)}` : "Trống = theo cấu hình hệ thống"}>
            {t === "kind" ? <select {...common}><option value="">— Mặc định —</option>{(kinds.data ?? []).map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select>
              : t === "payer" ? <select {...common}><option value="">— Mặc định —</option><option value="khach">Khách chịu (thu trên phiếu)</option><option value="cong_ty">Nam Trung chịu (không thu khách)</option></select>
              : <input {...common} inputMode={t === "num" ? "decimal" : undefined} />}
          </Field>
        );
      })}
      <div className="flex items-end"><button onClick={save} disabled={busy} className={btn.primary + " w-full"}>{busy ? "…" : "Lưu cấu hình"}</button></div>
    </div>
  );
}

// Khách tổng: Quản lý CSKH, kế toán, cấu hình chung (công ty con không đặt thì dùng cấu hình này)
export function CustomerGroupPanel({ customerId, settings, onSaved }: { customerId: string; settings: Record<string, unknown>; onSaved: () => void }) {
  const s = useSession();
  return (
    <Card title="Phụ trách & cấu hình chung của khách tổng">
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <AssignPick customerId={customerId} entityId={null} role="cs" label="Quản lý CSKH (xem mọi công ty con)" />
        <AssignPick customerId={customerId} entityId={null} role="accountant" label="Kế toán phụ trách" />
      </div>
      <SettingsForm kind="customer" id={customerId} value={settings} canFull={s.can("customer.write")} onSaved={onSaved} />
    </Card>
  );
}

// Từng công ty con: hồ sơ, liên hệ, cấu hình riêng, CSKH/Kế toán, lối tắt biểu phí riêng
export function EntityProfiles({ customerId, parent }: { customerId: string; parent: Record<string, unknown> }) {
  const s = useSession();
  const qc = useQueryClient();
  const ents = useQuery({ queryKey: ["entity-profiles", customerId], queryFn: () => q<Ent[]>(supabase.from("customer_entities")
    .select("id, customer_id, code, legal_name, tax_code, invoice_address, invoice_email, contact_name, contact_phone, note, status, settings").eq("customer_id", customerId).is("deleted_at", null).order("legal_name")) });
  const [open, setOpen] = useState<string | null>(null);
  const full = s.can("customer.write");
  const refresh = () => { qc.invalidateQueries({ queryKey: ["entity-profiles", customerId] }); qc.invalidateQueries({ queryKey: ["entities"] }); };
  const saveInfo = async (e: Ent, f: FormData) => {
    const keys = full ? ["legal_name", "tax_code", "invoice_address", "invoice_email", "contact_name", "contact_phone", "note"] : ["invoice_email", "contact_name", "contact_phone", "note"];
    const patch = Object.fromEntries(keys.map((k) => [k, String(f.get(k) ?? "")]));
    try { await rpc("update_customer_profile", { p_kind: "entity", p_id: e.id, p_patch: patch }); refresh(); } catch (x) { alert(viError(x)); }
  };
  return (
    <div className="space-y-4">
      {(ents.data ?? []).map((e) => {
        const isOpen = open === e.id;
        const custom = Object.keys(e.settings ?? {}).length;
        return (
          <Card key={e.id} title={`${e.legal_name}`} actions={<div className="flex items-center gap-2">{custom ? <Badge tone="brand">{custom} cấu hình riêng</Badge> : <Badge>Theo khách tổng</Badge>}
            <button onClick={() => setOpen(isOpen ? null : e.id)} className="text-sm font-semibold text-brand-strong">{isOpen ? "Thu gọn" : "Mở hồ sơ"}</button></div>}>
            <div className="grid gap-3 sm:grid-cols-2">
              <AssignPick customerId={customerId} entityId={e.id} role="cs" label="CSKH phụ trách" />
              <AssignPick customerId={customerId} entityId={e.id} role="accountant" label="Kế toán phụ trách" />
            </div>
            <div className="mt-2 text-sm text-muted">{e.code} · MST {e.tax_code ?? "—"} · {e.contact_name ?? "chưa có liên hệ"} {e.contact_phone ?? ""}</div>
            {isOpen ? (
              <div className="mt-4 space-y-5 border-t border-line pt-4">
                <form onSubmit={(ev) => { ev.preventDefault(); saveInfo(e, new FormData(ev.currentTarget)); }} className="grid gap-3 sm:grid-cols-2">
                  {([["legal_name", "Tên pháp lý (xuất HĐ)", true], ["tax_code", "Mã số thuế", true], ["invoice_address", "Địa chỉ xuất HĐ", true], ["invoice_email", "Email nhận HĐ", false],
                    ["contact_name", "Người liên hệ", false], ["contact_phone", "SĐT liên hệ", false], ["note", "Ghi chú", false]] as const).map(([k, l, fullOnly]) => (
                    <Field key={k} label={l}><input name={k} defaultValue={(e[k] as string | null) ?? ""} disabled={fullOnly && !full} className={inputCls + (fullOnly && !full ? " bg-surface" : "")} /></Field>
                  ))}
                  <div className="flex items-end"><button className={btn.secondary + " w-full"}>Lưu thông tin</button></div>
                </form>
                <div><div className="mb-2 text-sm font-semibold">Cấu hình riêng {!full ? <span className="font-normal text-muted">(CSKH chỉ sửa được địa chỉ/người nhận)</span> : null}</div>
                  <SettingsForm kind="entity" id={e.id} value={e.settings ?? {}} parent={parent} canFull={full} onSaved={refresh} /></div>
                <div className="flex flex-wrap gap-2 text-sm">
                  <Link href={`/bieu-phi/?entity=${e.id}`} className={btn.secondary}>Biểu phí riêng của công ty này →</Link>
                </div>
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
