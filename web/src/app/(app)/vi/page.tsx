"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { useCustomers, useEntities } from "@/lib/data";
import { useLookups, lookupLabel, rpc } from "@/lib/meta";
import { uploadFile, useAttachments } from "@/lib/files";
import { PageHeader, Card, Badge, Empty, Field, inputCls, btn, Notice, Skeleton, usePaged } from "@/components/ui";
import { ActionButton } from "@/components/ui/form";
import { Thumb, FileDrop } from "@/components/files";
import { Modal } from "@/components/modal";
import { vnd, fmtDate, fmtDateTime, parseMoney } from "@/lib/format";
import { viError } from "@/lib/errors";
import { downloadCsv } from "@/lib/csv";

type Bal = { customer_id: string; entity_id: string; entity_code: string; legal_name: string; balance_vnd: number; topup_vnd: number; spent_vnd: number; pending_topups: number; last_movement_at: string | null };
type Top = { id: string; code: string; customer_id: string; entity_id: string; amount_vnd: number; transfer_date: string; account_code: string | null; bank_ref: string | null; payer_name: string | null; note: string | null; status: string; review_note: string | null; created_at: string; created_by: string };
type Led = { id: number; entity_id: string; amount_vnd: number; kind: string; note: string | null; created_at: string; order_id: string | null; reverses_id: number | null };
const TS: Record<string, [string, "warn" | "ok" | "danger" | "neutral"]> = { cho_duyet: ["Chờ duyệt", "warn"], da_duyet: ["Đã cộng ví", "ok"], tu_choi: ["Từ chối", "danger"], huy: ["Đã hủy", "neutral"] };
const KIND: Record<string, string> = { nap: "Nạp ví", coc: "Đặt cọc đơn", thanh_toan: "Thanh toán đơn", hoan_don: "Hoàn từ đơn", dieu_chinh: "Điều chỉnh", dao: "Đảo bút toán" };

