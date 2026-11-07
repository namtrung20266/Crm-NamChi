"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { useStatusDefs, useLookups, SETTING_LABEL, LOOKUP_CATEGORY, PHASES, type StatusDef, type Lookup } from "@/lib/meta";
import { PageHeader, Card, DataList, Badge, Empty, Field, inputCls, Skeleton, btn } from "@/components/ui";
import { Form, Submit } from "@/components/ui/form";
import { fmtDate } from "@/lib/format";
import { useCustomers, useStaff } from "@/lib/data";
import Link from "next/link";
import { rpc } from "@/lib/meta";
import { viError } from "@/lib/errors";

const ROLE = { importer: "Đứng tên nhập khẩu", exporter: "Người xuất khẩu", supplier: "Nhà cung cấp" } as const;
const TONES = ["neutral", "brand", "warn", "ok", "danger", "info"] as const;
const OWNER: Record<string, string> = { cust: "Khách", cs: "CSKH", warehouse_cn: "Kho TQ", warehouse_vn: "Kho VN", xnk: "XNK", accountant: "Kế toán" };
type Setting = { id: string; key: string; value_json: unknown; valid_from: string; valid_to: string | null; note: string | null };

export default function SettingsPage() {
  const s = useSession();
  const [tab, setTab] = useState("tham-so");
  if (!s.can("settings.manage")) return <Empty title="Bạn không có quyền cấu hình hệ thống" />;
  return (
    <>
      <PageHeader eyebrow="Hệ thống" title="Cấu hình hệ thống" desc="Một nơi cho mọi tham số, danh mục, trạng thái đơn. Mọi thay đổi có lịch sử; tham số tạo bản mới có ngày hiệu lực nên không làm sai giao dịch cũ." />
      <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-white p-1 ring-1 ring-line">
        {[["tham-so", "Tham số nghiệp vụ"], ["phan-cong", "Phân công CSKH"], ["danh-muc", "Danh mục"], ["trang-thai", "Trạng thái đơn"], ["doi-tac", "Đối tác thương mại"], ["khac", "Biểu phí · quyền · nhân sự"]].map(([k, v]) => (
          <button key={k} onClick={() => setTab(k)} className={`shrink-0 rounded-lg px-3 py-2 text-[14px] font-semibold ${tab === k ? "bg-ink text-white" : "text-muted hover:text-ink"}`}>{v}</button>
        ))}
      </div>
      {tab === "tham-so" ? <Params /> : tab === "phan-cong" ? <Assignments /> : tab === "danh-muc" ? <Lookups /> : tab === "trang-thai" ? <Statuses /> : tab === "khac" ? <Hub /> : <Partners />}
    </>
  );
}

