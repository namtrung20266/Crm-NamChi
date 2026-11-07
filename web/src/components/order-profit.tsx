"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/session";
import { rpc } from "@/lib/meta";
import { Card, Badge, inputCls, btn } from "./ui";
import { vnd, fmtNumber, parseMoney } from "@/lib/format";
import { viError } from "@/lib/errors";

type Line = { key: string; label: string; revenue_vnd: number; cost_rule_vnd: number | null; cost_actual_vnd: number | null; cost_override_vnd: number | null; override_note: string | null; cost_vnd: number | null; source: string; profit_vnd: number };
type P = { has_statement: boolean; lines: Line[]; revenue_vnd: number; cost_vnd: number; profit_vnd: number; margin_pct: number | null; missing: number; supplier_paid_cny: number; goods_cny: number };
const SRC: Record<string, [string, "ok" | "info" | "neutral" | "danger"]> = { nhap_tay: ["Nhập tay", "info"], thuc_te_ncc: ["Trả NCC thực tế", "ok"], bieu_phi: ["Biểu phí", "neutral"], thieu: ["Thiếu", "danger"] };

// Lợi nhuận đơn theo từng khoản; Admin/Kế toán đặt giá vốn thực tế cho từng khoản
export function OrderProfit({ orderId }: { orderId: string }) {
  const s = useSession();
  const qc = useQueryClient();
  const d = useQuery({ queryKey: ["order-profit", orderId], enabled: s.can("finance.profit.read"), queryFn: () => rpc<P>("order_profit_detail", { p_order_id: orderId }) });
  const [edit, setEdit] = useState<string | null>(null);
  const [val, setVal] = useState(""); const [note, setNote] = useState("");
  const [newLine, setNewLine] = useState({ label: "", amount: "" });
  const [err, setErr] = useState<string | null>(null);
  if (!s.can("finance.profit.read")) return null;
  const write = s.can("finance.cost.write");
  const save = async (key: string, label: string, amount: number, n: string) => {
    setErr(null);
    try { await rpc("set_order_cost", { p_order_id: orderId, p_cost_key: key, p_label: label, p_amount: amount, p_note: n || null }); setEdit(null); qc.invalidateQueries({ queryKey: ["order-profit", orderId] }); qc.invalidateQueries({ queryKey: ["admin-orders"] }); }
    catch (e) { setErr(viError(e)); }
  };
  const x = d.data;
  return (
    <Card title="Lợi nhuận đơn (nội bộ)" actions={x?.has_statement ? <span className={`font-mono text-sm font-semibold ${x.profit_vnd >= 0 ? "text-ok" : "text-danger"}`}>{vnd(x.profit_vnd)}{x.margin_pct != null ? ` · ${fmtNumber(x.margin_pct)}%` : ""}</span> : null}>
      {!x ? <div className="skeleton h-24" /> : !x.has_statement ? <p className="text-sm text-muted">Chưa có phiếu tính tiền nên chưa tính được lợi nhuận.</p> : (
        <>
          {x.missing ? <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{x.missing} khoản chưa có giá vốn → lợi nhuận đang bị tính cao hơn thực tế. {write ? "Bấm “Đặt” để nhập." : ""}</p> : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[14px]">
              <thead><tr className="text-left text-[12.5px] uppercase text-muted"><th className="pb-2">Khoản</th><th className="pb-2 text-right">Thu khách</th><th className="pb-2 text-right">Giá vốn</th><th className="pb-2">Nguồn giá vốn</th><th className="pb-2 text-right">Lãi</th><th /></tr></thead>
              <tbody>{x.lines.map((l) => (
                <tr key={l.key} className="border-t border-line/70 align-top">
                  <td className="py-2">{l.label}{l.override_note ? <div className="text-[12.5px] text-muted">{l.override_note}</div> : null}</td>
                  <td className="py-2 text-right font-mono">{fmtNumber(l.revenue_vnd)}</td>
                  <td className="py-2 text-right font-mono">{edit === l.key ? (
                    <div className="flex flex-col items-end gap-1"><input value={val} onChange={(e) => setVal(e.target.value)} autoFocus className={inputCls + " h-8 w-32 text-right font-mono"} />
                      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Căn cứ (HĐ, chứng từ…)" className={inputCls + " h-8 w-48 text-xs"} /></div>
                  ) : l.cost_vnd == null ? <span className="text-danger">—</span> : fmtNumber(l.cost_vnd)}
                    {l.cost_override_vnd != null && (l.cost_actual_vnd ?? l.cost_rule_vnd) != null ? <div className="text-[12px] text-muted line-through">{fmtNumber(l.cost_actual_vnd ?? l.cost_rule_vnd)}</div> : null}</td>
                  <td className="py-2"><Badge tone={SRC[l.source]?.[1]}>{SRC[l.source]?.[0]}</Badge></td>
                  <td className={`py-2 text-right font-mono ${l.profit_vnd >= 0 ? "text-ok" : "text-danger"}`}>{fmtNumber(l.profit_vnd)}</td>
                  <td className="py-2 pl-2 text-right">{write ? (edit === l.key
                    ? <span className="flex gap-1"><button onClick={() => save(l.key, l.label, parseMoney(val), note)} className={btn.primary + " h-7 px-2 text-xs"}>Lưu</button><button onClick={() => setEdit(null)} className={btn.ghost + " h-7 px-2 text-xs"}>✕</button></span>
                    : <button onClick={() => { setEdit(l.key); setVal(String(l.cost_vnd ?? "")); setNote(""); }} className="text-xs font-semibold text-brand-strong">Đặt</button>) : null}</td>
                </tr>
              ))}
                <tr className="border-t-2 border-line font-semibold"><td className="py-2">Tổng (chưa VAT)</td><td className="text-right font-mono">{fmtNumber(x.revenue_vnd)}</td><td className="text-right font-mono">{fmtNumber(x.cost_vnd)}</td><td /><td className={`text-right font-mono ${x.profit_vnd >= 0 ? "text-ok" : "text-danger"}`}>{fmtNumber(x.profit_vnd)}</td><td /></tr>
              </tbody>
            </table>
          </div>
          {write ? (
            <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
              <span className="text-xs text-muted">Chi phí phát sinh không thu khách (VD: bốc xếp, phạt lưu kho):</span>
              <input value={newLine.label} onChange={(e) => setNewLine({ ...newLine, label: e.target.value })} placeholder="Tên khoản" className={inputCls + " h-8 w-48"} />
              <input value={newLine.amount} onChange={(e) => setNewLine({ ...newLine, amount: e.target.value })} placeholder="Số tiền" className={inputCls + " h-8 w-32 font-mono"} />
              <button onClick={() => { if (newLine.label.trim() && parseMoney(newLine.amount) >= 0) { save("manual:" + newLine.label.trim(), newLine.label.trim(), parseMoney(newLine.amount), "Chi phí không thu khách"); setNewLine({ label: "", amount: "" }); } }} className={btn.secondary + " h-8 px-3 text-xs"}>+ Thêm chi phí</button>
            </div>
          ) : null}
          {err ? <p className="mt-2 text-xs text-danger">{err}</p> : null}
          <p className="mt-2 text-[12.5px] text-muted">Ưu tiên giá vốn: nhập tay → tiền hàng theo tỷ giá trả NCC thực tế (khi đã trả đủ {fmtNumber(x.goods_cny)} tệ, hiện {fmtNumber(x.supplier_paid_cny)}) → mức giá vốn trong Biểu phí. Mọi lần đặt đều lưu lịch sử.</p>
        </>
      )}
    </Card>
  );
}
