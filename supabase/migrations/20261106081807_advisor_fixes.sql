-- =====================================================================
-- NAMCHI ERP – 0600: Sửa theo Supabase Security Advisor (06/11/2026)
-- 1. audit_log_view là SECURITY DEFINER (lỗi ERROR) → chuyển sang
--    security_invoker + RLS trên audit.logs
-- 2. Hàm rls_auto_enable() của Supabase (bật khi tạo project) đang cho
--    anon/authenticated gọi qua API → thu hồi quyền gọi
-- 3. Policy dùng (select auth.uid()) để Postgres chỉ tính 1 lần/truy vấn
-- =====================================================================

-- 1. Nhật ký: quyền đọc kiểm soát bằng RLS trên chính bảng
grant usage on schema audit to authenticated;
grant select on audit.logs to authenticated;
alter table audit.logs enable row level security;
create policy logs_select on audit.logs for select to authenticated
  using (app.has_perm('audit.read'));

drop view if exists public.audit_log_view;
create view public.audit_log_view
with (security_invoker = true, security_barrier = true)
as
select l.id, l.table_name, l.row_id, l.action, l.old_data, l.new_data,
       l.changed_fields, l.actor_id, l.ip, l.reason, l.at
from audit.logs l;
revoke all on public.audit_log_view from public, anon;
grant select on public.audit_log_view to authenticated;

-- 2. Hàm tự bật RLS của Supabase: chỉ event trigger dùng, không mở qua API
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

-- 3. Viết lại policy có auth.uid() trực tiếp
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (
  user_id = (select auth.uid())
  or (app.is_staff() and (
        user_type = 'staff'
        or exists (select 1 from public.customer_users cu
                   where cu.user_id = profiles.user_id and app.staff_can_see_customer(cu.customer_id))))
  or (app.has_perm('customer_user.invite') and exists (
        select 1 from public.customer_users cu
        where cu.user_id = profiles.user_id and cu.customer_id = app.current_customer_id()))
);
drop policy profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (user_id = (select auth.uid()) and is_active) with check (user_id = (select auth.uid()));

drop policy user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or app.has_perm('user.manage'));

drop policy customer_users_select on public.customer_users;
create policy customer_users_select on public.customer_users for select to authenticated using (
  user_id = (select auth.uid())
  or app.staff_can_see_customer(customer_id)
  or (app.has_perm('customer_user.invite') and customer_id = app.current_customer_id()
      and (app.current_entity_id() is null or entity_id = app.current_entity_id()))
);

drop policy sca_select on public.staff_customer_assignments;
create policy sca_select on public.staff_customer_assignments for select to authenticated
  using (staff_user_id = (select auth.uid()) or app.has_perm('customer.read_all'));

-- Ghi chú: 4 RPC set_setting, get_setting, my_permissions, set_user_active
-- là SECURITY DEFINER có chủ đích; mỗi hàm tự kiểm tra quyền ở dòng đầu.
