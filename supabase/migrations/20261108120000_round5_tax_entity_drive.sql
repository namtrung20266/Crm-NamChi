-- NAMCHI ERP – vòng 5 (08/11/2026)
-- 1) Thuế HĐ TQ: mốc tính thuế + thuế suất + người trả cho mọi loại HĐ; mặc định khách trả (lên phiếu thu khách);
--    Nam Trung trả thì KHÔNG thu khách (ghi sổ riêng để hoàn thuế TQ)
-- 2) CSKH chỉ thấy công ty con được phân công (không xem chéo); phân công CSKH/Kế toán theo công ty con
-- 3) Hồ sơ + cấu hình riêng từng công ty con (không đặt thì lấy của khách tổng), CSKH chỉ sửa trường được phép
-- 4) Kết nối Google Drive cấu hình ngay trên web (OAuth), khóa bí mật lưu trong schema app (không lộ qua API)

-- ---------- 1. Thuế HĐ TQ ----------
alter table public.orders alter column china_tax_payer set default 'khach';
update public.orders set china_tax_payer = 'khach' where china_tax_payer = 'cong_ty';
update public.lookup_values set meta = meta - 'has_base' - 'payer_choice' where category = 'china_invoice_kind';
comment on column public.orders.china_tax_payer is 'khach = khách chịu thuế (lên phiếu thu khách); cong_ty = Nam Trung chịu (không thu khách, theo dõi để hoàn thuế TQ)';

create or replace function app.tg_orders_china_tax()
returns trigger language plpgsql security definer set search_path = '' as $$
declare m jsonb;
begin
  if new.china_invoice_kind is null then return new; end if;
  select meta into m from public.lookup_values where category = 'china_invoice_kind' and code = new.china_invoice_kind;
  if m is null then raise exception 'Loại hóa đơn TQ không có trong danh mục' using errcode = '23514'; end if;
  new.china_invoice_type := coalesce(m ->> 'base', new.china_invoice_type);
  if tg_op = 'INSERT' and new.china_tax_rate is null then new.china_tax_rate := coalesce((m ->> 'rate')::numeric, 0);
  elsif tg_op = 'UPDATE' and (new.china_invoice_kind is distinct from old.china_invoice_kind and new.china_tax_rate is not distinct from old.china_tax_rate) then
    new.china_tax_rate := coalesce((m ->> 'rate')::numeric, 0);
  elsif new.china_tax_rate is null then new.china_tax_rate := coalesce((m ->> 'rate')::numeric, 0);
  end if;
  new.china_tax_cny := round(coalesce(new.china_tax_base_cny, new.goods_cny) * coalesce(new.china_tax_rate, 0) / 100, 2);
  return new;
end $$;

-- ---------- 2. Phân quyền xem theo công ty con ----------
alter table public.staff_customer_assignments add column if not exists role text not null default 'cs';
do $$ begin
  alter table public.staff_customer_assignments add constraint sca_role_check check (role in ('cs','accountant'));
exception when duplicate_object then null; end $$;

