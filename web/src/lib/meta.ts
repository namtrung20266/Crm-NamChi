"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "./supabase";
import { ORDER_STATUS } from "./status";

export type Tone = "neutral" | "brand" | "warn" | "ok" | "danger" | "info";
export type StatusDef = { code: string; label: string; customer_label: string | null; tone: Tone; rank: number; phase: string; owner_role: string | null; sla_days: number | null; notify_customer: boolean; is_system: boolean; is_active: boolean; description: string | null };
export type Lookup = { id: string; category: string; code: string; label: string; sort_order: number; is_active: boolean; meta: Record<string, unknown>; row_version: number };

// Bộ trạng thái đơn lấy từ cấu hình (cache 10 phút)
export function useStatusDefs() {
  return useQuery({ queryKey: ["status-defs"], staleTime: 600_000, queryFn: () => q<StatusDef[]>(supabase.from("order_status_defs").select("*").order("rank")) });
}
export function statusOf(defs: StatusDef[] | undefined, code: string, customer = false): { label: string; tone: Tone } {
  const d = defs?.find((x) => x.code === code);
  if (d) return { label: (customer && d.customer_label) || d.label, tone: d.tone };
  return ORDER_STATUS[code] ?? { label: code, tone: "neutral" };
}

export function useLookups(category?: string) {
  return useQuery({
    queryKey: ["lookups", category ?? "all"], staleTime: 600_000,
    queryFn: () => {
      let x = supabase.from("lookup_values").select("*").order("category").order("sort_order");
      if (category) x = x.eq("category", category);
      return q<Lookup[]>(x);
    },
  });
}
export const lookupLabel = (rows: Lookup[] | undefined, code: string | null | undefined) => (code ? rows?.find((r) => r.code === code)?.label ?? code : "—");

export const PHASES: Record<string, string> = { tiep_nhan: "Tiếp nhận", mua_hang: "Mua hàng", van_chuyen: "Vận chuyển", viet_nam: "Tại Việt Nam", ket_thuc: "Kết thúc", ngoai_le: "Ngoại lệ" };
export const PAYMENT_STATE: Record<string, { label: string; tone: Tone }> = {
  chua_bao_gia: { label: "Chưa báo giá", tone: "neutral" }, cho_xac_nhan: { label: "Chờ xác nhận giá", tone: "warn" },
  cho_coc: { label: "Chờ cọc", tone: "warn" }, coc_thieu: { label: "Cọc thiếu", tone: "danger" }, da_coc: { label: "Đã cọc", tone: "info" },
  da_tt_du: { label: "Đã thu đủ", tone: "ok" }, tra_thua: { label: "Trả thừa", tone: "brand" },
};
export const DELIVERY_STATE: Record<string, { label: string; tone: Tone }> = {
  chua_co_dong: { label: "Chưa có dòng hàng", tone: "neutral" }, chua_giao: { label: "Chưa giao", tone: "neutral" },
  giao_mot_phan: { label: "Giao một phần", tone: "warn" }, da_giao_du: { label: "Giao đủ", tone: "ok" },
};
export const INVOICE_STATE: Record<string, { label: string; tone: Tone }> = {
  chua_co_dong: { label: "Chưa có dòng hàng", tone: "neutral" }, chua_xuat: { label: "Chưa xuất HĐ", tone: "neutral" },
  dang_lap: { label: "Đang lập HĐ", tone: "info" }, xuat_mot_phan: { label: "Xuất thiếu", tone: "warn" }, da_xuat_du: { label: "Xuất đủ HĐ", tone: "ok" },
};
export const SETTING_LABEL: Record<string, string> = {
  "shipping.volumetric_divisor": "Hệ số quy đổi khối → kg (D×R×C / hệ số)",
  "finance.writeoff_threshold_vnd": "Ngưỡng xử lý chênh (đ)",
  "finance.deposit_rate_percent": "Tỷ lệ cọc mặc định (% tiền hàng)",
  "finance.default_fx_rate": "Tỷ giá mặc định khi tạo đơn",
  "file.max_size_bytes": "Dung lượng file tối đa (byte)",
  "file.signed_url_ttl_seconds": "Thời hạn link tải file (giây)",
  "order.auto_status_enabled": "Tự chuyển trạng thái đơn theo dữ liệu",
  "order.payment_requires_confirmed_quote": "Chỉ cho thanh toán khi khách đã xác nhận báo giá",
  "order.complete_requires_invoice": "Đơn chỉ Hoàn tất khi đã phát hành HĐ đủ",
  "order.require_attachment_on_submit": "Bắt buộc có ảnh/file khi gửi đơn",
  "wallet.customer_can_pay": "Khách được tự thanh toán từ ví",
  "wallet.min_topup_vnd": "Số tiền nạp ví tối thiểu (đ)",
  "notify.poll_seconds": "Chu kỳ làm mới thông báo (giây)",
};
export const LOOKUP_CATEGORY: Record<string, string> = {
  goods_group: "Nhóm hàng", order_source: "Nguồn đơn", uom: "Đơn vị tính", delay_reason: "Lý do chậm", origin: "Xuất xứ",
  attachment_category: "Loại file đính kèm", topup_account: "Tài khoản nhận tiền", quick_reply: "Câu trả lời nhanh",
};

// Gọi RPC trả về 1 giá trị
export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  return q<T>(supabase.rpc(fn, args));
}
