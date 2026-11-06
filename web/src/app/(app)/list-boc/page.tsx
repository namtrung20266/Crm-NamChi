"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { PageHeader, Card, Badge, Empty, Skeleton, btn } from "@/components/ui";
import { fmtNumber, fmtDate } from "@/lib/format";
import { viError } from "@/lib/errors";

export type PLT = { id: string; code: string; status: string; trip_id: string | null; created_at: string; packages: number; gw_kg: number; cbm: number; value_cny: number; orders: number };
const PL_STATUS = { nhap: ["Đang lập", "neutral"], da_xac_nhan: ["Đã chốt theo xe", "ok"], huy: ["Hủy", "danger"] } as const;

export default function PickingListsPage() {
  const s = useSession();
  const router = useRouter();
  const lists = useQuery({ queryKey: ["picking-lists"], queryFn: () => q<PLT[]>(supabase.from("picking_list_totals").select("*").order("created_at", { ascending: false }).limit(200)) });
  if (!s.isStaff) return <Empty title="Trang nội bộ" />;
  return (
    <>
      <PageHeader eyebrow="Vận chuyển" title="List bốc" desc="Gom dòng hàng đã xác nhận khai báo và kiện thực tế từ nhiều đơn. Không bốc vượt số lượng; 1 kiện chỉ thuộc 1 list."
        actions={s.can("logistics.write") ? <button className={btn.primary} onClick={async () => {
          const { data, error } = await supabase.from("picking_lists").insert({}).select("id").single();
          if (error) alert(viError(error)); else router.push(`/list-boc/chi-tiet/?id=${data.id}`);
        }}>+ Tạo list bốc</button> : null} />
      <Card>
        {lists.isLoading ? <Skeleton /> : (lists.data ?? []).length === 0 ? <Empty title="Chưa có list bốc" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs uppercase text-muted"><th className="py-2">Mã</th><th className="text-right">Đơn</th><th className="text-right">Kiện</th><th className="text-right">GW (kg)</th><th className="text-right">CBM</th><th className="text-right">Trị giá (tệ)</th><th>Trạng thái</th><th>Ngày</th></tr></thead>
            <tbody>{(lists.data ?? []).map((l) => (
              <tr key={l.id} className="border-b border-line/70">
                <td className="py-2.5"><Link href={`/list-boc/chi-tiet/?id=${l.id}`} className="font-mono font-semibold text-brand-strong">{l.code}</Link></td>
                <td className="text-right font-mono">{l.orders}</td><td className="text-right font-mono">{l.packages}</td><td className="text-right font-mono">{fmtNumber(l.gw_kg)}</td>
                <td className="text-right font-mono">{fmtNumber(l.cbm)}</td><td className="text-right font-mono">{fmtNumber(l.value_cny)}</td>
                <td><Badge tone={PL_STATUS[l.status as keyof typeof PL_STATUS][1]}>{PL_STATUS[l.status as keyof typeof PL_STATUS][0]}</Badge></td>
                <td className="text-xs text-muted">{fmtDate(l.created_at)}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
