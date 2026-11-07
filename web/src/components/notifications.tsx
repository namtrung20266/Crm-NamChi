"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { rpc } from "@/lib/meta";
import { fmtDateTime } from "@/lib/format";

type N = { id: number; kind: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null };
const ICON: Record<string, string> = { "order.message": "💬", "order.status": "🔄", "order.quote": "🧾", "order.payment": "💳", "wallet.topup": "👛", "order.new": "🆕" };
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// Hiện thông báo của trình duyệt/hệ điều hành (máy tính, Android) khi có thông báo mới
function osNotify(n: N) {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const x = new Notification(n.title, { body: n.body ?? "", icon: `${BASE}/favicon.ico`, tag: `namchi-${n.id}` });
    x.onclick = () => { window.focus(); if (n.link) window.location.href = BASE + n.link; x.close(); };
  } catch { /* trình duyệt chặn */ }
}

// Chuông thông báo: bảng trượt bên phải màn hình, realtime + làm mới 30 giây, báo ra màn hình máy
export function NotificationBell() {
  const s = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState<string>("default");
  const seen = useRef<number>(0);
  const list = useQuery({ queryKey: ["notifications"], refetchInterval: 30_000, refetchOnWindowFocus: true,
    queryFn: () => q<N[]>(supabase.from("notifications").select("id, kind, title, body, link, created_at, read_at").order("created_at", { ascending: false }).limit(60)) });
  const rows = list.data ?? [];
  useEffect(() => { if ("Notification" in window) setPerm(Notification.permission); }, []);
  // phát thông báo hệ thống cho bản ghi mới (bỏ qua lần tải đầu)
  useEffect(() => {
    if (!rows.length) return;
    const max = rows[0].id;
    if (seen.current && max > seen.current) rows.filter((r) => r.id > seen.current && !r.read_at).slice(0, 3).forEach(osNotify);
    seen.current = Math.max(seen.current, max);
  }, [rows]);
  useEffect(() => {
    const ch = supabase.channel(`notif-${s.user_id}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${s.user_id}` }, () => {
        qc.invalidateQueries({ queryKey: ["notifications"] });
        qc.invalidateQueries({ queryKey: ["order-progress"] });
        qc.invalidateQueries({ queryKey: ["recent-messages"] });
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [s.user_id, qc]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);
  const unread = rows.filter((r) => !r.read_at).length;
  useEffect(() => { document.title = unread ? `(${unread}) NAMCHI · Nam Trung` : "NAMCHI · Nam Trung"; }, [unread]);
  const mark = async (ids: number[] | null) => { await rpc("mark_notifications_read", { p_ids: ids }); qc.invalidateQueries({ queryKey: ["notifications"] }); };
  const ask = async () => { if ("Notification" in window) setPerm(await Notification.requestPermission()); };

  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Thông báo" className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-white text-ink/70 hover:text-ink">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 003.4 0" /></svg>
        {unread ? <span className="absolute -right-1.5 -top-1.5 min-w-[20px] rounded-full bg-brand px-1 text-center text-[12px] font-bold leading-[20px] text-white">{unread > 99 ? "99+" : unread}</span> : null}
      </button>
      {open && typeof document !== "undefined" ? createPortal(
        <div className="fixed inset-0 z-[100] flex justify-end bg-ink/30 backdrop-blur-[1px]" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <aside className="flex h-full w-full max-w-[440px] flex-col bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-line px-5 py-4">
              <div><div className="text-base font-semibold">Thông báo</div><div className="text-sm text-muted">{unread ? `${unread} chưa đọc` : "Đã đọc hết"}</div></div>
              <div className="flex items-center gap-2">
                {unread ? <button onClick={() => mark(null)} className="rounded-lg px-3 py-2 text-sm font-semibold text-brand-strong hover:bg-brand-soft">Đọc hết</button> : null}
                <button onClick={() => setOpen(false)} className="h-9 w-9 rounded-lg text-lg text-muted hover:bg-surface" aria-label="Đóng">✕</button>
              </div>
            </header>
            {perm !== "granted" && "Notification" in (typeof window !== "undefined" ? window : {}) ? (
              <div className="mx-4 mt-3 rounded-xl bg-brand-soft px-4 py-3 text-sm">
                {perm === "denied" ? "Trình duyệt đang chặn thông báo. Mở cài đặt trang (biểu tượng ổ khóa) → cho phép Thông báo." : <>Nhận thông báo ra màn hình máy tính/điện thoại khi có tin mới. <button onClick={ask} className="ml-1 font-semibold text-brand-strong underline">Bật ngay</button></>}
              </div>
            ) : null}
            <ul className="flex-1 divide-y divide-line/70 overflow-y-auto">
              {rows.length === 0 ? <li className="px-5 py-12 text-center text-sm text-muted">Chưa có thông báo</li> : rows.map((n) => (
                <li key={n.id} className={n.read_at ? "" : "bg-brand-soft/50"}>
                  <Link href={n.link ?? "#"} onClick={() => { if (!n.read_at) mark([n.id]); setOpen(false); }} className="flex gap-3 px-5 py-3.5 hover:bg-surface">
                    <span className="mt-0.5 text-lg">{ICON[n.kind] ?? "🔔"}</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[15px] leading-snug ${n.read_at ? "text-ink/80" : "font-semibold"}`}>{n.title}</span>
                      {n.body ? <span className="mt-0.5 line-clamp-2 block text-sm text-muted">{n.body}</span> : null}
                      <span className="mt-1 block text-[12.5px] text-muted">{fmtDateTime(n.created_at)}</span>
                    </span>
                    {!n.read_at ? <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-brand" /> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        </div>, document.body
      ) : null}
    </>
  );
}
