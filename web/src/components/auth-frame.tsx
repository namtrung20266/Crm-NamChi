// Khung dùng chung cho Đăng nhập / Đặt mật khẩu: bản đồ tuyến hàng động + thẻ form
const STATIONS = [
  { x: 70, y: 400, vi: "Quảng Châu", zh: "广州", note: "Kho gom" },
  { x: 300, y: 250, vi: "Bằng Tường", zh: "凭祥", note: "Cân đo · List bốc" },
  { x: 430, y: 170, vi: "Hữu Nghị", zh: "友谊关", note: "Thông quan" },
  { x: 560, y: 70, vi: "Hà Nội", zh: "河内", note: "Kho VN · Giao hàng" },
];
const ROUTE = "M70 400 C 150 360, 220 300, 300 250 S 390 200, 430 170 S 520 100, 560 70";
const STAGES = ["Đơn hàng", "Kiện & cân", "List xe", "Tờ khai", "Hóa đơn"];

export function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="auth-root" data-theme="staff">
      <section className="auth-stage" aria-hidden>
        <div className="auth-grid" />
        <div className="auth-glow" />
        <header className="relative z-10 flex items-center gap-3">
          <Mark />
          <div>
            <div className="text-[11px] font-semibold tracking-[0.32em] text-white/50">NAM TRUNG GROUP</div>
            <div className="text-sm font-semibold tracking-wide text-white">NAMCHI</div>
          </div>
        </header>

        <div className="relative z-10 mt-auto max-w-[560px]">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-[var(--brand)]">Tuyến chính ngạch · đường bộ</p>
          <h1 className="auth-headline">
            Mỗi kiện hàng,<br />một <em>dòng dữ liệu</em><br />xuyên suốt.
          </h1>
          <ul className="mt-6 flex flex-wrap gap-2">
            {STAGES.map((s, i) => (
              <li key={s} className="auth-chip" style={{ animationDelay: `${i * 1.2}s` }}>{s}</li>
            ))}
          </ul>
        </div>

        <svg viewBox="0 0 640 470" className="auth-map" role="presentation">
          <defs>
            <linearGradient id="rt" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#e8590c" stopOpacity=".15" />
              <stop offset=".5" stopColor="#f97316" stopOpacity=".9" />
              <stop offset="1" stopColor="#fdba74" />
            </linearGradient>
            <radialGradient id="dot"><stop offset="0" stopColor="#fff7ed" /><stop offset=".45" stopColor="#fb923c" /><stop offset="1" stopColor="#e8590c" stopOpacity="0" /></radialGradient>
          </defs>
          {/* biên giới */}
          <path d="M120 300 C 230 210, 330 210, 420 120 S 560 40, 620 30" fill="none" stroke="#ffffff" strokeOpacity=".09" strokeDasharray="2 7" />
          <text x="455" y="128" fill="#ffffff" fillOpacity=".28" fontSize="10" letterSpacing="3" transform="rotate(-24 455 128)">BIÊN GIỚI · 边境</text>
          <path d={ROUTE} fill="none" stroke="#ffffff" strokeOpacity=".07" strokeWidth="14" strokeLinecap="round" />
          <path d={ROUTE} fill="none" stroke="url(#rt)" strokeWidth="2.5" strokeLinecap="round" className="auth-route" />
          <path d={ROUTE} fill="none" stroke="#fdba74" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="1 14" className="auth-flow" />
          {STATIONS.map((s, i) => (
            <g key={s.vi}>
              <circle cx={s.x} cy={s.y} r="16" fill="#e8590c" fillOpacity=".12" className="auth-ping" style={{ animationDelay: `${i * 0.9}s` }} />
              <circle cx={s.x} cy={s.y} r="5.5" fill="#0f0d0c" stroke="#fb923c" strokeWidth="2" />
              <text x={s.x + 14} y={s.y + 4} fill="#fff" fontSize="13" fontWeight="600">{s.vi}</text>
              <text x={s.x + 14} y={s.y + 20} fill="#ffffff" fillOpacity=".45" fontSize="10">{s.zh} · {s.note}</text>
            </g>
          ))}
          <g className="auth-truck">
            <circle r="14" fill="url(#dot)" />
            <circle r="3.5" fill="#fff" />
            <animateMotion dur="9s" repeatCount="indefinite" path={ROUTE} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines=".45 0 .35 1" />
          </g>
        </svg>

        <footer className="relative z-10 mt-8 flex items-center justify-between text-[11px] text-white/35">
          <span>CRM &amp; Import Management</span>
          <span className="font-mono">GZ → PX → HN</span>
        </footer>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="mb-7 flex items-center gap-3 lg:hidden"><Mark /><span className="text-sm font-semibold">NAMCHI</span></div>
          <h2 className="text-[26px] font-semibold tracking-tight text-ink">{title}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{subtitle}</p>
          <div className="mt-7">{children}</div>
        </div>
        <p className="mt-6 text-center text-[11px] text-muted">© Nam Trung Group · Dữ liệu được mã hóa và phân quyền theo từng khách hàng</p>
      </section>
    </main>
  );
}

function Mark() {
  return (
    <span className="relative inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-[var(--brand)] font-mono text-sm font-bold text-white shadow-[0_8px_24px_-8px_rgba(232,89,12,.8)]">
      NT
      <span className="absolute -right-2 -top-2 h-5 w-5 rounded-full bg-white/25" />
    </span>
  );
}
