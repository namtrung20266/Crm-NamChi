import Link from "next/link";

export function PageHeader({ eyebrow, title, desc, actions }: { eyebrow?: string; title: string; desc?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="font-mono text-[12.5px] uppercase tracking-[0.22em] text-brand">{eyebrow}</p> : null}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
        {desc ? <p className="mt-1 max-w-2xl text-sm text-muted">{desc}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, actions, children, className = "" }: { title?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </div>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

const btnBase = "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition disabled:opacity-50 disabled:pointer-events-none";
export const btn = {
  primary: `${btnBase} bg-brand text-white hover:bg-brand-strong`,
  secondary: `${btnBase} border border-line bg-white text-ink hover:border-ink/30`,
  ghost: `${btnBase} text-muted hover:text-ink hover:bg-surface`,
  danger: `${btnBase} border border-danger/30 bg-white text-danger hover:bg-danger/5`,
};

export function LinkButton({ href, children, variant = "primary" }: { href: string; children: React.ReactNode; variant?: keyof typeof btn }) {
  return <Link href={href} className={btn[variant]}>{children}</Link>;
}

export const inputCls =
  "h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none transition placeholder:text-muted/60 focus:border-brand focus:ring-2 focus:ring-brand/15";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[14px] font-medium text-ink">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

const tones = {
  neutral: "bg-surface text-muted border-line",
  ok: "bg-ok/10 text-ok border-ok/20",
  warn: "bg-amber-50 text-amber-700 border-amber-200",
  danger: "bg-danger/10 text-danger border-danger/20",
  brand: "bg-brand-soft text-brand-strong border-brand/20",
  info: "bg-blue-50 text-blue-700 border-blue-200",
};
export function Badge({ tone = "neutral", children }: { tone?: keyof typeof tones; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[12.5px] font-medium ${tones[tone]}`}>{children}</span>;
}

export function Empty({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {desc ? <p className="mt-1 text-xs text-muted">{desc}</p> : null}
    </div>
  );
}

export function Notice({ tone = "danger", children }: { tone?: "danger" | "ok"; children: React.ReactNode }) {
  const c = tone === "ok" ? "border-ok/30 bg-ok/5 text-ok" : "border-danger/30 bg-danger/5 text-danger";
  return <p role="alert" className={`rounded-lg border px-3 py-2 text-sm ${c}`}>{children}</p>;
}

// Bảng trên máy tính, thẻ trên điện thoại
export function Skeleton({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-2">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton h-10" />)}</div>;
}

export function DataList<T>({ rows, columns, mobile, empty }: {
  rows: T[];
  columns: { head: string; cell: (r: T) => React.ReactNode; className?: string }[];
  mobile: (r: T) => React.ReactNode;
  empty: React.ReactNode;
}) {
  if (rows.length === 0) return <>{empty}</>;
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
              {columns.map((c) => <th key={c.head} className={`px-3 py-2.5 font-medium ${c.className ?? ""}`}>{c.head}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line/70 last:border-0 hover:bg-surface/70">
                {columns.map((c) => <td key={c.head} className={`px-3 py-3 align-middle ${c.className ?? ""}`}>{c.cell(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 md:hidden">
        {rows.map((r, i) => <li key={i} className="rounded-lg border border-line p-3.5">{mobile(r)}</li>)}
      </ul>
    </>
  );
}
