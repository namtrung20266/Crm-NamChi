"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { TRIP_STATUS } from "@/lib/status";
import { PageHeader, Card, Badge, Empty, Skeleton, btn } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { viError } from "@/lib/errors";

export default function TripsPage() {
  const s = useSession();
  const router = useRouter();
  const trips = useQuery({ queryKey: ["trips"], queryFn: () => q<{ id: string; code: string; plate: string | null; border_gate: string; status: string; planned_date: string | null; declaration_no: string | null; created_at: string }[]>(
    supabase.from("trips").select("id, code, plate, border_gate, status, planned_date, declaration_no, created_at").order("created_at", { ascending: false }).limit(200)) });
  if (!s.isStaff) return <Empty title="Trang nội bộ" />;
  return (
    <>
      <PageHeader eyebrow="Vận chuyển" title="List xe" desc="Gom list bốc theo chuyến xe. Chốt xe → hệ thống tạo bộ dữ liệu đóng băng để xuất file khai báo, invoice, packing list."
        actions={s.can("logistics.write") ? <button className={btn.primary} onClick={async () => {
          const { data, error } = await supabase.from("trips").insert({}).select("id").single();
          if (error) alert(viError(error)); else router.push(`/list-xe/chi-tiet/?id=${data.id}`);
        }}>+ Tạo chuyến xe</button> : null} />
      <Card>
        {trips.isLoading ? <Skeleton /> : (trips.data ?? []).length === 0 ? <Empty title="Chưa có chuyến xe" /> : (
          <ul className="divide-y divide-line/70">{(trips.data ?? []).map((t) => (
            <li key={t.id}><Link href={`/list-xe/chi-tiet/?id=${t.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:text-brand-strong">
              <div><span className="font-mono font-semibold">{t.code}</span> <span className="text-sm text-muted">· {t.plate ?? "chưa có biển số"} · dự kiến {fmtDate(t.planned_date)}{t.declaration_no ? ` · TK ${t.declaration_no}` : ""}</span></div>
              <Badge tone={TRIP_STATUS[t.status]?.tone}>{TRIP_STATUS[t.status]?.label}</Badge>
            </Link></li>))}</ul>
        )}
      </Card>
    </>
  );
}
