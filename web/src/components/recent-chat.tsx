"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { rpc } from "@/lib/meta";
import { Card } from "./ui";
import { fmtDateTime } from "@/lib/format";

type M = { id: number; order_id: string; order_code: string; entity_name: string; body: string; internal: boolean; author_side: string; author_name: string | null; created_at: string; mine: boolean };

// Khung chat tổng: tin nhắn mới nhất trên mọi đơn (nội bộ + khách), bấm để vào đơn
export function RecentChat({ height = 460 }: { height?: number }) {
  const s = useSession();
  const qc = useQueryClient();
  const [f, setF] = useState<"all" | "customer" | "internal">("all");
  const d = useQuery({ queryKey: ["recent-messages"], refetchInterval: 30_000, queryFn: () => rpc<M[]>("recent_messages", { p_limit: 80 }) });
  useEffect(() => {
    const ch = supabase.channel(`recent-msg-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "order_messages" }, () => qc.invalidateQueries({ queryKey: ["recent-messages"] })).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);
  const rows = (d.data ?? []).filter((m) => f === "all" || (f === "internal" ? m.internal : !m.internal && m.author_side === "customer"));
  return (
    <Card title="Trao đổi mới nhất" actions={s.isStaff ? (
      <div className="flex rounded-lg bg-surface p-0.5 text-[13px]">
        {([["all", "Tất cả"], ["customer", "Khách nhắn"], ["internal", "Nội bộ"]] as const).map(([k, v]) => (
          <button key={k} onClick={() => setF(k)} className={`rounded-md px-2.5 py-1 font-semibold ${f === k ? "bg-white shadow-sm" : "text-muted"}`}>{v}</button>
        ))}
      </div>) : null}>
      <ul className="-mx-1 space-y-1 overflow-y-auto pr-1" style={{ maxHeight: height }}>
        {rows.length === 0 ? <li className="py-8 text-center text-sm text-muted">Chưa có tin nhắn</li> : rows.map((m) => (
          <li key={m.id}>
            <Link href={`/don-hang/chi-tiet/?id=${m.order_id}&tab=trao-doi`} className={`block rounded-xl px-3 py-2.5 transition hover:bg-surface ${m.internal ? "border-l-4 border-amber-300 bg-amber-50/60" : m.author_side === "customer" ? "border-l-4 border-blue-300" : "border-l-4 border-brand/40"}`}>
              <div className="flex items-center justify-between gap-2 text-[13px]">
                <span className="min-w-0 truncate"><b className="text-brand-strong">{m.order_code}</b> <span className="text-muted">· {m.entity_name}</span></span>
                <span className="shrink-0 text-[12.5px] text-muted">{fmtDateTime(m.created_at)}</span>
              </div>
              <div className="text-[13px] font-semibold">{m.mine ? "Bạn" : m.author_name ?? "?"}{m.author_side === "customer" ? " · khách" : ""}{m.internal ? " · nội bộ 🔒" : ""}</div>
              <div className="line-clamp-2 text-sm text-ink/85">{m.body}</div>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
