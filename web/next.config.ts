import type { NextConfig } from "next";

// Xuất trang tĩnh để chạy trên GitHub Pages. Bảo mật dữ liệu do RLS của Supabase đảm nhận.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
};

export default nextConfig;
