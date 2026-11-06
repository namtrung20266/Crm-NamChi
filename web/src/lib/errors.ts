// Chuyển lỗi Postgres/Supabase sang câu tiếng Việt dễ hiểu
export function viError(e: { code?: string; message?: string } | null | undefined): string {
  if (!e) return "Có lỗi xảy ra, thử lại sau.";
  switch (e.code) {
    case "42501": return "Bạn không có quyền thực hiện thao tác này.";
    case "40001": return "Dữ liệu vừa được người khác sửa. Tải lại trang rồi làm lại.";
    case "23505": return "Mã hoặc email này đã tồn tại.";
    case "23514": return "Dữ liệu không đúng định dạng cho phép.";
    case "23503": return "Dữ liệu liên quan không tồn tại.";
    case "22023": return e.message ?? "Dữ liệu không hợp lệ.";
    default: return e.message && /[À-ỹ]/.test(e.message) ? e.message : "Có lỗi xảy ra, thử lại sau.";
  }
}

export type ActionState = { ok?: boolean; error?: string; message?: string; link?: string };
