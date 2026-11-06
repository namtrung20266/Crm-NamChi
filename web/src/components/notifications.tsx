"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { rpc } from "@/lib/meta";
import { fmtDateTime } from "@/lib/format";

type N = { id: number; kind: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null };
const ICON: Record<string, string> = { "order.message": "💬", "order.status": "🔄", "order.quote": "🧾", "order.payment": "💳", "wallet.topup": "👛", "order.new": "🆕" };

// Chuông thông báo: realtime khi có, dự phòng làm mới mỗi 30 giây
export function NotificationBell({ align = "left" }: { align?: "left" | "right" }) {
  const s = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const list = useQuery({ queryKey: ["notifications"], refetchInterval: 30_000, refetchOnWindowFocus: true,
    queryFn: () => q<N[]>(supabase.from("notifications").select("id, kind, title, body, link, created_at, read_at").order("created_at", { ascending: false }).limit(40)) });
  useEffect(() => {
    const ch = supabase.channel(`notif-${s.user_id}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${s.user_id}` }, () => {
        qc.invalidateQueries({ queryKey: ["notifications"] });
        qc.invalidateQueries({ queryKey: ["order-progress"] });
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [s.user_id, qc]);
  const rows = list.data ?? [];
  const unread = rows.filter((r) => !r.read_at).length;
  const markAll = async () => { await rpc("mark_notifications_read", { p_ids: null }); qc.invalidateQueries({ queryKey: ["notifications"] }); };
  const markOne = async (id: number) => { await rpc("mark_notifications_read", { p_ids: [id] }); qc.invalidateQueries({ queryKey: ["notifications"] }); };

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} aria-label="Thông báo" className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-white text-ink/70 hover:text-ink">
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 003.4 0" /></svg>
        {unread ? <span className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-brand px-1 text-center font-mono text-[10px] font-bold leading-[18px] text-white">{unread > 99 ? "99+" : unread}</span> : null}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className={`absolute z-40 mt-2 w-[360px] max-w-[92vw] overflow-hidden rounded-xl border border-line bg-white shadow-xl ${align === "right" ? "right-0" : "left-0"}`}>
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="text-sm font-semibold">Thông báo {unread ? `(${unread} chưa đọc)` : ""}</span>
              {unread ? <button onClick={markAll} className="text-xs font-semibold text-brand-strong">Đánh dấu đã đọc hết</button> : null}
            </div>
            <ul className="max-h-[60vh] divide-y divide-line/70 overflow-y-auto">
              {rows.length === 0 ? <li className="px-4 py-8 text-center text-sm text-muted">Chưa có thông báo</li> : rows.map((n) => (
                <li key={n.id} className={n.read_at ? "" : "bg-brand-soft/60"}>
                  <Link href={n.link ?? "#"} onClick={() => { markOne(n.id); setOpen(false); }} className="flex gap-3 px-4 py-2.5 hover:bg-surface">
                    <span className="mt-0.5 text-base">{ICON[n.kind] ?? "🔔"}</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[13px] ${n.read_at ? "" : "font-semibold"}`}>{n.title}</span>
                      {n.body ? <span className="line-clamp-2 block text-xs text-muted">{n.body}</span> : null}
                      <span className="block font-mono text-[10px] text-muted">{fmtDateTime(n.created_at)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
