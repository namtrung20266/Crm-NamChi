-- =====================================================================
-- NAMCHI ERP – Giai đoạn 1 – 0400: Phân quyền và RLS
-- Tài liệu: mục 4.2, 8.2, 8.3
--
-- 3 mức phạm vi:
--   staff_all      : nhân viên có quyền customer.read_all
--   staff_assigned : CSKH (customer.read_assigned) – chỉ khách được phân công
--   customer       : tài khoản khách – khách của mình; nếu gắn công ty con
--                    thì chỉ công ty con đó (không xem chéo)
-- Hàm helper là SECURITY DEFINER để policy không gọi đệ quy qua RLS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Hàm helper
-- ---------------------------------------------------------------------
create or replace function app.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_active);
$$;

create or replace function app.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                 where p.user_id = auth.uid() and p.is_active and p.user_type = 'staff');
$$;

create or replace function app.has_perm(p_code text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.profiles pr
    join public.user_roles ur        on ur.user_id = pr.user_id
    join public.role_permissions rp  on rp.role_id = ur.role_id
    join public.permissions pe       on pe.id = rp.permission_id
    where pr.user_id = auth.uid() and pr.is_active and pe.code = p_code
  );
$$;

-- Khách hàng của tài khoản khách hiện tại (null nếu không phải khách)
create or replace function app.current_customer_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select cu.customer_id
  from public.customer_users cu
  join public.profiles p on p.user_id = cu.user_id
  where cu.user_id = auth.uid() and p.is_active;
$$;

-- Công ty con của tài khoản khách hiện tại (null = thấy mọi công ty con)
create or replace function app.current_entity_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select cu.entity_id from public.customer_users cu where cu.user_id = auth.uid();
$$;

