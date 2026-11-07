"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { COMPLIANCE, COMPLIANCE_STATUS } from "@/lib/status";
import { PageHeader, Card, Badge, Empty, inputCls, Skeleton } from "@/components/ui";
import { ActionButton } from "@/components/ui/form";
import { fmtNumber } from "@/lib/format";
import type { Item } from "@/components/order-items";

type Row = Item & { orders: { code: string; customer_entities: { legal_name: string } | null } | null };

// Bàn làm việc khai báo: mọi dòng đang chờ XNK xác nhận, cảnh báo, hồ sơ chuyên ngành
export default function CustomsWorkspace() {
  const s = useSession();
  const [st, setSt] = useState("nhap");
  const [txt, setTxt] = useState("");
  const items = useQuery({ queryKey: ["ws-items", st], queryFn: () => {
    let x = supabase.from("order_items").select("*, orders(code, customer_entities(legal_name))").order("created_at", { ascending: false }).limit(500);
    if (st) x = x.eq("status", st);
    return q<Row[]>(x);
  } });
  const warn = useQuery({ queryKey: ["ws-warn"], queryFn: () => q<{ item_id: string; detail: string }[]>(supabase.from("order_item_warnings").select("item_id, detail")) });
  if (!s.isStaff) return <Empty title="Trang nội bộ" />;
  const R = (items.data ?? []).filter((i) => !txt || [i.declared_name_vi, i.model, i.hs_code, i.orders?.code].join(" ").toLowerCase().includes(txt.toLowerCase()));
  const w = (id: string) => (warn.data ?? []).filter((x) => x.item_id === id);
  return (
    <>
      <PageHeader eyebrow="Hải quan" title="Bàn khai báo" desc="Chuẩn bị tên khai báo, HS, chính sách từ khi xác nhận đơn – không đợi có xe. Dòng đã xác nhận tự vào thư viện để dùng lại." />
      <Card>
        <div className="mb-4 flex flex-wrap gap-2">
          <input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Tìm tên, model, HS, mã đơn…" className={inputCls + " max-w-xs"} />
          <select value={st} onChange={(e) => setSt(e.target.value)} className={inputCls + " w-auto"}><option value="nhap">Chờ xác nhận</option><option value="da_xac_nhan">Đã xác nhận</option><option value="">Tất cả</option></select>
        </div>
        {items.isLoading ? <Skeleton rows={6} /> : R.length === 0 ? <Empty title="Không có dòng nào" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs uppercase text-muted"><th className="py-2">Đơn</th><th>Tên khai báo</th><th>HS</th><th className="text-right">SL</th><th className="text-right">Trị giá (tệ)</th><th>Chuyên ngành</th><th>Trạng thái</th><th /></tr></thead>
              <tbody>
                {R.map((i) => (
                  <tr key={i.id} className="border-b border-line/70 align-top">
                    <td className="py-2"><Link href={`/don-hang/chi-tiet/?id=${i.order_id}`} className="font-mono text-xs font-semibold text-brand-strong">{i.orders?.code}</Link><div className="text-[12.5px] text-muted">{i.orders?.customer_entities?.legal_name}</div></td>
                    <td className="py-2"><div className="font-medium">{i.declared_name_vi}</div><div className="text-xs text-muted">{[i.model, i.manufacturer].filter(Boolean).join(" · ")}</div>{w(i.id).map((x, k) => <div key={k} className="text-[12.5px] text-amber-700">⚠ {x.detail}</div>)}</td>
                    <td className="py-2 font-mono text-xs">{i.hs_code ?? "—"}</td>
                    <td className="py-2 text-right font-mono">{fmtNumber(i.qty)}</td>
                    <td className="py-2 text-right font-mono">{fmtNumber(i.value_cny)}</td>
                    <td className="py-2 text-xs">{i.compliance_need === "none" ? "—" : `${COMPLIANCE[i.compliance_need]}: ${COMPLIANCE_STATUS[i.compliance_status]}`}</td>
                    <td className="py-2">{i.status === "da_xac_nhan" ? <Badge tone="ok">Đã xác nhận</Badge> : <Badge tone="warn">Nháp</Badge>}</td>
                    <td className="py-2 text-right">{s.can("customs.confirm") && i.status !== "da_xac_nhan" ? <ActionButton invalidate={[["ws-items", st]]} onClick={() => q(supabase.rpc("confirm_order_item", { p_item_id: i.id }))}>Xác nhận</ActionButton> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
