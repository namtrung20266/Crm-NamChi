import type { SessionValue } from "@/lib/session";

export interface NavItem { href: string; label: string; short: string; icon: string; group: string; show: (s: SessionValue) => boolean }
const any = (s: SessionValue, ...p: string[]) => p.some((x) => s.can(x));

export const NAV: NavItem[] = [
  { group: "Vận hành", href: "/", label: "Tổng quan", short: "Tổng quan", icon: "M3 12l9-8 9 8M5 10v10h14V10", show: () => true },
  { group: "Vận hành", href: "/don-hang/", label: "Đơn hàng", short: "Đơn", icon: "M4 7h16l-1.5 12h-13zM8 7V5a4 4 0 018 0v2", show: (s) => s.isStaff || any(s, "order.create_own") || !!s.customer },
  { group: "Vận hành", href: "/khach-hang/", label: "Khách hàng", short: "Khách", icon: "M16 11a4 4 0 10-8 0M3 21a9 9 0 0118 0", show: (s) => s.isStaff && any(s, "customer.read_all", "customer.read_assigned") },
  { group: "Kho & hải quan", href: "/khai-bao/", label: "Bàn khai báo", short: "Khai báo", icon: "M9 12h6M9 16h6M9 8h2M5 3h14v18H5z", show: (s) => s.isStaff && any(s, "customs.write", "customs.confirm") },
  { group: "Kho & hải quan", href: "/list-boc/", label: "List bốc", short: "List bốc", icon: "M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7", show: (s) => s.isStaff },
  { group: "Kho & hải quan", href: "/list-xe/", label: "List xe", short: "Xe", icon: "M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z", show: (s) => s.isStaff },
  { group: "Kho & hải quan", href: "/kho-vn/", label: "Kho VN – nhận xe", short: "Kho VN", icon: "M3 21V9l9-6 9 6v12M9 21v-6h6v6", show: (s) => s.isStaff && s.can("warehouse.write") },
  { group: "Kho & hải quan", href: "/giao-hang/", label: "Giao hàng", short: "Giao", icon: "M5 13l4 4L19 7", show: (s) => s.isStaff },
  { group: "Tài chính", href: "/hoa-don/", label: "Hóa đơn", short: "HĐ", icon: "M7 3h10v18l-3-2-2 2-2-2-3 2zM9 8h6M9 12h6", show: (s) => s.isStaff && s.can("finance.read") },
  { group: "Vận hành", href: "/khieu-nai/", label: "Khiếu nại", short: "KN", icon: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z", show: () => true },
  { group: "Tài chính", href: "/tien-vao/", label: "Tiền vào", short: "Tiền", icon: "M3 7h18v10H3zM7 12h.01M17 12h.01M12 9a3 3 0 110 6 3 3 0 010-6", show: (s) => s.isStaff && s.can("finance.read") },
  { group: "Tài chính", href: "/cong-no/", label: "Công nợ & đối soát", short: "Công nợ", icon: "M4 19V5M4 19h16M8 15l4-4 3 3 5-6", show: (s) => (s.isStaff && s.can("finance.read")) || !s.isStaff },
  { group: "Tài chính", href: "/bieu-phi/", label: "Biểu phí", short: "Phí", icon: "M9 7h6M9 11h6M9 15h4M5 3h14v18H5z", show: (s) => s.isStaff && any(s, "fee.manage", "finance.read") },
  { group: "Khách hàng", href: "/cong-ty/", label: "Công ty của tôi", short: "Công ty", icon: "M4 21V7l8-4 8 4v14M9 21v-6h6v6", show: (s) => !s.isStaff },
  { group: "Khách hàng", href: "/tai-khoan/", label: "Tài khoản", short: "Tài khoản", icon: "M16 11a4 4 0 10-8 0M3 21a9 9 0 0118 0", show: (s) => !s.isStaff && s.can("customer_user.invite") },
  { group: "Hệ thống", href: "/nhan-vien/", label: "Nhân viên & vai trò", short: "Nhân viên", icon: "M17 20h5v-2a3 3 0 00-5-2M9 11a4 4 0 100-8 4 4 0 000 8zM2 20a7 7 0 0114 0", show: (s) => s.can("user.manage") },
  { group: "Hệ thống", href: "/phan-quyen/", label: "Phân quyền", short: "Quyền", icon: "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z", show: (s) => s.can("role.manage") },
  { group: "Hệ thống", href: "/cai-dat/", label: "Cài đặt", short: "Cài đặt", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4", show: (s) => s.can("settings.manage") },
  { group: "Hệ thống", href: "/nhat-ky/", label: "Nhật ký hệ thống", short: "Nhật ký", icon: "M12 8v4l3 2M12 3a9 9 0 110 18 9 9 0 010-18", show: (s) => s.can("audit.read") },
  { group: "Cá nhân", href: "/ho-so/", label: "Hồ sơ của tôi", short: "Hồ sơ", icon: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0", show: () => true },
];
