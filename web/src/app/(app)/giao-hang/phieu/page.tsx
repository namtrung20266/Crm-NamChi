"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { rpc } from "@/lib/meta";
import { Badge, Skeleton, Empty, btn } from "@/components/ui";
import { fmtNumber, fmtDate, fmtDateTime } from "@/lib/format";
import { viError } from "@/lib/errors";

type N = { id: string; code: string; delivery_date: string; driver_name: string | null; driver_phone: string | null; vehicle_plate: string | null; receiver_name: string | null; receiver_phone: string | null;
  address: string | null; note: string | null; status: string; delivered_at: string | null;
  customer_entities: { legal_name: string; tax_code: string | null; invoice_address: string | null } | null;
  goods_issues: { id: string; packages: number; status: string; orders: { code: string; goods_desc: string | null; customer_ref: string | null } | null;
    goods_issue_lines: { qty: number; order_items: { line_no: number; declared_name_vi: string; model: string | null; uom: string } | null }[] }[] };
const ST: Record<string, [string, "warn" | "info" | "ok" | "danger"]> = { nhap: ["Đang lập", "warn"], dang_giao: ["Đang giao", "info"], da_giao: ["Đã giao", "ok"], huy: ["Đã hủy", "danger"] };

// Phiếu giao hàng in A4: danh sách đơn, kiện, dòng hàng; chữ ký bên giao, lái xe, bên nhận
function Note() {
  const id = useSearchParams().get("id") ?? "";
  const s = useSession();
  const qc = useQueryClient();
  const d = useQuery({ queryKey: ["delivery-note", id], enabled: !!id, queryFn: () => q<N | null>(supabase.from("delivery_notes")
    .select("*, customer_entities(legal_name, tax_code, invoice_address), goods_issues(id, packages, status, orders(code, goods_desc, customer_ref), goods_issue_lines(qty, order_items(line_no, declared_name_vi, model, uom)))").eq("id", id).maybeSingle()) });
  if (d.isLoading) return <Skeleton rows={6} />;
  const n = d.data;
  if (!n) return <Empty title="Không tìm thấy phiếu giao" />;
  const act = async (st: string, msg: string) => { if (!confirm(msg)) return; try { await rpc("set_delivery_status", { p_note_id: n.id, p_status: st }); d.refetch(); qc.invalidateQueries({ queryKey: ["delivery-notes"] }); } catch (e) { alert(viError(e)); } };
  const totalPk = n.goods_issues.reduce((a, g) => a + g.packages, 0);
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Badge tone={ST[n.status][1]}>{ST[n.status][0]}{n.delivered_at ? ` · ${fmtDateTime(n.delivered_at)}` : ""}</Badge>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className={btn.secondary}>🖨 In phiếu</button>
          {s.can("warehouse.write") && n.status === "nhap" ? <button onClick={() => act("dang_giao", "Xe bắt đầu đi giao?")} className={btn.secondary}>Xe xuất phát</button> : null}
          {s.can("warehouse.write") && ["nhap", "dang_giao"].includes(n.status) ? <button onClick={() => act("da_giao", "Xác nhận đã giao đủ theo phiếu (đã có chữ ký)? Kiện chuyển Đã giao, đơn tự cập nhật.")} className={btn.primary}>Xác nhận đã giao</button> : null}
          {s.can("warehouse.write") && ["nhap", "dang_giao"].includes(n.status) ? <button onClick={() => act("huy", "Hủy phiếu giao này?")} className={btn.danger}>Hủy</button> : null}
        </div>
      </div>
      <div className="card bg-white p-8 text-[14px] print:border-0 print:p-0 print:shadow-none">
        <div className="flex items-start justify-between border-b-2 border-ink pb-3">
          <div><div className="text-lg font-bold">CÔNG TY TNHH DV VÀ TM QUỐC TẾ NAM TRUNG</div><div className="text-muted">Kho Việt Nam · namtrunglog.com</div></div>
          <div className="text-right"><div className="text-xl font-bold">PHIẾU GIAO HÀNG</div><div>Số: <b>{n.code}</b></div><div>Ngày: {fmtDate(n.delivery_date)}</div></div>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 py-3">
          <div>Bên nhận: <b>{n.customer_entities?.legal_name}</b></div><div>MST: {n.customer_entities?.tax_code ?? "—"}</div>
          <div className="col-span-2">Địa chỉ giao: {n.address ?? n.customer_entities?.invoice_address ?? "—"}</div>
          <div>Người nhận: {n.receiver_name ?? "……………………"} {n.receiver_phone ?? ""}</div><div>Lái xe: {n.driver_name ?? "……………………"} {n.driver_phone ?? ""}</div>
          <div>Biển số xe: {n.vehicle_plate ?? "……………"}</div><div>Tổng: <b>{n.goods_issues.length} đơn · {totalPk} kiện</b></div>
        </div>
        <table className="w-full border-collapse text-[13.5px]">
          <thead><tr className="bg-surface">{["STT", "Mã đơn / hàng hóa", "ĐVT", "Số lượng", "Số kiện", "Ghi chú"].map((x) => <th key={x} className="border border-line px-2 py-1.5 text-left">{x}</th>)}</tr></thead>
          <tbody>{n.goods_issues.filter((g) => g.status !== "huy").map((g, gi) => [
            <tr key={g.id} className="bg-brand-soft/40"><td className="border border-line px-2 py-1.5 font-semibold">{gi + 1}</td><td className="border border-line px-2 py-1.5 font-semibold" colSpan={3}>{g.orders?.code}{g.orders?.customer_ref ? ` (PO ${g.orders.customer_ref})` : ""} · {g.orders?.goods_desc}</td><td className="border border-line px-2 py-1.5 text-center font-semibold">{g.packages}</td><td className="border border-line" /></tr>,
            ...g.goods_issue_lines.map((l, li) => (
              <tr key={g.id + li}><td className="border border-line px-2 py-1 text-muted">{gi + 1}.{li + 1}</td><td className="border border-line px-2 py-1">{l.order_items?.declared_name_vi}{l.order_items?.model ? ` – ${l.order_items.model}` : ""}</td>
                <td className="border border-line px-2 py-1">{l.order_items?.uom}</td><td className="border border-line px-2 py-1 text-right">{fmtNumber(l.qty)}</td><td className="border border-line" /><td className="border border-line" /></tr>)),
          ])}</tbody>
        </table>
        {n.note ? <p className="mt-2">Ghi chú: {n.note}</p> : null}
        <p className="mt-2 text-[12.5px] text-muted">Bên nhận kiểm đếm đủ số kiện, tình trạng niêm phong/đóng gói trước khi ký. Hàng thiếu/hỏng ghi rõ trên phiếu.</p>
        <div className="mt-6 grid grid-cols-3 gap-4 text-center">
          {["Bên giao (Kho Nam Trung)", "Lái xe", "Bên nhận"].map((x) => <div key={x}><div className="font-semibold">{x}</div><div className="text-[12.5px] text-muted">(Ký, ghi rõ họ tên)</div><div className="h-24" /></div>)}
        </div>
      </div>
    </div>
  );
}
export default function Page() { return <Suspense fallback={<Skeleton rows={6} />}><Note /></Suspense>; }