function Params() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => q<Setting[]>(supabase.from("app_settings").select("id, key, value_json, valid_from, valid_to, note").order("key").order("valid_from", { ascending: false })) });
  const [edit, setEdit] = useState<string | null>(null);
  const rows = settings.data ?? [];
  const now = Date.now();
  const current = [...new Set(rows.map((r) => r.key))].map((k) => rows.find((r) => r.key === k && new Date(r.valid_from).getTime() <= now && (!r.valid_to || new Date(r.valid_to).getTime() > now)) ?? rows.find((r) => r.key === k)!);
  const save = async (key: string, value: unknown, from: string, note: string) => {
    const { error } = await supabase.rpc("set_setting", { p_key: key, p_value: value, p_valid_from: from ? new Date(from + "T00:00:00+07:00").toISOString() : new Date().toISOString(), p_note: note || null });
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ["settings"] }); setEdit(null);
  };
  if (settings.isLoading) return <Skeleton />;
  const groups: [string, string][] = [["order", "Đơn hàng"], ["finance", "Tài chính"], ["wallet", "Ví khách"], ["shipping", "Vận chuyển"], ["file", "File"], ["notify", "Thông báo"]];
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {groups.map(([g, label]) => {
        const list = current.filter((r) => r.key.startsWith(g + "."));
        if (!list.length) return null;
        return (
          <Card key={g} title={label}>
            <ul className="divide-y divide-line/70">{list.map((r) => {
              const bool = typeof r.value_json === "boolean";
              const hist = rows.filter((x) => x.key === r.key);
              return (
                <li key={r.key} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><div className="text-sm font-medium">{SETTING_LABEL[r.key] ?? r.key}</div><div className="font-mono text-[12px] text-muted">{r.key} · từ {fmtDate(r.valid_from)}{hist.length > 1 ? ` · ${hist.length} phiên bản` : ""}</div></div>
                    {bool ? (
                      <button onClick={async () => { const note = prompt(`Lý do ${r.value_json ? "TẮT" : "BẬT"}: ${SETTING_LABEL[r.key] ?? r.key}`); if (note === null) return; try { await save(r.key, !r.value_json, "", note); } catch (e) { alert(viError(e)); } }}
                        className={`relative h-6 w-11 shrink-0 rounded-full transition ${r.value_json ? "bg-ok" : "bg-stone-300"}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${r.value_json ? "left-[22px]" : "left-0.5"}`} /></button>
                    ) : (
                      <button onClick={() => setEdit(edit === r.key ? null : r.key)} className="flex shrink-0 items-center gap-2"><span className="font-mono text-sm font-semibold">{JSON.stringify(r.value_json)}</span><span className="text-xs text-brand-strong">Đổi</span></button>
                    )}
                  </div>
                  {edit === r.key ? (
                    <Form className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]" onSubmit={async (f) => {
                      let v: unknown; try { v = JSON.parse(String(f.get("v") ?? "")); } catch { return { error: "Giá trị phải là số hoặc JSON" }; }
                      try { await save(r.key, v, String(f.get("from") ?? ""), String(f.get("note") ?? "")); return { ok: true }; } catch (e) { return { error: viError(e) }; }
                    }}>
                      <input name="v" defaultValue={JSON.stringify(r.value_json)} className={inputCls + " font-mono"} /><input name="from" type="date" title="Áp dụng từ (trống = ngay)" className={inputCls} />
                      <input name="note" placeholder="Lý do thay đổi" className={inputCls} /><Submit>Lưu</Submit>
                    </Form>
                  ) : null}
                </li>
              );
            })}</ul>
          </Card>
        );
      })}
    </div>
  );
}

