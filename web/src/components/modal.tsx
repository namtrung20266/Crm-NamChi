"use client";

import { useEffect } from "react";

export function Modal({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal className={`card max-h-[92dvh] w-full overflow-y-auto rounded-b-none sm:rounded-b-2xl ${wide ? "max-w-4xl" : "max-w-lg"}`}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white px-5 py-3.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className="h-8 w-8 rounded-lg text-muted hover:bg-surface" aria-label="Đóng">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
