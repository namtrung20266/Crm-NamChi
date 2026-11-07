"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/session";
import { useCustomers, useEntities, useStaff } from "@/lib/data";
import { useStatusDefs, statusOf, PHASES, PAYMENT_STATE, DELIVERY_STATE, INVOICE_STATE, rpc, type Tone } from "@/lib/meta";
import { INVOICE_TYPE } from "@/lib/status";
import { Badge, inputCls, Skeleton, Empty, btn, usePaged } from "./ui";
import { InlineNote } from "./order-note";
import { UploadThumb } from "./upload-thumb";
import { vnd, fmtNumber, fmtDate } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";

export type AdminOrder = {
  id: string; code: string; customer_ref: string | null; customer_code: string; entity_code: string; entity_name: string; entity_id: string; customer_id: string;
  goods_desc: string | null; goods_group: string | null; supplier_name: string | null; china_invoice_type: string; goods_cny: number; goods_qty: number; fx_rate: number;
  weight_kg: number; cbm: number; packages: number; order_week: string | null; expected_week: string | null; status: string; status_changed_at: string;
  created_at: string; cs_owner_id: string | null; cs_name: string | null; require_label_check: boolean; require_inspection: boolean;
  days_in_status: number; sla_overdue: boolean; total_vnd: number; deposit_vnd: number; paid_vnd: number; remaining_vnd: number; payment_state: string;
  wallet_balance_vnd: number; items_total: number; items_confirmed: number; items_with_image: number; items_missing_hs: number;
  pkg_total: number; pkg_cn: number; pkg_on_trip: number; pkg_vn: number; pkg_delivered: number; pkg_issue: number;
  qty_total: number; qty_delivered: number; delivery_state: string; qty_invoiced: number; qty_invoice_draft: number; invoice_state: string;
  messages_count: number; last_message_at: string | null; attachments_count: number; unread_count: number; profit_vnd?: number | null; cost_missing?: number;
  note: string | null; internal_note: string | null; thumb_id: string | null; images_count: number;
};

const Chip = ({ s }: { s?: { label: string; tone: Tone } }) => (s ? <Badge tone={s.tone}>{s.label}</Badge> : null);
type SortKey = "created_at" | "code" | "remaining_vnd" | "days_in_status" | "goods_cny" | "profit_vnd";

