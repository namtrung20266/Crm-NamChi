"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { PageHeader, Card, Badge, Empty, Field, inputCls, Skeleton, btn } from "@/components/ui";
import { Form, Submit, ActionButton } from "@/components/ui/form";
import { fmtNumber, fmtDateTime } from "@/lib/format";
import { viError } from "@/lib/errors";

type GI = { id: string; code: string; order_id: string; packages: number; deliverer: string | null; receiver_name: string | null; receiver_phone: string | null; status: string; delivered_at: string | null; note: string | null; created_at: string; row_version: number; orders: { code: string; customer_entities: { legal_name: string } | null } | null };
type Flow = { order_item_id: string; order_id: string; line_no: number; declared_name_vi: string; uom: string; arrived_qty: number; issued_qty: number };
type GIL = { id: string; goods_issue_id: string; order_item_id: string; qty: number };

// Phiếu xuất kho / giao hàng nhiều đợt; giao không vượt số đã về VN
export default function DeliveryPage() {
  const s = useSession();
  const qc = useQueryClient();
  const [orderId, setOrderId] = useState("");
  const list = useQuery({ queryKey: ["goods-issues"], queryFn: () => q<GI[]>(supabase.from("goods_issues").select("*, orders(code, customer_entities(legal_name))").order("created_at", { ascending: false }).limit(200)) });
  const lines = useQuery({ queryKey: ["gi-lines"], queryFn: () => q<GIL[]>(supabase.from("goods_issue_lines").select("id, goods_issue_id, order_item_id, qty")) });
  const flows = useQuery({ queryKey: ["item-flow"], queryFn: () => q<Flow[]>(supabase.from("item_flow").select("order_item_id, order_id, line_no, declared_name_vi, uom, arrived_qty, issued_qty").gt("arrived_qty", 0)) });
  const orders = useQuery({ queryKey: ["orders-at-vn"], enabled: s.can("warehouse.write"), queryFn: () => q<{ id: string; code: string; customer_entities: { legal_name: string } | null }[]>(supabase.from("orders").select("id, code, customer_entities(legal_name)").in("status", ["ve_kho_vn", "dang_giao"]).order("code")) });
  const refresh = () => ["goods-issues", "gi-lines", "item-flow"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const F = flows.data ?? [];
  const flowName = (id: string) => F.find((f) => f.order_item_id === id);
  const write = s.can("warehouse.write");

  return (
    <>
      <PageHeader eyebrow="Kho Việt Nam" title="Giao hàng" desc="Một đơn giao nhiều đợt. Mỗi dòng luôn hiện đã về – đã giao – còn lại." />
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Card title="Phiếu giao">
          {list.isLoading ? <Skeleton /> : (list.data ?? []).length === 0 ? <Empty title="Chưa có phiếu giao" /> : (
            <ul className="space-y-3">{(list.data ?? []).map((g) => {
              const L = (lines.data ?? []).filter((l) => l.goods_issue_id === g.id);
              const remain = F.filter((f) => f.order_id === g.order_id && Number(f.arrived_qty) - Number(f.issued_qty) > 0 && !L.some((l) => l.order_item_id === f.order_item_id));
              return (
                <li key={g.id} className="rounded-xl border border-line p-4 print:break-inside-avoid">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><span className="font-mono font-semibold">{g.code}</span> · <Link href={`/don-hang/chi-tiet/?id=${g.order_id}`} className="font-mono text-brand-strong">{g.orders?.code}</Link> <span className="text-sm text-muted">· {g.orders?.customer_entities?.legal_name}</span></div>
                    {g.status === "da_giao" ? <Badge tone="ok">Đã giao {fmtDateTime(g.delivered_at)}</Badge> : g.status === "huy" ? <Badge tone="danger">Hủy</Badge> : <Badge tone="warn">Đang lập</Badge>}
                  </div>
                  <ul className="mt-2 space-y-1 text-sm">{L.map((l) => { const f = flowName(l.order_item_id); return (
                    <li key={l.id} className="flex justify-between gap-2"><span>#{f?.line_no} {f?.declared_name_vi}</span><span className="font-mono">{fmtNumber(l.qty)} {f?.uom}</span></li>); })}</ul>
                  <div className="mt-1 text-xs text-muted">{g.packages} kiện · người giao {g.deliverer ?? "—"} · người nhận {g.receiver_name ?? "—"} {g.receiver_phone ?? ""}</div>
                  {write && g.status === "nhap" ? (
                    <div className="mt-3 space-y-2 border-t border-line pt-3">
                      {remain.map((f) => (
                        <form key={f.order_item_id} className="flex flex-wrap items-center gap-2 text-sm" onSubmit={async (e) => {
                          e.preventDefault();
                          const qty = Number(String(new FormData(e.currentTarget).get("qty") ?? "").replace(",", "."));
                          const { error } = await supabase.from("goods_issue_lines").insert({ goods_issue_id: g.id, order_item_id: f.order_item_id, qty });
                          if (error) alert(viError(error)); refresh();
                        }}>
                          <span className="min-w-0 flex-1">#{f.line_no} {f.declared_name_vi} <span className="text-xs text-muted">còn {fmtNumber(Number(f.arrived_qty) - Number(f.issued_qty))}</span></span>
                          <input name="qty" defaultValue={Number(f.arrived_qty) - Number(f.issued_qty)} className={inputCls + " h-8 w-24 font-mono text-xs"} />
                          <button className={btn.secondary + " h-8 px-3 text-xs"}>Thêm</button>
                        </form>
                      ))}
                      <div className="flex flex-wrap justify-end gap-2">
                        <button className={btn.ghost + " h-8 px-3 text-xs"} onClick={() => window.print()}>In phiếu</button>
                        <ActionButton variant="primary" confirmText="Xác nhận đã giao? Phiếu sẽ khóa." invalidate={[["goods-issues"]]} onClick={() => q(supabase.from("goods_issues").update({ status: "da_giao", row_version: g.row_version }).eq("id", g.id))}>Xác nhận đã giao</ActionButton>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}</ul>
          )}
        </Card>
        {write ? (
          <Card title="Lập phiếu giao">
            <Form resetOnOk invalidate={[["goods-issues"]]} onSubmit={async (f) => {
              if (!orderId) return { error: "Chọn đơn" };
              const o = (k: string) => String(f.get(k) ?? "").trim() || null;
              const { error } = await supabase.from("goods_issues").insert({ order_id: orderId, packages: Number(f.get("packages") || 0), deliverer: o("deliverer"), receiver_name: o("receiver_name"), receiver_phone: o("receiver_phone"), note: o("note") });
              return error ? { error: viError(error) } : { ok: true, message: "Đã lập phiếu. Thêm dòng hàng ở danh sách bên trái." };
            }}>
              <Field label="Đơn hàng (đã về kho VN)"><select value={orderId} onChange={(e) => setOrderId(e.target.value)} className={inputCls}><option value="">Chọn đơn…</option>{(orders.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.code} · {o.customer_entities?.legal_name}</option>)}</select></Field>
              <Field label="Số kiện giao"><input name="packages" inputMode="numeric" className={inputCls + " font-mono"} /></Field>
              <div className="grid grid-cols-2 gap-3"><Field label="Người giao"><input name="deliverer" className={inputCls} /></Field><Field label="Người nhận"><input name="receiver_name" className={inputCls} /></Field></div>
              <Field label="SĐT người nhận"><input name="receiver_phone" className={inputCls} /></Field>
              <Field label="Ghi chú"><input name="note" className={inputCls} /></Field>
              <div className="flex justify-end"><Submit>Lập phiếu</Submit></div>
            </Form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