create or replace function app.staff_can_see_entity(p_customer_id uuid, p_entity_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_staff() and (
    app.has_perm('customer.read_all')
    or (app.has_perm('customer.read_assigned') and exists (
          select 1 from public.staff_customer_assignments a
          where a.staff_user_id = auth.uid() and a.customer_id = p_customer_id
            and (a.entity_id is null or p_entity_id is null or a.entity_id = p_entity_id)
            and a.valid_from <= current_date and (a.valid_to is null or a.valid_to >= current_date))));
$$;
grant execute on function app.staff_can_see_entity(uuid, uuid) to authenticated;

create or replace function app.can_see_entity(p_customer_id uuid, p_entity_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.staff_can_see_entity(p_customer_id, p_entity_id)
      or (p_customer_id is not null and p_customer_id = app.current_customer_id()
          and (app.current_entity_id() is null or p_entity_id is null or p_entity_id = app.current_entity_id()));
$$;

-- Chính sách RLS: bảng có entity_id dùng kiểm tra theo công ty con
do $$
declare p record; v_q text; v_c text; v_sql text;
begin
  for p in select pol.schemaname, pol.tablename, pol.policyname, pol.qual, pol.with_check from pg_policies pol
           where pol.schemaname = 'public'
             and (pol.qual like '%staff_can_see_customer(customer_id)%' or pol.with_check like '%staff_can_see_customer(customer_id)%')
             and exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = pol.tablename and c.column_name = 'entity_id')
  loop
    v_q := replace(p.qual, 'staff_can_see_customer(customer_id)', 'staff_can_see_entity(customer_id, entity_id)');
    v_c := replace(p.with_check, 'staff_can_see_customer(customer_id)', 'staff_can_see_entity(customer_id, entity_id)');
    v_sql := format('alter policy %I on public.%I', p.policyname, p.tablename);
    if v_q is not null then v_sql := v_sql || ' using (' || v_q || ')'; end if;
    if v_c is not null then v_sql := v_sql || ' with check (' || v_c || ')'; end if;
    execute v_sql;
  end loop;
end $$;

-- Hàm danh sách/báo cáo: thay kiểm tra theo khách bằng kiểm tra theo công ty con
do $$
declare f record; d text;
begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('admin_orders','admin_dashboard','desk_items','recent_messages','delivery_candidates','attachment_scope',
             'order_profit_detail','set_order_cost','set_order_note','set_order_status','pay_order','refund_order_to_wallet','reverse_wallet_entry','review_topup','build_statement')
  loop
    d := pg_get_functiondef(f.oid);
    if f.proname in ('admin_dashboard', 'recent_messages', 'delivery_candidates', 'desk_items') then
      d := replace(d, 'staff_can_see_customer(e.customer_id)', 'staff_can_see_entity(e.customer_id, e.id)');
    end if;
    d := regexp_replace(d, 'staff_can_see_customer\((o|m|l|t|i|e2)\.customer_id\)', 'staff_can_see_entity(\1.customer_id, \1.entity_id)', 'g');
    d := replace(d, 'staff_can_see_customer(v_c)', 'staff_can_see_entity(v_c, v_e)');
    d := replace(d, 'staff_can_see_customer(e.customer_id)', 'staff_can_see_entity(e.customer_id, e.entity_id)');
    if f.proname = 'build_statement' then d := replace(d, 'o.china_tax_payer = ''khach''', 'o.china_tax_payer = ''cong_ty'''); end if;
    if f.proname = 'admin_orders' then d := replace(d, '''internal_note'', o.internal_note,', '''internal_note'', o.internal_note, ''china_tax_payer'', o.china_tax_payer, ''china_tax_cny'', o.china_tax_cny,'); end if;
    execute d;
  end loop;
end $$;

-- ---------- 3. Phân công CSKH / Kế toán + hồ sơ, cấu hình riêng công ty con ----------
create or replace function public.set_assignment(p_customer_id uuid, p_entity_id uuid, p_role text, p_staff_user_id uuid, p_move_open_orders boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (app.has_perm('customer.write') or app.has_perm('user.manage')) then raise exception 'Không có quyền phân công' using errcode = '42501'; end if;
  if p_role not in ('cs','accountant') then raise exception 'Vai trò phân công không hợp lệ' using errcode = '22023'; end if;
  if p_entity_id is not null and not exists (select 1 from public.customer_entities where id = p_entity_id and customer_id = p_customer_id) then
    raise exception 'Công ty con không thuộc khách này' using errcode = '22023'; end if;
  if p_staff_user_id is not null and not exists (select 1 from public.profiles where user_id = p_staff_user_id and user_type = 'staff' and is_active) then
    raise exception 'Nhân viên không hợp lệ' using errcode = '22023'; end if;
  delete from public.staff_customer_assignments
   where customer_id = p_customer_id and entity_id is not distinct from p_entity_id and role = p_role and valid_from >= current_date;
  update public.staff_customer_assignments set valid_to = current_date - 1
   where customer_id = p_customer_id and entity_id is not distinct from p_entity_id and role = p_role and (valid_to is null or valid_to >= current_date);
  if p_staff_user_id is not null then
    insert into public.staff_customer_assignments (staff_user_id, customer_id, entity_id, role, valid_from) values (p_staff_user_id, p_customer_id, p_entity_id, p_role, current_date);
    if p_role = 'cs' and p_move_open_orders and p_entity_id is not null then
      perform set_config('app.sys', 'on', true);
      update public.orders set cs_owner_id = p_staff_user_id, row_version = row_version
       where entity_id = p_entity_id and deleted_at is null and status not in ('hoan_tat', 'huy');
      perform set_config('app.sys', '', true);
    end if;
  end if;
end $$;
create or replace function public.set_cs_assignment(p_customer_id uuid, p_entity_id uuid, p_staff_user_id uuid, p_move_open_orders boolean default false)
returns void language sql security definer set search_path = '' as $$
  select public.set_assignment(p_customer_id, p_entity_id, 'cs', p_staff_user_id, p_move_open_orders);
$$;

-- người nhận thông báo đơn: chỉ CSKH (không gửi kế toán được phân công)
create or replace function app.order_staff_users(p_order_id uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
with o as (select * from public.orders where id = p_order_id),
u as (
  select o.cs_owner_id as uid from o where o.cs_owner_id is not null
  union select a.staff_user_id from o join public.staff_customer_assignments a on a.customer_id = o.customer_id
    and a.role = 'cs' and (a.entity_id is null or a.entity_id = o.entity_id)
    and a.valid_from <= current_date and (a.valid_to is null or a.valid_to >= current_date)
)
select case when exists (select 1 from u) then (select array_agg(distinct uid) from u)
  else (select array_agg(distinct ur.user_id) from public.user_roles ur join public.roles r on r.id = ur.role_id where r.code in ('admin','manager')) end;
$$;

alter table public.customers add column if not exists settings jsonb not null default '{}';
alter table public.customer_entities add column if not exists settings jsonb not null default '{}';
alter table public.customer_entities add column if not exists contact_name text, add column if not exists contact_phone text, add column if not exists note text;
comment on column public.customer_entities.settings is 'Cấu hình riêng công ty con; khóa trống = lấy của khách tổng (customers.settings) rồi tới cấu hình hệ thống';

-- Cấu hình hiệu lực: công ty con > khách tổng
create or replace function public.entity_effective_settings(p_entity_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(c.settings, '{}') || coalesce(e.settings, '{}')
  from public.customer_entities e join public.customers c on c.id = e.customer_id
  where e.id = p_entity_id and app.can_see_entity(e.customer_id, e.id);
$$;

-- Đơn mới lấy mặc định theo cấu hình công ty con
create or replace function app.tg_orders_entity_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
declare s jsonb;
begin
  select coalesce(c.settings, '{}') || coalesce(e.settings, '{}') into s
    from public.customer_entities e join public.customers c on c.id = e.customer_id where e.id = new.entity_id;
  if s is null then return new; end if;
  if new.deposit_rate is null and (s ->> 'deposit_rate') is not null then new.deposit_rate := (s ->> 'deposit_rate')::numeric; end if;
  if (s ->> 'vat_rate') is not null and new.vat_rate = 8 then new.vat_rate := (s ->> 'vat_rate')::numeric; end if;
  if (s ->> 'china_invoice_kind') is not null and (new.china_invoice_kind is null) then new.china_invoice_kind := s ->> 'china_invoice_kind'; end if;
  if (s ->> 'china_tax_payer') is not null and new.china_tax_payer = 'khach' then new.china_tax_payer := s ->> 'china_tax_payer'; end if;
  if new.delivery_address is null then new.delivery_address := s ->> 'delivery_address'; end if;
  return new;
end $$;
create trigger orders_ydefaults before insert on public.orders for each row execute function app.tg_orders_entity_defaults();

-- Sửa hồ sơ khách tổng/công ty con: quyền customer.write sửa tất cả; CSKH được phân công chỉ sửa liên hệ, địa chỉ giao, ghi chú
create or replace function public.update_customer_profile(p_kind text, p_id uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_full boolean := app.has_perm('customer.write'); v_c uuid; v_e uuid; k text;
  cs_cols text[] := array['invoice_email','contact_name','contact_phone','note','address'];
  cs_settings text[] := array['delivery_address','receiver_name','receiver_phone','delivery_note'];
  ent_cols text[] := array['legal_name','tax_code','invoice_address','invoice_email','contact_name','contact_phone','note','status','is_retail_buyer'];
  cus_cols text[] := array['name','tax_code','address','payment_term_days','credit_limit_vnd','status','note'];
begin
  if p_kind = 'entity' then select customer_id, id into v_c, v_e from public.customer_entities where id = p_id;
  elsif p_kind = 'customer' then v_c := p_id; v_e := null;
  else raise exception 'Loại hồ sơ không hợp lệ' using errcode = '22023'; end if;
  if v_c is null or not app.staff_can_see_entity(v_c, v_e) then raise exception 'Không có quyền với khách này' using errcode = '42501'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k = 'settings' then
      if not v_full and exists (select 1 from jsonb_object_keys(p_patch -> 'settings') x where x <> all (cs_settings)) then
        raise exception 'CSKH chỉ được sửa địa chỉ/người nhận hàng. Cấu hình giá, cọc, hóa đơn do Quản lý/Admin sửa.' using errcode = '42501'; end if;
    elsif not v_full and k <> all (cs_cols) then
      raise exception 'CSKH không được sửa trường "%"', k using errcode = '42501';
    elsif p_kind = 'entity' and k <> all (ent_cols) then raise exception 'Trường "%" không sửa được', k using errcode = '22023';
    elsif p_kind = 'customer' and k <> all (cus_cols) then raise exception 'Trường "%" không sửa được', k using errcode = '22023';
    end if;
  end loop;
  if p_kind = 'entity' then
    update public.customer_entities set
      legal_name = coalesce(p_patch ->> 'legal_name', legal_name), tax_code = case when p_patch ? 'tax_code' then nullif(p_patch ->> 'tax_code', '') else tax_code end,
      invoice_address = case when p_patch ? 'invoice_address' then nullif(p_patch ->> 'invoice_address', '') else invoice_address end,
      invoice_email = case when p_patch ? 'invoice_email' then nullif(p_patch ->> 'invoice_email', '') else invoice_email end,
      contact_name = case when p_patch ? 'contact_name' then nullif(p_patch ->> 'contact_name', '') else contact_name end,
      contact_phone = case when p_patch ? 'contact_phone' then nullif(p_patch ->> 'contact_phone', '') else contact_phone end,
      note = case when p_patch ? 'note' then nullif(p_patch ->> 'note', '') else note end,
      status = coalesce(p_patch ->> 'status', status), is_retail_buyer = coalesce((p_patch ->> 'is_retail_buyer')::boolean, is_retail_buyer),
      settings = case when p_patch ? 'settings' then jsonb_strip_nulls(settings || (p_patch -> 'settings')) else settings end,
      row_version = row_version
    where id = p_id;
  else
    update public.customers set
      name = coalesce(p_patch ->> 'name', name), tax_code = case when p_patch ? 'tax_code' then nullif(p_patch ->> 'tax_code', '') else tax_code end,
      address = case when p_patch ? 'address' then nullif(p_patch ->> 'address', '') else address end,
      payment_term_days = coalesce((p_patch ->> 'payment_term_days')::int, payment_term_days), credit_limit_vnd = coalesce((p_patch ->> 'credit_limit_vnd')::bigint, credit_limit_vnd),
      status = coalesce(p_patch ->> 'status', status), note = case when p_patch ? 'note' then nullif(p_patch ->> 'note', '') else note end,
      settings = case when p_patch ? 'settings' then jsonb_strip_nulls(settings || (p_patch -> 'settings')) else settings end,
      row_version = row_version
    where id = p_id;
  end if;
end $$;

-- ---------- 4. Google Drive: cấu hình trên web ----------
create table if not exists app.integration_secrets (key text primary key, value text not null, updated_at timestamptz not null default now(), updated_by uuid);
revoke all on app.integration_secrets from public, anon, authenticated;

create or replace function public.drive_config_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when app.has_perm('settings.manage') then jsonb_build_object(
    'client_id', (select value from app.integration_secrets where key = 'GOOGLE_CLIENT_ID'),
    'has_secret', exists (select 1 from app.integration_secrets where key = 'GOOGLE_CLIENT_SECRET'),
    'connected', exists (select 1 from app.integration_secrets where key = 'GOOGLE_REFRESH_TOKEN'),
    'account', (select value from app.integration_secrets where key = 'GOOGLE_ACCOUNT'),
    'folder_id', (select value from app.integration_secrets where key = 'DRIVE_ROOT_FOLDER_ID'),
    'connected_at', (select updated_at from app.integration_secrets where key = 'GOOGLE_REFRESH_TOKEN')) end;
$$;
create or replace function public.set_drive_client(p_client_id text, p_client_secret text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_perm('settings.manage') then raise exception 'Không có quyền' using errcode = '42501'; end if;
  if coalesce(p_client_id, '') !~ '\.apps\.googleusercontent\.com$' then raise exception 'Client ID không đúng định dạng (…apps.googleusercontent.com)' using errcode = '22023'; end if;
  insert into app.integration_secrets (key, value, updated_by) values ('GOOGLE_CLIENT_ID', trim(p_client_id), auth.uid())
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  if nullif(trim(p_client_secret), '') is not null then
    insert into app.integration_secrets (key, value, updated_by) values ('GOOGLE_CLIENT_SECRET', trim(p_client_secret), auth.uid())
      on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  end if;
end $$;
-- Bắt đầu kết nối: tạo mã state chống giả mạo, hiệu lực 10 phút
create or replace function public.drive_oauth_begin()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_state text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not app.has_perm('settings.manage') then raise exception 'Không có quyền' using errcode = '42501'; end if;
  if not exists (select 1 from app.integration_secrets where key = 'GOOGLE_CLIENT_ID') then raise exception 'Nhập Client ID/Secret trước' using errcode = '22023'; end if;
  insert into app.integration_secrets (key, value, updated_by) values ('OAUTH_STATE', v_state || '|' || extract(epoch from now() + interval '10 minutes')::bigint, auth.uid())
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  return jsonb_build_object('client_id', (select value from app.integration_secrets where key = 'GOOGLE_CLIENT_ID'), 'state', v_state);
end $$;
-- Chỉ Edge Function (service role) gọi
create or replace function public.drive_secrets()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(key, value), '{}') from app.integration_secrets where key in ('GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN','DRIVE_ROOT_FOLDER_ID','OAUTH_STATE');
$$;
create or replace function public.drive_save_oauth(p_state text, p_refresh_token text, p_account text, p_folder_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  select value into v from app.integration_secrets where key = 'OAUTH_STATE';
  if v is null or split_part(v, '|', 1) <> p_state or split_part(v, '|', 2)::bigint < extract(epoch from now()) then return false; end if;
  delete from app.integration_secrets where key = 'OAUTH_STATE';
  if nullif(p_refresh_token, '') is not null then
    insert into app.integration_secrets (key, value) values ('GOOGLE_REFRESH_TOKEN', p_refresh_token) on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  insert into app.integration_secrets (key, value) values ('GOOGLE_ACCOUNT', coalesce(p_account, '')) on conflict (key) do update set value = excluded.value, updated_at = now();
  if nullif(p_folder_id, '') is not null then
    insert into app.integration_secrets (key, value) values ('DRIVE_ROOT_FOLDER_ID', p_folder_id) on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  return true;
end $$;
create or replace function public.drive_disconnect()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_perm('settings.manage') then raise exception 'Không có quyền' using errcode = '42501'; end if;
  delete from app.integration_secrets where key in ('GOOGLE_REFRESH_TOKEN','GOOGLE_ACCOUNT');
end $$;

revoke all on function public.drive_secrets(), public.drive_save_oauth(text, text, text, text) from public, anon, authenticated;
grant execute on function public.drive_secrets(), public.drive_save_oauth(text, text, text, text) to service_role;
revoke all on function public.drive_config_status(), public.set_drive_client(text, text), public.drive_oauth_begin(), public.drive_disconnect(),
  public.set_assignment(uuid, uuid, text, uuid, boolean), public.update_customer_profile(text, uuid, jsonb), public.entity_effective_settings(uuid) from public, anon;
grant execute on function public.drive_config_status(), public.set_drive_client(text, text), public.drive_oauth_begin(), public.drive_disconnect(),
  public.set_assignment(uuid, uuid, text, uuid, boolean), public.update_customer_profile(text, uuid, jsonb), public.entity_effective_settings(uuid) to authenticated;
