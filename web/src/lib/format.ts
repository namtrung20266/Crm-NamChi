const dt = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
const d = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
const n = new Intl.NumberFormat("vi-VN");
export const fmtDateTime = (v?: string | null) => (v ? dt.format(new Date(v)) : "—");
export const fmtDate = (v?: string | null) => (v ? d.format(new Date(v)) : "—");
export const fmtNumber = (v?: number | null) => (v == null ? "—" : n.format(v));
