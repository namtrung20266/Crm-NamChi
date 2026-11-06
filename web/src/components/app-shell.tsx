"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { NAV } from "./nav";
import { NotificationBell } from "./notifications";

function Icon({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const s = useSession();
  const path = usePathname();
  const router = useRouter();
  const items = NAV.filter((i) => i.show(s));
  const groups = [...new Set(items.map((i) => i.group))];
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href.replace(/\/$/, "")));
  const scope = s.isStaff ? "Nam Trung · nội bộ" : s.entity ? `${s.customer?.name} · ${s.entity.legal_name}` : s.customer?.name ?? "";
  const logout = async () => { await supabase.auth.signOut(); router.replace("/login/"); };
  const mobile = items.filter((i) => ["/", "/don-hang/", "/cong-no/", "/khach-hang/", "/ho-so/"].includes(i.href)).slice(0, 5);

  return (
    <div data-theme={s.isStaff ? "staff" : "customer"} className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="glass sticky top-0 hidden h-dvh flex-col border-r border-line/80 lg:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-brand font-mono text-xs font-bold text-white shadow-[0_8px_20px_-8px_var(--brand)]">NT</span>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold tracking-[0.24em] text-brand">NAMCHI</div>
            <div className="truncate text-xs text-muted" title={scope}>{scope}</div>
          </div>
          <NotificationBell />
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Điều hướng chính">
          {groups.map((g) => (
            <div key={g}>
              <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted/80">{g}</div>
              {items.filter((i) => i.group === g).map((i) => (
                <Link key={i.href} href={i.href} prefetch
                  className={`flex h-10 items-center gap-3 rounded-lg px-3 text-[13.5px] font-medium transition ${active(i.href) ? "nav-active" : "text-ink/80 hover:bg-white hover:text-ink"}`}>
                  <Icon d={i.icon} />{i.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-line/80 p-4">
          <div className="truncate text-sm font-semibold">{s.full_name}</div>
          <div className="truncate text-xs text-muted">{s.roles.map((r) => r.name).join(", ")}</div>
          <button onClick={logout} className="mt-3 h-9 w-full rounded-lg border border-line bg-white text-sm font-medium text-muted transition hover:text-ink">Đăng xuất</button>
        </div>
      </aside>

      <header className="glass sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line/80 px-4 lg:hidden" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand font-mono text-[11px] font-bold text-white">NT</span>
          <div className="min-w-0"><div className="truncate text-sm font-semibold">{scope}</div></div>
        </div>
        <div className="flex items-center gap-1"><NotificationBell align="right" /><button onClick={logout} className="h-11 px-2 text-sm font-medium text-muted">Thoát</button></div>
      </header>

      <main key={path} className="page-enter mx-auto w-full max-w-7xl px-4 pb-28 pt-5 lg:px-8 lg:pb-12 lg:pt-8">{children}</main>

      <nav aria-label="Điều hướng nhanh" className="glass fixed inset-x-0 bottom-0 z-20 grid border-t border-line/80 lg:hidden"
        style={{ gridTemplateColumns: `repeat(${mobile.length}, minmax(0,1fr))`, paddingBottom: "env(safe-area-inset-bottom)" }}>
        {mobile.map((i) => (
          <Link key={i.href} href={i.href} className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium ${active(i.href) ? "text-brand-strong" : "text-muted"}`}>
            <Icon d={i.icon} />{i.short}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function ShellSkeleton() {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="hidden border-r border-line/80 lg:block" />
      <div className="mx-auto w-full max-w-7xl space-y-4 px-4 pt-8 lg:px-8">
        <div className="skeleton h-8 w-64" /><div className="skeleton h-28" /><div className="skeleton h-64" />
      </div>
    </div>
  );
}
