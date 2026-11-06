// Trạng thái đơn theo bộ Lanchi đang dùng
export const ORDER_STATUS: Record<string, { label: string; tone: "neutral" | "brand" | "warn" | "ok" | "danger" | "info" }> = {
  dang_len_don: { label: "Đang lên đơn", tone: "neutral" },
  cho_coc: { label: "Chờ cọc", tone: "warn" },
  dang_mua: { label: "Đang mua hàng", tone: "info" },
  cho_shop_giao: { label: "Chờ shop giao", tone: "info" },
  shop_da_phat: { label: "Shop đã phát", tone: "info" },
  ve_kho_qc: { label: "Về kho Quảng Châu", tone: "brand" },
  ve_bang_tuong: { label: "Về Bằng Tường", tone: "brand" },
  tren_xe: { label: "Đang trên xe", tone: "brand" },
  ve_kho_vn: { label: "Đã về kho VN", tone: "ok" },
  dang_giao: { label: "Đang giao", tone: "ok" },
  da_giao: { label: "Đã giao", tone: "ok" },
  hoan_tat: { label: "Hoàn tất", tone: "ok" },
  tam_giu: { label: "Tạm giữ", tone: "danger" },
  huy: { label: "Đã hủy", tone: "neutral" },
};
export const STATUS_FLOW = Object.keys(ORDER_STATUS);
export const INVOICE_TYPE: Record<string, string> = { HDPT: "HĐ phổ thông", HDCD: "HĐ chuyên dụng", KHD: "Không hóa đơn" };
export const STATEMENT_KIND: Record<string, string> = { du_tinh: "Dự tính", tam_tinh: "Tạm tính", quyet_toan: "Quyết toán" };
export const DELAY: Record<string, string> = { dung_lich: "Đúng lịch", san_xuat_7: "Sản xuất 7 ngày", san_xuat_15: "Sản xuất 15 ngày", san_xuat_tren_15: "Sản xuất > 15 ngày", khac: "Khác" };
