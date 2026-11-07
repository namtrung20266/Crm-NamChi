"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { Card, Badge } from "./ui";
import { fmtNumber, fmtDate, fmtDateTime } from "@/lib/format";

type GI = { id: string; code: string; packages: number; status: string; delivered_at: string | null; created_at: string; delivery_note_id: string | null;
  delivery_notes: { code: string; driver_name: string | null; vehicle_plate: string | null; delivery_date: string; status: string } | null;
  goods_issue_lines: { qty: number; order_items: { line_no: number; declared_name_vi: string; uom: string } | null }[] };
const ST: Record<string, [string, "ok" | "warn" | "danger" | "info"]> = { nhap: ["Đang lập", "warn"], dang_giao: ["Đang giao", "info"], da_giao: ["Đã giao", "ok"], huy: ["Hủy", "danger"] };

// Lịch sử giao của 1 đơn (nhân viên và khách cùng xem): phiếu giao, số kiện, dòng hàng
export function DeliveryHistory({ orderId }: { orderId: string }) {
  const d = useQuery({ queryKey: ["delivery-history", orderId], queryFn: () => q<GI[]>(supabase.from("goods_issues")
    .select("id, code, packages, status, delivered_at, created_at, delivery_note_id, delivery_notes(code, driver_name, vehicle_plate, delivery_date, status), goods_issue_lines(qty, order_items(line_no, declared_name_vi, uom))")
    .eq("order_id", orderId).order("created_at", { ascending: false })) });
  const rows = d.data ?? [];
  return (
    <Card title={`Lịch sử giao hàng (${rows.length})`}>
      {rows.length === 0 ? <p className="text-sm text-muted">Chưa có đợt giao nào.</p> : (
        <ul className="space-y-3">{rows.map((g) => (
          <li key={g.id} className="rounded-xl border border-line p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold">{g.delivery_notes ? <Link href={`/giao-hang/phieu/?id=${g.delivery_note_id}`} className="text-brand-strong hover:underline">Phiếu {g.delivery_notes.code}</Link> : g.code}
                <span className="ml-2 text-sm font-normal text-muted">{g.packages} kiện · {g.delivery_notes ? fmtDate(g.delivery_notes.delivery_date) : fmtDate(g.created_at)}</span></div>
              <Badge tone={ST[g.status]?.[1]}>{g.status === "da_giao" ? `Đã giao ${fmtDateTime(g.delivered_at)}` : ST[g.status]?.[0]}</Badge>
            </div>
            {g.delivery_notes?.driver_name ? <div className="mt-1 text-sm text-muted">Lái xe {g.delivery_notes.driver_name}{g.delivery_notes.vehicle_plate ? ` · xe ${g.delivery_notes.vehicle_plate}` : ""}</div> : null}
            <ul className="mt-2 space-y-0.5 text-sm">{g.goods_issue_lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-2"><span>#{l.order_items?.line_no} {l.order_items?.declared_name_vi}</span><span>{fmtNumber(l.qty)} {l.order_items?.uom}</span></li>))}</ul>
          </li>))}</ul>
      )}
    </Card>
  );
}
