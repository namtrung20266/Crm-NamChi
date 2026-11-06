export function viError(e: unknown): string {
  const err = e as { code?: string; message?: string } | null;
  if (!err) return "Có lỗi xảy ra, thử lại sau.";
  switch (err.code) {
    case "42501": return /[À-ỹ]/.test(err.message ?? "") ? err.message! : "Bạn không có quyền thực hiện thao tác này.";
    case "40001": return "Dữ liệu vừa được người khác sửa. Tải lại rồi làm lại.";
    case "23505": return "Mã hoặc email này đã tồn tại.";
    case "23514": return /[À-ỹ]/.test(err.message ?? "") ? err.message! : "Dữ liệu không đúng định dạng cho phép.";
    case "23503": return "Dữ liệu liên quan không tồn tại.";
    case "22023": return err.message ?? "Dữ liệu không hợp lệ.";
    case "PGRST116": return "Không tìm thấy dữ liệu.";
    default: return err.message && /[À-ỹ]/.test(err.message) ? err.message : "Có lỗi xảy ra, thử lại sau.";
  }
}
export type ActionState = { ok?: boolean; error?: string; message?: string; link?: string };
