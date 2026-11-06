-- Mã khởi tạo Admin dùng 1 lần; chỉ service role đọc được (RLS bật, không có policy). Bảng hiện rỗng.
create table if not exists public.bootstrap_secrets (hash text primary key, created_at timestamptz not null default now());
alter table public.bootstrap_secrets enable row level security;
revoke all on public.bootstrap_secrets from anon, authenticated;