export default function WalletPage() {
  const s = useSession();
  const qc = useQueryClient();
  const customers = useCustomers();
  const [cust, setCust] = useState(s.customer?.id ?? "");
  const [ent, setEnt] = useState(s.entity?.id ?? "");
  const [stF, setStF] = useState(s.isStaff ? "cho_duyet" : "");
  const ents = useEntities(cust || null);
  const accounts = useLookups("topup_account");
  const bals = useQuery({ queryKey: ["wallets"], queryFn: () => q<Bal[]>(supabase.from("wallet_balances").select("*").order("legal_name")) });
  const tops = useQuery({ queryKey: ["topups", stF, ent], queryFn: () => { let x = supabase.from("wallet_topups").select("*").order("created_at", { ascending: false }).limit(300); if (stF) x = x.eq("status", stF); if (ent) x = x.eq("entity_id", ent); return q<Top[]>(x); } });
  const ledger = useQuery({ queryKey: ["ledger", ent], queryFn: () => { let x = supabase.from("wallet_ledger").select("*").order("created_at", { ascending: false }).limit(300); if (ent) x = x.eq("entity_id", ent); return q<Led[]>(x); } });
  const proofs = useAttachments("wallet_topup", (tops.data ?? []).map((t) => t.id));
  const [form, setForm] = useState(false);
  const [review, setReview] = useState<Top | null>(null);
  const [f, setF] = useState({ entity_id: s.entity?.id ?? "", amount: "", transfer_date: new Date().toISOString().slice(0, 10), account_code: "", bank_ref: "", payer_name: "", note: "" });
  const [proof, setProof] = useState<File[]>([]);
  const [rv, setRv] = useState({ amount: "", note: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tp = usePaged(tops.data ?? []);
  const lp = usePaged(ledger.data ?? []);
  if (s.isStaff ? !s.can("finance.read") : !s.can("wallet.topup_own")) return <Empty title="Bạn không có quyền xem ví" />;
  const refresh = () => ["wallets", "topups", "ledger", "dashboard", "attachments"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const entName = (id: string) => bals.data?.find((b) => b.entity_id === id)?.legal_name ?? "";
  const B = (bals.data ?? []).filter((b) => (!cust || b.customer_id === cust) && (!ent || b.entity_id === ent));
  const manage = s.isStaff && s.can("finance.receipt.write");
  const formEnts = s.isStaff ? ents.data ?? [] : (bals.data ?? []).map((b) => ({ id: b.entity_id, legal_name: b.legal_name, customer_id: b.customer_id }));

  const create = async () => {
    setErr(null);
    const e = formEnts.find((x) => x.id === f.entity_id);
    if (!e) return setErr("Chọn công ty");
    if (!s.isStaff && !proof.length) return setErr("Đính kèm ảnh chuyển khoản để kế toán đối chiếu");
    setBusy(true);
    try {
      const id = await rpc<string>("create_topup", { p_customer_id: e.customer_id, p_entity_id: e.id, p_amount: parseMoney(f.amount), p_transfer_date: f.transfer_date,
        p_account_code: f.account_code || null, p_bank_ref: f.bank_ref || null, p_payer_name: f.payer_name || null, p_note: f.note || null });
      for (const file of proof) await uploadFile(file, "wallet_topup", id, { category: "chung_tu_ck" });
      setForm(false); setProof([]); setF({ ...f, amount: "", bank_ref: "", note: "" }); refresh();
    } catch (x) { setErr(x instanceof Error && !("code" in x) ? x.message : viError(x)); } finally { setBusy(false); }
  };
  const doReview = async (approve: boolean) => {
    if (!review) return; setBusy(true); setErr(null);
    try { await rpc("review_topup", { p_topup_id: review.id, p_approve: approve, p_note: rv.note || null, p_amount: rv.amount ? parseMoney(rv.amount) : null }); setReview(null); refresh(); }
    catch (x) { setErr(viError(x)); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader eyebrow="Tài chính" title={s.isStaff ? "Ví khách hàng & nạp tiền" : "Ví của công ty"}
        desc={s.isStaff ? "Mỗi công ty con một ví. Khách nạp kèm ảnh chuyển khoản → kế toán duyệt → tiền vào ví → cọc/thanh toán đơn trừ ví. Sai thì đảo, không xóa." : "Nạp tiền kèm ảnh chuyển khoản, Nam Trung duyệt rồi cộng ví. Đặt cọc/thanh toán ngay trên trang đơn."}
        actions={<button onClick={() => { setForm(true); setErr(null); }} className={btn.primary}>{s.isStaff ? "+ Ghi nhận tiền vào" : "+ Nạp tiền"}</button>} />

      {s.isStaff ? (
        <div className="mb-4 flex flex-wrap gap-2">
          <select value={cust} onChange={(e) => { setCust(e.target.value); setEnt(""); }} className={inputCls + " w-auto"}><option value="">Mọi khách</option>{(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
          <select value={ent} onChange={(e) => setEnt(e.target.value)} className={inputCls + " w-auto"}><option value="">Mọi công ty con</option>{(ents.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}</select>
        </div>
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {bals.isLoading ? <Skeleton /> : B.map((b) => (
          <button key={b.entity_id} onClick={() => setEnt(ent === b.entity_id ? "" : b.entity_id)} className={`card p-4 text-left transition hover:-translate-y-0.5 ${ent === b.entity_id ? "ring-2 ring-brand" : ""}`}>
            <div className="truncate text-xs text-muted">{b.legal_name}</div>
            <div className={`mt-1 font-mono text-xl font-semibold ${b.balance_vnd < 0 ? "text-danger" : "text-brand-strong"}`}>{vnd(b.balance_vnd)}</div>
            <div className="mt-1 text-[12.5px] text-muted">Nạp {vnd(b.topup_vnd)} · đã dùng {vnd(b.spent_vnd)}{b.pending_topups ? <span className="text-amber-700"> · {b.pending_topups} chờ duyệt</span> : null}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        <Card title="Yêu cầu nạp / tiền vào" actions={<select value={stF} onChange={(e) => setStF(e.target.value)} className="h-8 rounded-md border border-line px-2 text-xs"><option value="">Tất cả</option>{Object.entries(TS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select>}>
          {(tops.data ?? []).length === 0 ? <Empty title={stF === "cho_duyet" ? "Không có yêu cầu chờ duyệt" : "Chưa có giao dịch"} /> : (
            <><ul className="divide-y divide-line/70">{tp.view.map((t) => {
              const pics = (proofs.data ?? []).filter((a) => a.entity_ref_id === t.id);
              return (
                <li key={t.id} className="flex flex-wrap items-start gap-3 py-3">
                  <div className="flex gap-1.5">{pics.length ? pics.slice(0, 2).map((a) => <Thumb key={a.id} a={a} size={56} />) : <span className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-line text-[12px] text-muted">Chưa có ảnh</span>}</div>
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-mono font-semibold">{t.code}</span><Badge tone={TS[t.status][1]}>{TS[t.status][0]}</Badge><span className="font-mono font-semibold text-brand-strong">{vnd(t.amount_vnd)}</span></div>
                    <div className="text-xs text-muted">{entName(t.entity_id)} · CK {fmtDate(t.transfer_date)} · {lookupLabel(accounts.data, t.account_code)}{t.bank_ref ? ` · mã GD ${t.bank_ref}` : ""}{t.payer_name ? ` · ${t.payer_name}` : ""}</div>
                    {t.note ? <div className="text-xs">{t.note}</div> : null}{t.review_note ? <div className="text-xs text-amber-800">KT: {t.review_note}</div> : null}
                  </div>
                  <div className="flex gap-1.5">
                    {manage && t.status === "cho_duyet" ? <button onClick={() => { setReview(t); setRv({ amount: String(t.amount_vnd), note: "" }); setErr(null); }} className={btn.primary + " h-8 px-3 text-xs"}>Duyệt</button> : null}
                    {t.status === "cho_duyet" && (s.isStaff || t.created_by === s.user_id) ? <ActionButton confirmText="Hủy yêu cầu nạp này?" onClick={async () => { await rpc("cancel_topup", { p_topup_id: t.id }); refresh(); }}>Hủy</ActionButton> : null}
                  </div>
                </li>
              );
            })}</ul>{tp.pager}</>
          )}
        </Card>
        <Card title="Sổ ví" actions={<button onClick={() => downloadCsv("so-vi.csv", ["#", "Ngày", "Công ty", "Loại", "Số tiền", "Ghi chú"], (ledger.data ?? []).map((l) => [l.id, fmtDateTime(l.created_at), entName(l.entity_id), KIND[l.kind], l.amount_vnd, l.note]))} className="text-xs font-semibold text-brand-strong">Xuất Excel</button>}>
          {(ledger.data ?? []).length === 0 ? <p className="text-sm text-muted">Chưa có phát sinh.</p> : (
            <><ul className="divide-y divide-line/70 text-sm">{lp.view.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-2 py-2">
                <div className="min-w-0"><div className="font-medium">{KIND[l.kind] ?? l.kind} <span className="font-mono text-[12px] text-muted">#{l.id}</span></div><div className="truncate text-xs text-muted">{fmtDateTime(l.created_at)} · {entName(l.entity_id)}{l.note ? ` · ${l.note}` : ""}</div></div>
                <div className="flex shrink-0 items-center gap-2"><span className={`font-mono font-semibold ${l.amount_vnd > 0 ? "text-ok" : "text-danger"}`}>{l.amount_vnd > 0 ? "+" : ""}{vnd(l.amount_vnd)}</span>
                  {manage && l.kind !== "dao" && !(ledger.data ?? []).some((x) => x.reverses_id === l.id) ? <ActionButton onClick={async () => { const r = prompt("Lý do đảo (tối thiểu 5 ký tự):"); if (!r) return; await rpc("reverse_wallet_entry", { p_entry_id: l.id, p_reason: r }); refresh(); }}>Đảo</ActionButton> : null}</div>
              </li>))}</ul>{lp.pager}</>
          )}
        </Card>
      </div>

      <Modal open={form} onClose={() => setForm(false)} title={s.isStaff ? "Ghi nhận tiền vào ví (cộng ngay)" : "Nạp tiền vào ví"}>
        <div className="space-y-3">
          {!s.entity ? <Field label="Công ty"><select value={f.entity_id} onChange={(e) => setF({ ...f, entity_id: e.target.value })} className={inputCls}><option value="">Chọn công ty…</option>{formEnts.map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}</select></Field> : null}
          {s.isStaff && !cust ? <p className="text-xs text-amber-700">Chọn khách ở bộ lọc phía trên để hiện danh sách công ty.</p> : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Số tiền (đ)"><input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} inputMode="numeric" className={inputCls + " font-mono"} /></Field>
            <Field label="Ngày chuyển"><input type="date" value={f.transfer_date} onChange={(e) => setF({ ...f, transfer_date: e.target.value })} className={inputCls} /></Field>
            <Field label="Chuyển vào tài khoản"><select value={f.account_code} onChange={(e) => setF({ ...f, account_code: e.target.value })} className={inputCls}><option value="">—</option>{(accounts.data ?? []).filter((a) => a.is_active).map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}</select></Field>
            <Field label="Mã giao dịch NH"><input value={f.bank_ref} onChange={(e) => setF({ ...f, bank_ref: e.target.value })} className={inputCls + " font-mono"} /></Field>
            <Field label="Người chuyển"><input value={f.payer_name} onChange={(e) => setF({ ...f, payer_name: e.target.value })} className={inputCls} /></Field>
            <Field label="Ghi chú"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className={inputCls} /></Field>
          </div>
          {f.account_code ? (() => { const a = accounts.data?.find((x) => x.code === f.account_code)?.meta as Record<string, string> | undefined; return a ? <p className="rounded-lg bg-surface px-3 py-2 text-xs">{a.bank} · STK <b className="font-mono">{a.account_no}</b> · {a.holder}</p> : null; })() : null}
          <Field label={s.isStaff ? "Ảnh/sao kê (không bắt buộc)" : "Ảnh chuyển khoản *"}><input type="file" accept="image/*,.pdf" multiple onChange={(e) => setProof(Array.from(e.target.files ?? []))} className="block w-full text-sm" /></Field>
          {err ? <Notice>{err}</Notice> : null}
          <div className="flex justify-end gap-2"><button onClick={() => setForm(false)} className={btn.ghost}>Hủy</button><button onClick={create} disabled={busy} className={btn.primary}>{busy ? "Đang lưu…" : s.isStaff ? "Ghi nhận & cộng ví" : "Gửi yêu cầu nạp"}</button></div>
        </div>
      </Modal>

      <Modal open={!!review} onClose={() => setReview(null)} title={`Duyệt nạp ví ${review?.code ?? ""}`}>
        {review ? (
          <div className="space-y-3">
            <p className="text-sm">{entName(review.entity_id)} · yêu cầu <b className="font-mono">{vnd(review.amount_vnd)}</b> · CK {fmtDate(review.transfer_date)} {review.bank_ref ? `· mã ${review.bank_ref}` : ""}</p>
            <div className="flex flex-wrap gap-2">{(proofs.data ?? []).filter((a) => a.entity_ref_id === review.id).map((a) => <Thumb key={a.id} a={a} size={120} />)}</div>
            <FileDrop entityType="wallet_topup" refId={review.id} compact category="chung_tu_ck" />
            <Field label="Số tiền thực nhận (đ)" hint="Sửa nếu sao kê khác yêu cầu (phải ghi lý do)"><input value={rv.amount} onChange={(e) => setRv({ ...rv, amount: e.target.value })} className={inputCls + " font-mono"} /></Field>
            <Field label="Ghi chú / lý do từ chối"><input value={rv.note} onChange={(e) => setRv({ ...rv, note: e.target.value })} className={inputCls} /></Field>
            {err ? <Notice>{err}</Notice> : null}
            <div className="flex justify-end gap-2"><button onClick={() => doReview(false)} disabled={busy} className={btn.danger}>Từ chối</button><button onClick={() => doReview(true)} disabled={busy} className={btn.primary}>Duyệt & cộng ví</button></div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