function Lookups() {
  const qc = useQueryClient();
  const all = useLookups();
  const [cat, setCat] = useState("goods_group");
  const [edit, setEdit] = useState<Lookup | null>(null);
  const rows = (all.data ?? []).filter((r) => r.category === cat);
  const bank = cat === "topup_account";
  const submit = async (f: FormData) => {
    const code = String(f.get("code") ?? "").trim().toLowerCase();
    const label = String(f.get("label") ?? "").trim();
    if (!/^[a-z0-9_]{1,40}$/.test(code) || !label) return { error: "Mã: chữ thường không dấu, số, gạch dưới. Tên bắt buộc." };
    const meta = bank ? { bank: String(f.get("bank") ?? ""), account_no: String(f.get("account_no") ?? ""), holder: String(f.get("holder") ?? "") } : edit?.meta ?? {};
    const row = { category: cat, code, label, sort_order: Number(f.get("sort_order") || 100), is_active: f.get("is_active") === "on", meta };
    const r = edit ? await supabase.from("lookup_values").update({ ...row, row_version: edit.row_version }).eq("id", edit.id) : await supabase.from("lookup_values").insert(row);
    if (r.error) return { error: viError(r.error) };
    setEdit(null); qc.invalidateQueries({ queryKey: ["lookups"] });
    return { ok: true, message: "Đã lưu danh mục." };
  };
  return (
    <div className="grid gap-5 xl:grid-cols-[220px_1fr_360px]">
      <Card><ul className="space-y-1">{Object.entries(LOOKUP_CATEGORY).map(([k, v]) => (
        <li key={k}><button onClick={() => { setCat(k); setEdit(null); }} className={`flex w-full justify-between rounded-lg px-3 py-2 text-left text-sm ${cat === k ? "nav-active" : "hover:bg-surface"}`}>{v}<span className="font-mono text-xs text-muted">{(all.data ?? []).filter((r) => r.category === k).length}</span></button></li>
      ))}</ul></Card>
      <Card title={LOOKUP_CATEGORY[cat]}>
        {all.isLoading ? <Skeleton /> : rows.length === 0 ? <Empty title="Chưa có giá trị" /> : (
          <ul className="divide-y divide-line/70">{rows.map((r) => (
            <li key={r.id} className={`flex items-center justify-between gap-3 py-2 text-sm ${r.is_active ? "" : "opacity-50"}`}>
              <div className="min-w-0"><div className="font-medium">{r.label}</div><div className="font-mono text-[12px] text-muted">{r.code} · thứ tự {r.sort_order}{bank ? ` · ${String((r.meta as Record<string, string>).account_no ?? "")}` : ""}</div></div>
              <div className="flex items-center gap-2">{r.is_active ? null : <Badge>Tắt</Badge>}<button onClick={() => setEdit(r)} className="text-xs font-semibold text-brand-strong">Sửa</button></div>
            </li>))}</ul>
        )}
      </Card>
      <Card title={edit ? `Sửa: ${edit.label}` : "Thêm giá trị"}>
        <Form key={edit?.id ?? cat} onSubmit={submit} resetOnOk={!edit}>
          <Field label="Mã (không đổi sau khi dùng)"><input name="code" defaultValue={edit?.code} readOnly={!!edit} className={inputCls + " font-mono"} /></Field>
          <Field label={cat === "quick_reply" ? "Nội dung câu trả lời" : "Tên hiển thị"}>{cat === "quick_reply" ? <textarea name="label" rows={3} defaultValue={edit?.label} className={inputCls + " h-auto py-2"} /> : <input name="label" defaultValue={edit?.label} className={inputCls} />}</Field>
          {bank ? <>
            <Field label="Ngân hàng"><input name="bank" defaultValue={String((edit?.meta as Record<string, string>)?.bank ?? "")} className={inputCls} /></Field>
            <Field label="Số tài khoản"><input name="account_no" defaultValue={String((edit?.meta as Record<string, string>)?.account_no ?? "")} className={inputCls + " font-mono"} /></Field>
            <Field label="Chủ tài khoản"><input name="holder" defaultValue={String((edit?.meta as Record<string, string>)?.holder ?? "")} className={inputCls} /></Field>
          </> : null}
          <div className="grid grid-cols-2 gap-3"><Field label="Thứ tự"><input name="sort_order" defaultValue={edit?.sort_order ?? 100} className={inputCls + " font-mono"} /></Field>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={edit?.is_active ?? true} /> Đang dùng</label></div>
          <div className="flex justify-end gap-2">{edit ? <button type="button" onClick={() => setEdit(null)} className={btn.ghost}>Hủy</button> : null}<Submit>{edit ? "Lưu" : "Thêm"}</Submit></div>
        </Form>
      </Card>
    </div>
  );
}

