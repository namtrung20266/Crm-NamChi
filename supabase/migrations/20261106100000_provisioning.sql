-- =====================================================================
-- NAMCHI ERP – 0700: Cấp tài khoản (mời qua email) + hàm phục vụ màn hình
-- Luồng mời: Edge Function invite-user (giữ khóa service role) tạo user
-- trong Supabase Auth, sau đó gọi public.provision_user() BẰNG PHIÊN CỦA
-- NGƯỜI MỜI → mọi kiểm tra quyền và nhật ký đều mang tên người mời.
-- =====================================================================

alter table public.profiles add column if not exists email text;
create unique index if not exists profiles_email_uidx on public.profiles (lower(email)) where email is not null;

-- ---------------------------------------------------------------------
-- Kiểm tra người mời có được cấp tài khoản này không (không ghi gì)
-- ---------------------------------------------------------------------
create or replace function public.can_provision(p_user_type text, p_role_code text,
                                                p_customer_id uuid, p_entity_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.roles;
begin
  select * into v_role from public.roles where code = p_role_code;
  if not found or v_role.user_type <> p_user_type then
    return false;
  end if;

  if p_user_type = 'staff' then
    return app.has_perm('user.manage') and p_customer_id is null and p_entity_id is null;
  end if;

  -- tài khoản khách: phải có khách hàng; công ty con phải thuộc khách đó
  if p_customer_id is null then return false; end if;
  if p_entity_id is not null and not exists (
       select 1 from public.customer_entities e where e.id = p_entity_id and e.customer_id = p_customer_id) then
    return false;
  end if;

  if app.is_staff() then
    return coalesce(app.has_perm('customer_user.invite') and app.staff_can_see_customer(p_customer_id), false);
  end if;

  -- quản trị phía khách: chỉ trong khách của mình; nếu bị giới hạn công ty con thì chỉ công ty đó
  return coalesce(
           app.has_perm('customer_user.invite')
           and p_customer_id = app.current_customer_id()
           and (app.current_entity_id() is null or p_entity_id is not distinct from app.current_entity_id()),
         false);
end;
$$;

-- ---------------------------------------------------------------------
-- Ghi hồ sơ + vai trò + gắn khách cho user vừa tạo (1 transaction)
-- ---------------------------------------------------------------------
create or replace function public.provision_user(p_user_id uuid, p_email text, p_full_name text,
                                                 p_user_type text, p_role_code text,
                                                 p_customer_id uuid default null,
                                                 p_entity_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.can_provision(p_user_type, p_role_code, p_customer_id, p_entity_id), false) then
    raise exception 'Không có quyền cấp tài khoản này' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Tài khoản đăng nhập chưa được tạo' using errcode = '22023';
  end if;

  perform set_config('app.change_reason', 'Cấp tài khoản mới', true);

  insert into public.profiles (user_id, full_name, user_type, email)
  values (p_user_id, trim(p_full_name), p_user_type, lower(trim(p_email)));

  insert into public.user_roles (user_id, role_id)
  select p_user_id, r.id from public.roles r where r.code = p_role_code;

  if p_user_type = 'customer' then
    insert into public.customer_users (user_id, customer_id, entity_id)
    values (p_user_id, p_customer_id, p_entity_id);
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Đổi vai trò nhân viên (Admin)
-- ---------------------------------------------------------------------
create or replace function public.set_staff_role(p_user_id uuid, p_role_code text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_perm('user.manage') then
    raise exception 'Không có quyền user.manage' using errcode = '42501';
  end if;
  if not exists (select 1 from public.roles where code = p_role_code and user_type = 'staff') then
    raise exception 'Vai trò không hợp lệ' using errcode = '22023';
  end if;
  if p_user_id = auth.uid() and p_role_code <> 'admin' then
    raise exception 'Không tự gỡ quyền Admin của chính mình' using errcode = '22023';
  end if;
  perform set_config('app.change_reason', coalesce(nullif(trim(p_reason), ''), 'Đổi vai trò'), true);
  delete from public.user_roles where user_id = p_user_id;
  insert into public.user_roles (user_id, role_id)
  select p_user_id, id from public.roles where code = p_role_code;
end;
$$;

-- ---------------------------------------------------------------------
-- Danh sách tài khoản (nhân viên hoặc khách) mà người xem được phép thấy
-- ---------------------------------------------------------------------
create or replace view public.user_directory
with (security_invoker = true)
as
select p.user_id, p.full_name, p.email, p.phone, p.user_type, p.is_active, p.last_login_at, p.created_at,
       cu.customer_id, cu.entity_id,
       (select string_agg(r.name, ', ' order by r.name)
          from public.user_roles ur join public.roles r on r.id = ur.role_id
         where ur.user_id = p.user_id) as role_names,
       (select min(r.code)
          from public.user_roles ur join public.roles r on r.id = ur.role_id
         where ur.user_id = p.user_id) as role_code
from public.profiles p
left join public.customer_users cu on cu.user_id = p.user_id;

revoke all on public.user_directory from public, anon;
grant select on public.user_directory to authenticated;

-- Người dùng đọc được vai trò của người khác mà mình thấy hồ sơ (để hiển thị danh sách)
drop policy user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = (select auth.uid())
         or app.has_perm('user.manage')
         or exists (select 1 from public.profiles p where p.user_id = user_roles.user_id));

-- Ghi lần đăng nhập gần nhất
create or replace function public.touch_last_login()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set last_login_at = now(), row_version = row_version
  where user_id = auth.uid();
$$;

revoke all on function public.can_provision(text, text, uuid, uuid)                       from public, anon;
revoke all on function public.provision_user(uuid, text, text, text, text, uuid, uuid)   from public, anon;
revoke all on function public.set_staff_role(uuid, text, text)                            from public, anon;
revoke all on function public.touch_last_login()                                          from public, anon;
grant execute on function public.can_provision(text, text, uuid, uuid)                     to authenticated;
grant execute on function public.provision_user(uuid, text, text, text, text, uuid, uuid) to authenticated;
grant execute on function public.set_staff_role(uuid, text, text)                          to authenticated;
grant execute on function public.touch_last_login()                                        to authenticated;

-- Nhật ký bỏ qua thay đổi chỉ gồm last_login_at (tránh ghi rác mỗi lần đăng nhập)
create or replace function audit.tg_log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old     jsonb;
  v_new     jsonb;
  v_changed text[];
  v_row_id  text;
  v_headers jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;

  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into v_changed
    from jsonb_object_keys(v_new) k
    where v_new -> k is distinct from v_old -> k
      and k not in ('updated_at', 'updated_by', 'row_version', 'last_login_at');
    if v_changed is null then
      return new;
    end if;
  end if;

  v_row_id := coalesce(v_new ->> 'id', v_old ->> 'id',
                       v_new ->> 'user_id', v_old ->> 'user_id', '?');
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;

  insert into audit.logs (table_name, row_id, action, old_data, new_data, changed_fields, actor_id, ip, reason)
  values (tg_table_schema || '.' || tg_table_name, v_row_id, tg_op, v_old, v_new, v_changed,
          auth.uid(), v_headers ->> 'x-forwarded-for',
          nullif(current_setting('app.change_reason', true), ''));
  return coalesce(new, old);
end;
$$;
