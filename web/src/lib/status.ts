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
export const PKG_STATUS: Record<string, { label: string; tone: "neutral" | "brand" | "warn" | "ok" | "danger" | "info" }> = {
  du_kien: { label: "Dự kiến", tone: "neutral" }, ve_kho: { label: "Đã về kho", tone: "info" }, tren_xe: { label: "Trên xe", tone: "brand" },
  ve_vn: { label: "Về VN", tone: "ok" }, thieu: { label: "Thiếu", tone: "danger" }, hong: { label: "Hỏng", tone: "danger" },
  sai_hang: { label: "Sai hàng", tone: "warn" }, da_giao: { label: "Đã giao", tone: "ok" },
};
export const COMPLIANCE: Record<string, string> = { none: "Không cần", qc: "Kiểm tra chất lượng", hop_quy: "Hợp quy", form_e: "C/O Form E", khac: "Khác" };
export const COMPLIANCE_STATUS: Record<string, string> = { khong_can: "Không cần", can_lam: "Cần làm", dang_lam: "Đang làm", cho_ket_qua: "Chờ kết quả", dat: "Đạt", khong_dat: "Không đạt" };
export const TRIP_STATUS: Record<string, { label: string; tone: "neutral" | "brand" | "warn" | "ok" | "danger" | "info" }> = {
  nhap: { label: "Đang lập", tone: "neutral" }, da_chot: { label: "Đã chốt", tone: "brand" }, da_khai_bao: { label: "Đã khai báo", tone: "info" },
  thong_quan: { label: "Thông quan", tone: "ok" }, ve_vn: { label: "Về VN", tone: "ok" }, huy: { label: "Hủy", tone: "danger" },
};
export const CLAIM_TYPE: Record<string, string> = { thieu: "Thiếu hàng", hong: "Hàng hỏng", sai_hang: "Sai hàng", cham: "Giao chậm", chat_luong: "Chất lượng", khac: "Khác" };
export const CLAIM_STATUS: Record<string, { label: string; tone: "neutral" | "brand" | "warn" | "ok" | "danger" | "info" }> = {
  moi: { label: "Mới", tone: "danger" }, dang_xac_minh: { label: "Đang xác minh", tone: "warn" }, cho_ncc: { label: "Chờ NCC", tone: "info" },
  cho_khach: { label: "Chờ khách phản hồi", tone: "info" }, cho_boi_thuong: { label: "Chờ bồi thường", tone: "brand" },
  da_giai_quyet: { label: "Đã giải quyết", tone: "ok" }, dong: { label: "Đã đóng", tone: "neutral" }, tu_choi: { label: "Từ chối", tone: "neutral" },
};
export const CREDIT_KIND: Record<string, string> = { boi_thuong: "Bồi thường", xu_ly_chenh: "Xử lý chênh", ho_tro_hang_mau: "Hỗ trợ hàng mẫu", khac: "Khác" };