-- Nhân viên có được thấy khách này không
create or replace function app.staff_can_see_customer(p_customer_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_staff() and (
    app.has_perm('customer.read_all')
    or (app.has_perm('customer.read_assigned') and exists (
          select 1 from public.staff_customer_assignments a
          where a.staff_user_id = auth.uid()
            and a.customer_id = p_customer_id
            and a.valid_from <= current_date
            and (a.valid_to is null or a.valid_to >= current_date)))
  );
$$;

-- Ai đó (nhân viên hoặc khách) có được thấy khách này ở cấp khách hàng không
create or replace function app.can_see_customer(p_customer_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.staff_can_see_customer(p_customer_id)
      or (p_customer_id is not null and p_customer_id = app.current_customer_id());
$$;

-- Có được thấy dữ liệu gắn với (khách, công ty con) không.
-- p_entity_id null = dữ liệu cấp khách hàng chung (mọi tài khoản của khách đều thấy).
create or replace function app.can_see_entity(p_customer_id uuid, p_entity_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.staff_can_see_customer(p_customer_id)
      or (p_customer_id is not null
          and p_customer_id = app.current_customer_id()
          and (app.current_entity_id() is null
               or p_entity_id is null
               or p_entity_id = app.current_entity_id()));
$$;

revoke all on all functions in schema app from public;
grant execute on function
  app.is_active_user(), app.is_staff(), app.has_perm(text),
  app.current_customer_id(), app.current_entity_id(),
  app.staff_can_see_customer(uuid), app.can_see_customer(uuid), app.can_see_entity(uuid, uuid)
to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Quyền mức bảng: anon không có gì; authenticated chỉ có cái cần
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

grant select on public.profiles, public.roles, public.permissions, public.role_permissions,
               public.user_roles, public.customers, public.customer_entities,
               public.customer_contacts, public.customer_users, public.staff_customer_assignments,
               public.trade_parties, public.app_settings, public.attachments
to authenticated;

-- Người dùng tự sửa tên, số điện thoại của mình; các cột khác qua RPC/server
grant update (full_name, phone, row_version) on public.profiles to authenticated;

grant insert, update on public.customers, public.customer_entities, public.customer_contacts,
                        public.trade_parties, public.staff_customer_assignments
to authenticated;
grant insert, delete on public.user_roles, public.role_permissions to authenticated;
grant insert, update on public.attachments to authenticated;
-- app_settings: chỉ ghi qua public.set_setting()

-- ---------------------------------------------------------------------
-- 3. Bật RLS cho mọi bảng
-- ---------------------------------------------------------------------
alter table public.profiles                   enable row level security;
alter table public.roles                      enable row level security;
alter table public.permissions                enable row level security;
alter table public.role_permissions           enable row level security;
alter table public.user_roles                 enable row level security;
alter table public.customers                  enable row level security;
alter table public.customer_entities          enable row level security;
alter table public.customer_contacts          enable row level security;
alter table public.customer_users             enable row level security;
alter table public.staff_customer_assignments enable row level security;
alter table public.trade_parties              enable row level security;
alter table public.app_settings               enable row level security;
alter table public.attachments                enable row level security;

-- ---------------------------------------------------------------------
-- 4. Policies
-- ---------------------------------------------------------------------

-- profiles: mình; nhân viên thấy nhân viên; nhân viên thấy khách mình được phân;
--           quản trị khách (cust_admin) thấy tài khoản cùng khách
create policy profiles_select on public.profiles for select to authenticated using (
  user_id = auth.uid()
  or (app.is_staff() and (
        user_type = 'staff'
        or exists (select 1 from public.customer_users cu
                   where cu.user_id = profiles.user_id and app.staff_can_see_customer(cu.customer_id))))
  or (app.has_perm('customer_user.invite') and exists (
        select 1 from public.customer_users cu
        where cu.user_id = profiles.user_id and cu.customer_id = app.current_customer_id()))
);
create policy profiles_update_self on public.profiles for update to authenticated
  using (user_id = auth.uid() and is_active) with check (user_id = auth.uid());

-- danh mục vai trò/quyền: ai đăng nhập cũng đọc được (để giao diện ẩn hiện menu)
create policy roles_select       on public.roles       for select to authenticated using (app.is_active_user());
create policy permissions_select on public.permissions for select to authenticated using (app.is_active_user());

create policy role_permissions_select on public.role_permissions for select to authenticated
  using (app.is_active_user());
create policy role_permissions_insert on public.role_permissions for insert to authenticated
  with check (app.has_perm('role.manage'));
create policy role_permissions_delete on public.role_permissions for delete to authenticated
  using (app.has_perm('role.manage'));

create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or app.has_perm('user.manage'));
create policy user_roles_insert on public.user_roles for insert to authenticated
  with check (app.has_perm('user.manage'));
create policy user_roles_delete on public.user_roles for delete to authenticated
  using (app.has_perm('user.manage'));

-- customers
create policy customers_select on public.customers for select to authenticated
  using (app.can_see_customer(id) and (deleted_at is null or app.has_perm('customer.write')));
create policy customers_insert on public.customers for insert to authenticated
  with check (app.has_perm('customer.write'));
create policy customers_update on public.customers for update to authenticated
  using (app.has_perm('customer.write')) with check (app.has_perm('customer.write'));

-- customer_entities: tài khoản công ty con chỉ thấy công ty con của mình
create policy entities_select on public.customer_entities for select to authenticated
  using (app.can_see_entity(customer_id, id) and (deleted_at is null or app.has_perm('customer.write')));
create policy entities_insert on public.customer_entities for insert to authenticated
  with check (app.has_perm('customer.write'));
create policy entities_update on public.customer_entities for update to authenticated
  using (app.has_perm('customer.write')) with check (app.has_perm('customer.write'));

-- customer_contacts
create policy contacts_select on public.customer_contacts for select to authenticated
  using (app.can_see_entity(customer_id, entity_id) and deleted_at is null);
create policy contacts_insert on public.customer_contacts for insert to authenticated
  with check (app.has_perm('customer.write'));
create policy contacts_update on public.customer_contacts for update to authenticated
  using (app.has_perm('customer.write')) with check (app.has_perm('customer.write'));

-- customer_users: chỉ đọc; tạo/sửa qua server (cần Admin API của Supabase Auth)
create policy customer_users_select on public.customer_users for select to authenticated using (
  user_id = auth.uid()
  or app.staff_can_see_customer(customer_id)
  or (app.has_perm('customer_user.invite') and customer_id = app.current_customer_id()
      and (app.current_entity_id() is null or entity_id = app.current_entity_id()))
);

-- staff_customer_assignments
create policy sca_select on public.staff_customer_assignments for select to authenticated
  using (staff_user_id = auth.uid() or app.has_perm('customer.read_all'));
create policy sca_insert on public.staff_customer_assignments for insert to authenticated
  with check (app.has_perm('user.manage'));
create policy sca_update on public.staff_customer_assignments for update to authenticated
  using (app.has_perm('user.manage')) with check (app.has_perm('user.manage'));

-- trade_parties: chỉ nhân viên
create policy trade_parties_select on public.trade_parties for select to authenticated
  using (app.is_staff() and deleted_at is null);
create policy trade_parties_insert on public.trade_parties for insert to authenticated
  with check (app.has_perm('settings.manage'));
create policy trade_parties_update on public.trade_parties for update to authenticated
  using (app.has_perm('settings.manage')) with check (app.has_perm('settings.manage'));

-- app_settings: nhân viên đọc
create policy app_settings_select on public.app_settings for select to authenticated
  using (app.is_staff());

-- attachments
create policy attachments_select on public.attachments for select to authenticated using (
  deleted_at is null and (
    (customer_id is null and app.is_staff())
    or (customer_id is not null and app.staff_can_see_customer(customer_id))
    or (visibility = 'customer' and app.can_see_entity(customer_id, entity_id) and not app.is_staff())
  )
);
create policy attachments_insert on public.attachments for insert to authenticated with check (
  app.has_perm('attachment.upload') and (
    (app.is_staff() and (customer_id is null or app.staff_can_see_customer(customer_id)))
    or (not app.is_staff() and visibility = 'customer'
        and customer_id = app.current_customer_id()
        and (app.current_entity_id() is null or entity_id = app.current_entity_id()))
  )
);
create policy attachments_update on public.attachments for update to authenticated
  using (app.is_staff() and app.has_perm('attachment.upload')
         and (customer_id is null or app.staff_can_see_customer(customer_id)))
  with check (app.is_staff() and (customer_id is null or app.staff_can_see_customer(customer_id)));

-- ---------------------------------------------------------------------
-- 5. RPC (gọi qua supabase.rpc)
-- ---------------------------------------------------------------------

-- Đặt cài đặt mới từ một thời điểm: đóng bản cũ, mở bản mới
create or replace function public.set_setting(p_key text, p_value jsonb,
                                              p_valid_from timestamptz default now(),
                                              p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open public.app_settings;
  v_id   uuid;
begin
  if not app.has_perm('settings.manage') then
    raise exception 'Không có quyền settings.manage' using errcode = '42501';
  end if;

  select * into v_open from public.app_settings where key = p_key and valid_to is null for update;
  if found then
    if p_valid_from <= v_open.valid_from then
      raise exception 'Ngày hiệu lực mới phải sau ngày hiệu lực của bản đang dùng (%)', v_open.valid_from
        using errcode = '22023';
    end if;
    update public.app_settings set valid_to = p_valid_from where id = v_open.id;
  end if;

  insert into public.app_settings (key, value_json, valid_from, note)
  values (p_key, p_value, p_valid_from, p_note)
  returning id into v_id;
  return v_id;
end;
$$;

-- Giá trị cài đặt tại một thời điểm (mặc định: bây giờ)
create or replace function public.get_setting(p_key text, p_at timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select s.value_json
  from public.app_settings s
  where app.is_staff()
    and s.key = p_key
    and s.valid_from <= p_at
    and (s.valid_to is null or s.valid_to > p_at)
  order by s.valid_from desc
  limit 1;
$$;

-- Quyền của người đang đăng nhập (giao diện dùng để ẩn/hiện chức năng)
create or replace function public.my_permissions()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct pe.code
  from public.profiles pr
  join public.user_roles ur       on ur.user_id = pr.user_id
  join public.role_permissions rp on rp.role_id = ur.role_id
  join public.permissions pe      on pe.id = rp.permission_id
  where pr.user_id = auth.uid() and pr.is_active
  order by 1;
$$;

-- Khóa / mở khóa tài khoản
create or replace function public.set_user_active(p_user_id uuid, p_active boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_perm('user.manage') then
    raise exception 'Không có quyền user.manage' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() and not p_active then
    raise exception 'Không tự khóa tài khoản của chính mình' using errcode = '22023';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Cần nhập lý do' using errcode = '22023';
  end if;
  perform set_config('app.change_reason', p_reason, true);
  update public.profiles
     set is_active = p_active,
         row_version = row_version
   where user_id = p_user_id;
end;
$$;

revoke all on function public.set_setting(text, jsonb, timestamptz, text) from public, anon;
revoke all on function public.get_setting(text, timestamptz)              from public, anon;
revoke all on function public.my_permissions()                             from public, anon;
revoke all on function public.set_user_active(uuid, boolean, text)         from public, anon;
grant execute on function public.set_setting(text, jsonb, timestamptz, text) to authenticated;
grant execute on function public.get_setting(text, timestamptz)              to authenticated;
grant execute on function public.my_permissions()                             to authenticated;
grant execute on function public.set_user_active(uuid, boolean, text)         to authenticated;

-- ---------------------------------------------------------------------
-- 6. Đọc nhật ký: view chỉ trả dòng khi có quyền audit.read
-- ---------------------------------------------------------------------
create or replace view public.audit_log_view
with (security_barrier = true)
as
select l.id, l.table_name, l.row_id, l.action, l.old_data, l.new_data,
       l.changed_fields, l.actor_id, l.ip, l.reason, l.at
from audit.logs l
where app.has_perm('audit.read');

revoke all on public.audit_log_view from public, anon;
grant select on public.audit_log_view to authenticated;
