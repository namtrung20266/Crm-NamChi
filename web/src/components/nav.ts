import type { SessionContext } from "@/lib/session";

export interface NavItem {
  href: string;
  label: string;
  short: string;          // nhãn ngắn cho thanh dưới trên điện thoại
  ready: boolean;         // false = màn hình thuộc Bước 4, chưa mở
  show: (s: SessionContext) => boolean;
}

const has = (s: SessionContext, ...p: string[]) => p.some((x) => s.permissions.has(x));
const staff = (s: SessionContext) => s.userType === "staff";

export const NAV: NavItem[] = [
  { href: "/", label: "Tổng quan", short: "Tổng quan", ready: true, show: () => true },
  { href: "/khach-hang", label: "Khách hàng", short: "Khách", ready: true,
    show: (s) => staff(s) && has(s, "customer.read_all", "customer.read_assigned") },
  { href: "/cong-ty", label: "Công ty của tôi", short: "Công ty", ready: true, show: (s) => !staff(s) },
  { href: "/tai-khoan", label: "Tài khoản khách", short: "Tài khoản", ready: true,
    show: (s) => !staff(s) && has(s, "customer_user.invite") },
  { href: "/nhan-vien", label: "Nhân viên & vai trò", short: "Nhân viên", ready: true, show: (s) => has(s, "user.manage") },
  { href: "/phan-quyen", label: "Phân quyền", short: "Quyền", ready: true, show: (s) => has(s, "role.manage") },
  { href: "/cai-dat", label: "Cài đặt", short: "Cài đặt", ready: true, show: (s) => has(s, "settings.manage") },
  { href: "/nhat-ky", label: "Nhật ký hệ thống", short: "Nhật ký", ready: true, show: (s) => has(s, "audit.read") },
  { href: "/ho-so", label: "Hồ sơ của tôi", short: "Hồ sơ", ready: true, show: () => true },
];
