// Chỉ đọc biến môi trường công khai. Khóa service role KHÔNG bao giờ import ở đây.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
