import Link from "next/link";
import type { SessionContext } from "@/lib/session";
import { NAV } from "./nav";
import { logout } from "@/app/login/actions";

export function AppShell({ session, children }: { session: SessionContext; children: React.ReactNode }) {
  const items = NAV.filter((i) => i.show(session));
  const theme = session.userType === "staff" ? "staff" : "customer";
  const scope =
    session.userType === "staff"
      ? "Nam Trung"
      : session.entity
        ? `${session.customer?.name ?? ""} · ${session.entity.legalName}`
        : session.customer?.name ?? "";

  return (
    <div data-theme={theme} className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      {/* Thanh bên – máy tính */}
      <aside className="hidden border-r border-line bg-white lg:flex lg:min-h-dvh lg:flex-col">
        <div className="border-b border-line px-5 py-5">
          <div className="text-[11px] font-semibold tracking-[0.2em] text-brand">NAMCHI</div>
          <div className="mt-1 truncate text-sm font-medium text-ink" title={scope}>{scope}</div>
        </div>
        <nav className="flex-1 space-y-0.5 p-3" aria-label="Điều hướng chính">
          {items.map((i) =>
            i.ready ? (
              <Link key={i.href} href={i.href}
                className="flex h-10 items-center rounded-md px-3 text-sm font-medium text-ink hover:bg-brand-soft hover:text-brand-strong">
                {i.label}
              </Link>
            ) : (
              <span key={i.href} aria-disabled
                className="flex h-10 items-center justify-between rounded-md px-3 text-sm text-muted">
                {i.label}
                <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted">Bước 4</span>
              </span>
            ),
          )}
        </nav>
        <UserBox session={session} />
      </aside>

      {/* Đầu trang – điện thoại */}
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-line bg-white/95 px-4 backdrop-blur lg:hidden"
        style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold tracking-[0.2em] text-brand">NAMCHI</div>
          <div className="truncate text-sm font-medium">{scope}</div>
        </div>
        <form action={logout}>
          <button className="h-11 rounded-md px-3 text-sm font-medium text-muted">Thoát</button>
        </form>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-5 lg:px-8 lg:pb-10 lg:pt-8">{children}</main>

      {/* Thanh dưới – điện thoại */}
      <nav aria-label="Điều hướng nhanh"
        className="fixed inset-x-0 bottom-0 z-10 grid border-t border-line bg-white lg:hidden"
        style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 4)}, minmax(0,1fr))`, paddingBottom: "env(safe-area-inset-bottom)" }}>
        {items.slice(0, 4).map((i) => (
          <Link key={i.href} href={i.ready ? i.href : "#"} aria-disabled={!i.ready}
            className={`flex h-14 items-center justify-center text-xs font-medium ${i.ready ? "text-ink" : "text-muted/60"}`}>
            {i.short}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function UserBox({ session }: { session: SessionContext }) {
  return (
    <div className="border-t border-line p-4">
      <div className="truncate text-sm font-medium">{session.fullName}</div>
      <div className="truncate text-xs text-muted">{session.roles.map((r) => r.name).join(", ") || "Chưa gán vai trò"}</div>
      <form action={logout} className="mt-3">
        <button className="h-9 w-full rounded-md border border-line text-sm font-medium text-muted hover:text-ink">Đăng xuất</button>
      </form>
    </div>
  );
}