// Bảng đơn đầy đủ cho quản trị: lọc nhiều chiều, sắp xếp, xuất Excel; dùng ở Dashboard và trang Đơn hàng
export function AdminOrderTable({ initial = {}, compactTitle }: { initial?: { status?: string; phase?: string }; compactTitle?: string }) {
  const s = useSession();
  const defs = useStatusDefs();
  const customers = useCustomers();
  const staff = useStaff();
  const [f, setF] = useState({ customer_id: "", entity_id: "", cs_owner_id: "", from: "", to: "" });
  const [phase, setPhase] = useState(initial.phase ?? "");
  const [status, setStatus] = useState(initial.status ?? "");
  const [text, setText] = useState("");
  const [flag, setFlag] = useState("");
  const [sort, setSort] = useState<{ k: SortKey; asc: boolean }>({ k: "created_at", asc: false });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const ents = useEntities(f.customer_id || null);
  const money = s.can("finance.read"), profit = s.can("finance.profit.read");
  const data = useQuery({ queryKey: ["admin-orders", f], queryFn: () => rpc<AdminOrder[]>("admin_orders", { p_filter: { ...f, limit: 2000 } }) });

  const rows = useMemo(() => {
    const t = text.trim().toLowerCase();
    const r = (data.data ?? []).filter((o) => {
      const d = defs.data?.find((x) => x.code === o.status);
      if (phase && d?.phase !== phase) return false;
      if (status && o.status !== status) return false;
      if (t && ![o.code, o.customer_ref, o.entity_name, o.entity_code, o.goods_desc, o.supplier_name, o.order_week, o.cs_name].join(" ").toLowerCase().includes(t)) return false;
      switch (flag) {
        case "overdue": return o.sla_overdue;
        case "unpaid": return o.remaining_vnd > 0 && !["dang_len_don", "huy"].includes(o.status);
        case "no_quote": return o.payment_state === "chua_bao_gia" && o.status !== "dang_len_don";
        case "inv_short": return ["xuat_mot_phan", "chua_xuat", "dang_lap"].includes(o.invoice_state) && ["ve_kho_vn", "dang_giao", "da_giao"].includes(o.status);
        case "decl": return o.items_total === 0 || o.items_confirmed < o.items_total || o.items_missing_hs > 0;
        case "cost": return (o.cost_missing ?? 0) > 0;
        case "unread": return o.unread_count > 0;
        case "active": return !["hoan_tat", "huy", "dang_len_don"].includes(o.status);
      }
      return true;
    });
    const k = sort.k;
    return r.sort((a, b) => {
      const va = (a as Record<string, unknown>)[k] ?? 0, vb = (b as Record<string, unknown>)[k] ?? 0;
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sort.asc ? c : -c;
    });
  }, [data.data, defs.data, phase, status, text, flag, sort]);

  const { view: pageRows, pager } = usePaged(rows);
  const tot = rows.reduce((a, o) => ({ cny: a.cny + Number(o.goods_cny), total: a.total + Number(o.total_vnd), remain: a.remain + Math.max(0, Number(o.remaining_vnd)), profit: a.profit + Number(o.profit_vnd ?? 0) }), { cny: 0, total: 0, remain: 0, profit: 0 });
  const H = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={`cursor-pointer select-none px-2.5 py-2 font-medium hover:text-ink ${right ? "text-right" : ""}`} onClick={() => setSort((p) => ({ k, asc: p.k === k ? !p.asc : false }))}>
      {children}{sort.k === k ? (sort.asc ? " ↑" : " ↓") : ""}
    </th>
  );
  const exportCsv = () => downloadCsv(`don-hang-${new Date().toISOString().slice(0, 10)}.csv`,
    ["Mã đơn", "Mã PO khách", "Công ty", "Hàng", "Shop", "HĐ TQ", "Tiền hàng (tệ)", "Trạng thái", "Số ngày ở bước", "Quá hạn", "CSKH", "Phải thu", "Đã thu", "Còn lại", "Thanh toán",
      "Dòng KB", "Đã xác nhận", "Kiện", "Kiện VN", "Giao", "Hóa đơn", "SL HĐ đã xuất", "SL hàng", ...(profit ? ["Lợi nhuận"] : []), "Ngày tạo", "Ghi chú khách", "Ghi chú nội bộ", "Tuần đặt", "Cân (kg)", "Khối (m3)", "Số kiện", "Số lượng", "Tỷ giá"],
    (sel.size ? rows.filter((o) => sel.has(o.id)) : rows).map((o) => [o.code, o.customer_ref, o.entity_name, o.goods_desc, o.supplier_name, o.china_invoice_type, o.goods_cny, statusOf(defs.data, o.status).label, o.days_in_status,
      o.sla_overdue ? "Có" : "", o.cs_name, money ? o.total_vnd : "", money ? o.paid_vnd : "", money ? o.remaining_vnd : "", PAYMENT_STATE[o.payment_state]?.label,
      o.items_total, o.items_confirmed, o.pkg_total, o.pkg_vn, DELIVERY_STATE[o.delivery_state]?.label, INVOICE_STATE[o.invoice_state]?.label, o.qty_invoiced, o.qty_total,
      ...(profit ? [o.profit_vnd ?? ""] : []), fmtDate(o.created_at), o.note, o.internal_note, o.order_week, o.weight_kg, o.cbm, o.packages, o.goods_qty, o.fx_rate]));

  const phaseCount = (p: string) => (data.data ?? []).filter((o) => defs.data?.find((x) => x.code === o.status)?.phase === p).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {compactTitle ? <h2 className="mr-2 text-sm font-semibold">{compactTitle}</h2> : null}
        {[["", "Tất cả", (data.data ?? []).length] as const, ...Object.entries(PHASES).map(([k, v]) => [k, v, phaseCount(k)] as const)].map(([k, v, n]) => (
          <button key={k} onClick={() => { setPhase(k); setStatus(""); }}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${phase === k ? "bg-ink text-white" : "bg-white text-muted ring-1 ring-line hover:text-ink"}`}>{v} <span className="font-mono opacity-70">{n}</span></button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tìm mã đơn, PO, công ty, hàng, shop, CSKH…" className={inputCls + " lg:col-span-2"} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
          <option value="">Mọi trạng thái</option>{(defs.data ?? []).filter((d) => !phase || d.phase === phase).map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
        </select>
        <select value={flag} onChange={(e) => setFlag(e.target.value)} className={inputCls}>
          <option value="">Mọi tình trạng</option><option value="active">Đang chạy</option><option value="overdue">⏰ Quá hạn SLA</option>
          <option value="no_quote">Chưa báo giá</option>{money ? <option value="unpaid">Còn phải thu</option> : null}<option value="decl">Khai báo chưa xong</option>
          <option value="inv_short">Hàng về, HĐ chưa đủ</option>{profit ? <option value="cost">Thiếu giá vốn</option> : null}<option value="unread">Có tin chưa đọc</option>
        </select>
        <select value={f.customer_id} onChange={(e) => setF({ ...f, customer_id: e.target.value, entity_id: "" })} className={inputCls}>
          <option value="">Mọi khách hàng</option>{(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
        </select>
        <select value={f.entity_id} onChange={(e) => setF({ ...f, entity_id: e.target.value })} className={inputCls}>
          <option value="">Mọi công ty con</option>{(ents.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.code} · {e.legal_name}</option>)}
        </select>
        <select value={f.cs_owner_id} onChange={(e) => setF({ ...f, cs_owner_id: e.target.value })} className={inputCls}>
          <option value="">Mọi CSKH</option>{(staff.data ?? []).filter((x) => x.is_active).map((x) => <option key={x.user_id} value={x.user_id}>{x.full_name}</option>)}
        </select>
        <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className={inputCls} title="Tạo từ ngày" />
        <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className={inputCls} title="Đến ngày" />
        <div className="flex gap-2 lg:col-span-2">
          <button onClick={exportCsv} className={btn.secondary + " flex-1"}>Xuất Excel ({sel.size || rows.length}{sel.size ? " đã chọn" : ""})</button>
          <button onClick={() => { setF({ customer_id: "", entity_id: "", cs_owner_id: "", from: "", to: "" }); setPhase(""); setStatus(""); setFlag(""); setText(""); }} className={btn.ghost}>Xóa lọc</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-lg bg-surface px-3 py-2 text-xs text-muted">
        <span><b className="font-mono text-ink">{rows.length}</b> đơn</span>
        <span>Tiền hàng <b className="font-mono text-ink">{fmtNumber(tot.cny)} tệ</b></span>
        {money ? <><span>Phải thu <b className="font-mono text-ink">{vnd(tot.total)}</b></span><span>Còn phải thu <b className="font-mono text-danger">{vnd(tot.remain)}</b></span></> : null}
        {profit ? <span>Lợi nhuận <b className="font-mono text-ok">{vnd(tot.profit)}</b></span> : null}
      </div>
      {data.isLoading ? <Skeleton rows={8} /> : rows.length === 0 ? <Empty title="Không có đơn phù hợp bộ lọc" /> : (
        <div className="rounded-xl border border-line bg-white">
          <table className="w-full table-fixed text-left text-[14px]">
            <colgroup><col className="w-9" /><col className="w-[64px]" /><col /><col className="w-[150px]" /><col className="w-[200px]" /><col className="w-[118px]" />
              <col className="w-[200px]" /><col className="w-[110px]" /></colgroup>
            <thead className="sticky top-0 z-10 bg-surface text-[12.5px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-2 py-2.5"><input type="checkbox" checked={sel.size > 0 && sel.size === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((o) => o.id)) : new Set())} /></th>
                <th className="px-1 py-2.5 font-medium">Ảnh</th>
                <H k="code">Đơn · công ty · hàng</H><H k="days_in_status">Trạng thái</H>
                <th className="px-2.5 py-2.5 font-medium">Tiến độ</th>
                <H k="goods_cny" right>Giá trị</H>
                <th className="px-2.5 py-2.5 font-medium">Ghi chú NV / khách</th>
                <H k="created_at">CSKH</H>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((o) => {
                const st = statusOf(defs.data, o.status);
                return (
                  <tr key={o.id} className={`border-t border-line/70 align-top hover:bg-brand-soft/30 ${o.sla_overdue ? "bg-danger/[.03]" : ""} ${sel.has(o.id) ? "bg-brand-soft/40" : ""}`}>
                    <td className="px-2 py-3"><input type="checkbox" checked={sel.has(o.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(o.id); else n.delete(o.id); setSel(n); }} /></td>
                    <td className="px-1 py-3"><UploadThumb id={o.thumb_id} n={o.images_count} entityType="order" refId={o.id} canUpload={s.can("attachment.upload")} /></td>
                    <td className="px-2.5 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link href={`/don-hang/chi-tiet/?id=${o.id}`} className="font-semibold text-brand-strong hover:underline">{o.code}</Link>
                        {o.unread_count ? <span className="rounded-full bg-brand px-1.5 text-[12px] font-semibold text-white">{o.unread_count} mới</span> : null}
                        {o.customer_ref ? <span className="text-[12.5px] text-muted">PO {o.customer_ref}</span> : null}
                      </div>
                      <div className="font-medium">{o.entity_name}</div>
                      <div className="line-clamp-2 text-[13px] text-muted">{o.goods_desc ?? "—"}{o.supplier_name ? ` · ${o.supplier_name}` : ""} · {INVOICE_TYPE[o.china_invoice_type]}</div>
                      {o.require_label_check || o.require_inspection ? <div className="mt-1 flex gap-1">{o.require_label_check ? <Badge tone="warn">Check tem</Badge> : null}{o.require_inspection ? <Badge tone="warn">Kiểm định</Badge> : null}</div> : null}
                    </td>
                    <td className="px-2.5 py-3"><Badge tone={st.tone}>{st.label}</Badge>
                      <div className={`mt-1 text-[12.5px] ${o.sla_overdue ? "font-semibold text-danger" : "text-muted"}`}>{o.days_in_status} ngày ở bước{o.sla_overdue ? " · quá hạn" : ""}</div></td>
                    <td className="space-y-1 px-2.5 py-3 text-[13px]">
                      {money ? <div className="flex flex-wrap items-center gap-1"><Chip s={PAYMENT_STATE[o.payment_state]} />{o.total_vnd ? <span className={o.remaining_vnd > 0 ? "text-danger" : "text-ok"}>còn {fmtNumber(o.remaining_vnd)}</span> : null}</div> : null}
                      <div className="text-muted">Khai báo <b className="text-ink">{o.items_confirmed}/{o.items_total}</b>{o.items_missing_hs ? <span className="text-danger"> · thiếu HS {o.items_missing_hs}</span> : null}</div>
                      {o.pkg_total ? <div className="text-muted">Kiện <b className="text-ink">{o.pkg_total}</b> · TQ {o.pkg_cn} · xe {o.pkg_on_trip} · VN {o.pkg_vn}{o.pkg_issue ? <span className="text-danger"> · lỗi {o.pkg_issue}</span> : null}</div> : null}
                      {o.qty_total ? <div className="text-muted">Giao {fmtNumber(o.qty_delivered)}/{fmtNumber(o.qty_total)} · HĐ <span className={o.qty_invoiced < o.qty_total ? "text-amber-700" : "text-ok"}>{fmtNumber(o.qty_invoiced)}/{fmtNumber(o.qty_total)}</span></div> : null}
                    </td>
                    <td className="px-2.5 py-3 text-right"><div className="font-semibold">{fmtNumber(o.goods_cny)} tệ</div>
                      {money && o.total_vnd ? <div className="text-[13px] text-muted">{vnd(o.total_vnd)}</div> : null}
                      {profit && o.profit_vnd != null ? <div className={`text-[13px] ${o.profit_vnd >= 0 ? "text-ok" : "text-danger"}`}>lãi {fmtNumber(o.profit_vnd)}</div> : null}
                      {profit && o.cost_missing ? <div className="text-[12px] text-amber-700">thiếu vốn {o.cost_missing}</div> : null}</td>
                    <td className="space-y-1.5 px-2.5 py-3">
                      <InlineNote orderId={o.id} kind="internal" value={o.internal_note} canEdit={s.can("order.write")} placeholder="+ Ghi chú NV" compact />
                      {o.note ? <div className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[13px]"><span className="font-semibold text-blue-800">Khách: </span><span className="line-clamp-3">{o.note}</span></div> : null}
                    </td>
                    <td className="px-2.5 py-3 text-[13px]">{o.cs_name ?? <span className="text-danger">Chưa gán</span>}<div className="text-muted">{fmtDate(o.created_at)}</div>{o.messages_count ? <div className="text-muted">💬 {o.messages_count}</div> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-3 pb-3">{pager}</div>
        </div>
      )}
    </div>
  );
}