function Statuses() {
  const qc = useQueryClient();
  const defs = useStatusDefs();
  const [edit, setEdit] = useState<StatusDef | null>(null);
  return (
    <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
      <Card title="Luồng trạng thái đơn" actions={<span className="text-xs text-muted">SLA = số ngày tối đa ở bước, quá thì cảnh báo</span>}>
        {defs.isLoading ? <Skeleton /> : (
          <ul className="divide-y divide-line/70">{(defs.data ?? []).map((d) => (
            <li key={d.code} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-10 font-mono text-xs text-muted">{d.rank}</span>
              <Badge tone={d.tone}>{d.label}</Badge>
              <span className="hidden text-xs text-muted sm:inline">{PHASES[d.phase]}{d.owner_role ? ` · ${OWNER[d.owner_role] ?? d.owner_role}` : ""}</span>
              <span className="ml-auto text-xs text-muted">{d.sla_days ? `SLA ${d.sla_days}n` : "—"} · {d.notify_customer ? "báo khách" : "không báo"}</span>
              <button onClick={() => setEdit(d)} className="text-xs font-semibold text-brand-strong">Sửa</button>
            </li>))}</ul>
        )}
        <p className="mt-3 text-[12.5px] text-muted">Mã và thứ tự bước là của hệ thống (logic tự chuyển trạng thái dựa vào đó), chỉ đổi được tên, màu, SLA, thông báo.</p>
      </Card>
      {edit ? (
        <Card title={`Sửa trạng thái: ${edit.code}`}>
          <Form key={edit.code} onSubmit={async (f) => {
            const { error } = await supabase.from("order_status_defs").update({ label: String(f.get("label")), customer_label: String(f.get("customer_label") ?? "") || null, tone: f.get("tone"),
              sla_days: Number(f.get("sla_days")) || null, notify_customer: f.get("notify") === "on", description: String(f.get("description") ?? "") || null, owner_role: String(f.get("owner_role") ?? "") || null }).eq("code", edit.code);
            if (error) return { error: viError(error) };
            qc.invalidateQueries({ queryKey: ["status-defs"] }); setEdit(null); return { ok: true };
          }}>
            <Field label="Tên nội bộ"><input name="label" defaultValue={edit.label} className={inputCls} /></Field>
            <Field label="Tên khách thấy"><input name="customer_label" defaultValue={edit.customer_label ?? ""} className={inputCls} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Màu"><select name="tone" defaultValue={edit.tone} className={inputCls}>{TONES.map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
              <Field label="SLA (ngày)"><input name="sla_days" defaultValue={edit.sla_days ?? ""} className={inputCls + " font-mono"} /></Field>
              <Field label="Bộ phận phụ trách"><select name="owner_role" defaultValue={edit.owner_role ?? ""} className={inputCls}><option value="">—</option>{Object.entries(OWNER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="notify" defaultChecked={edit.notify_customer} /> Báo khách</label>
            </div>
            <Field label="Mô tả bước"><textarea name="description" rows={2} defaultValue={edit.description ?? ""} className={inputCls + " h-auto py-2"} /></Field>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setEdit(null)} className={btn.ghost}>Hủy</button><Submit>Lưu</Submit></div>
          </Form>
        </Card>
      ) : <Card><p className="text-sm text-muted">Chọn một trạng thái để sửa.</p></Card>}
    </div>
  );
}

function Partners() {
  const parties = useQuery({ queryKey: ["parties"], queryFn: () => q<{ id: string; code: string; party_role: string; legal_name: string; tax_code: string | null }[]>(supabase.from("trade_parties").select("id, code, party_role, legal_name, tax_code").order("party_role").order("code")) });
  return (
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
  );
}

type Asg = { id: string; staff_user_id: string; customer_id: string; entity_id: string | null; valid_from: string; valid_to: string | null };
type Ent = { id: string; customer_id: string; code: string; legal_name: string };

// Phân công: Quản lý CSKH cho khách tổng, CSKH cho từng công ty con. Đổi bất cứ lúc nào, giữ lịch sử.
function Assignments() {
  const qc = useQueryClient();
  const customers = useCustomers();
  const staff = useStaff();
  const ents = useQuery({ queryKey: ["all-entities"], queryFn: () => q<Ent[]>(supabase.from("customer_entities").select("id, customer_id, code, legal_name").is("deleted_at", null).order("legal_name")) });
  const asg = useQuery({ queryKey: ["assignments"], queryFn: () => q<Asg[]>(supabase.from("staff_customer_assignments").select("id, staff_user_id, customer_id, entity_id, valid_from, valid_to").order("valid_from", { ascending: false })) });
  const [move, setMove] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const current = (c: string, e: string | null) => (asg.data ?? []).find((a) => a.customer_id === c && a.entity_id === e && a.valid_from <= today && (!a.valid_to || a.valid_to >= today));
  const history = (c: string, e: string | null) => (asg.data ?? []).filter((a) => a.customer_id === c && a.entity_id === e && a.valid_to && a.valid_to < today).slice(0, 3);
  const name = (u: string) => staff.data?.find((x) => x.user_id === u)?.full_name ?? "?";
  const set = async (c: string, e: string | null, u: string) => {
    setBusy(c + (e ?? ""));
    try { await rpc("set_cs_assignment", { p_customer_id: c, p_entity_id: e, p_staff_user_id: u || null, p_move_open_orders: move && !!e }); qc.invalidateQueries({ queryKey: ["assignments"] }); qc.invalidateQueries({ queryKey: ["admin-orders"] }); }
    catch (x) { alert(viError(x)); } finally { setBusy(null); }
  };
  const Pick = ({ c, e }: { c: string; e: string | null }) => {
    const cur = current(c, e);
    return (
      <div className="flex items-center gap-2">
        <select value={cur?.staff_user_id ?? ""} disabled={busy === c + (e ?? "")} onChange={(x) => set(c, e, x.target.value)} className={inputCls + " h-10 w-56"}>
          <option value="">— Chưa phân công —</option>{(staff.data ?? []).filter((x) => x.is_active).map((x) => <option key={x.user_id} value={x.user_id}>{x.full_name}</option>)}
        </select>
        {cur ? <span className="text-[13px] text-muted">từ {fmtDate(cur.valid_from)}</span> : null}
        {history(c, e).length ? <span className="text-[13px] text-muted">· trước: {history(c, e).map((h) => name(h.staff_user_id)).join(", ")}</span> : null}
      </div>
    );
  };
  if (customers.isLoading || ents.isLoading) return <Skeleton />;
  return (
    <div className="space-y-5">
      <Card>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={move} onChange={(e) => setMove(e.target.checked)} className="h-4 w-4" /> Khi đổi CSKH công ty con: chuyển luôn các đơn đang chạy sang người mới</label>
        <p className="mt-1 text-[13px] text-muted">Quản lý CSKH (khách tổng) nhận thông báo mọi công ty con. CSKH công ty con được tự gán vào đơn mới và nhận thông báo đơn của công ty đó.</p>
      </Card>
      {(customers.data ?? []).map((c) => (
        <Card key={c.id} title={`${c.code} · ${c.name}`}>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-brand-soft/60 px-4 py-3"><div><div className="font-semibold">Quản lý CSKH (khách tổng)</div><div className="text-[13px] text-muted">Theo dõi tất cả công ty con</div></div><Pick c={c.id} e={null} /></div>
            {(ents.data ?? []).filter((e) => e.customer_id === c.id).map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line/70 px-4 pt-3"><div><div className="font-medium">{e.legal_name}</div><div className="text-[13px] text-muted">{e.code}</div></div><Pick c={c.id} e={e.id} /></div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

// Lối tắt tới các mục cấu hình có trang riêng
function Hub() {
  const items: [string, string, string][] = [
    ["/bieu-phi/", "Biểu phí & giá vốn", "Giá bán, giá vốn từng loại phí theo khách tổng/công ty con, loại HĐ, nhóm hàng; có ngày hiệu lực"],
    ["/phan-quyen/", "Phân quyền", "Vai trò và quyền từng chức năng (nhân viên, khách)"],
    ["/nhan-vien/", "Nhân viên", "Tài khoản nhân viên, vai trò"],
    ["/khach-hang/", "Khách hàng & công ty con", "Thông tin pháp lý, tài khoản khách"],
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {items.map(([href, t, d]) => (
        <Link key={href} href={href} className="card block p-5 transition hover:-translate-y-0.5 hover:shadow-md"><div className="text-base font-semibold">{t} →</div><div className="mt-1 text-sm text-muted">{d}</div></Link>
      ))}
    </div>
  );
}
