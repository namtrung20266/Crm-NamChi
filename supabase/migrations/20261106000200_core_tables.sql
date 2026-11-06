-- =====================================================================
-- NAMCHI ERP – Giai đoạn 1 – 0200: Bảng lõi
-- Tài liệu: mục 8.1
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Danh tính và phân quyền
-- ---------------------------------------------------------------------
create table public.profiles (
  user_id       uuid primary key references auth.users(id) on delete restrict,
  full_name     text not null check (length(trim(full_name)) > 0),
  phone         text,
  user_type     text not null check (user_type in ('staff', 'customer')),
  is_active     boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  row_version   integer not null default 1
);
comment on table public.profiles is 'Hồ sơ người dùng, 1-1 với auth.users. Khóa tài khoản = is_active false.';

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[a-z_]+$'),
  name        text not null,
  user_type   text not null check (user_type in ('staff', 'customer')),
  description text
);

create table public.permissions (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[a-z_]+(\.[a-z_]+)+$'),
  module      text not null,
  description text not null
);

create table public.role_permissions (
  role_id       uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.user_roles (
  user_id     uuid not null references public.profiles(user_id),
  role_id     uuid not null references public.roles(id),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  primary key (user_id, role_id)
);
create index user_roles_role_idx on public.user_roles(role_id);

-- Vai trò khách chỉ gán cho tài khoản khách, vai trò nội bộ chỉ gán cho nhân viên
create or replace function app.tg_user_role_type_match()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_user_type text;
  v_role_type text;
begin
  select user_type into v_user_type from public.profiles where user_id = new.user_id;
  select user_type into v_role_type from public.roles    where id      = new.role_id;
  if v_user_type is distinct from v_role_type then
    raise exception 'Vai trò % chỉ gán được cho tài khoản loại %', new.role_id, v_role_type
      using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger user_roles_type_match
  before insert or update on public.user_roles
  for each row execute function app.tg_user_role_type_match();

-- ---------------------------------------------------------------------
-- 2. Khách hàng, công ty con, liên hệ
-- ---------------------------------------------------------------------
create table public.customers (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique check (code ~ '^[A-Z0-9_-]{2,20}$'),
  name              text not null,
  tax_code          text unique,
  address           text,
  payment_term_days integer not null default 30 check (payment_term_days between 0 and 365),
  credit_limit_vnd  bigint not null default 0 check (credit_limit_vnd >= 0),
  status            text not null default 'active' check (status in ('active', 'paused', 'closed')),
  cs_owner_id       uuid references public.profiles(user_id),
  note              text,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  deleted_at        timestamptz,
  row_version       integer not null default 1
);
comment on table public.customers is 'Khách hàng (vd Lanchi). Người trả tiền, chịu công nợ.';

create table public.customer_entities (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references public.customers(id),
  code             text not null check (code ~ '^[A-Z0-9_-]{1,20}$'),
  legal_name       text not null,
  tax_code         text,
  invoice_address  text,
  invoice_email    text,
  is_retail_buyer  boolean not null default false,
  status           text not null default 'active' check (status in ('active', 'paused', 'closed')),
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  deleted_at       timestamptz,
  row_version      integer not null default 1,
  unique (customer_id, code),
  unique (customer_id, id)          -- cho khóa ngoại kép, chống gán nhầm công ty con của khách khác
);
comment on table public.customer_entities is 'Công ty con nhận hóa đơn (Sen Vàng, Thịnh Vượng...). Mỗi công ty con có tài khoản riêng.';
create index customer_entities_customer_idx on public.customer_entities(customer_id);

create table public.customer_contacts (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  entity_id   uuid,
  name        text not null,
  phone       text,
  email       text,
  role_note   text,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  deleted_at  timestamptz,
  row_version integer not null default 1,
  foreign key (customer_id, entity_id) references public.customer_entities(customer_id, id)
);
create index customer_contacts_customer_idx on public.customer_contacts(customer_id);

-- Tài khoản khách: entity_id trống = thấy mọi công ty con của khách
create table public.customer_users (
  user_id     uuid primary key references public.profiles(user_id),
  customer_id uuid not null references public.customers(id),
  entity_id   uuid,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  row_version integer not null default 1,
  foreign key (customer_id, entity_id) references public.customer_entities(customer_id, id)
);
comment on table public.customer_users is 'Gắn tài khoản khách với khách hàng / công ty con. Một tài khoản chỉ thuộc một khách.';
create index customer_users_customer_idx on public.customer_users(customer_id);

create or replace function app.tg_customer_user_is_customer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where user_id = new.user_id and user_type = 'customer') then
    raise exception 'Chỉ tài khoản loại customer mới gắn được vào khách hàng' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger customer_users_is_customer
  before insert or update on public.customer_users
  for each row execute function app.tg_customer_user_is_customer();

-- CSKH phụ trách khách nào, từ ngày nào đến ngày nào
create table public.staff_customer_assignments (
  id            uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references public.profiles(user_id),
  customer_id   uuid not null references public.customers(id),
  valid_from    date not null default current_date,
  valid_to      date,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  row_version   integer not null default 1,
  check (valid_to is null or valid_to >= valid_from)
);
create index sca_staff_idx    on public.staff_customer_assignments(staff_user_id);
create index sca_customer_idx on public.staff_customer_assignments(customer_id);

-- ---------------------------------------------------------------------
-- 3. Đối tác thương mại: đơn vị đứng tên NK (SIMBA, APT, Nam Trung),
--    người xuất khẩu Bằng Tường, nhà cung cấp
-- ---------------------------------------------------------------------
create table public.trade_parties (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9_-]{2,30}$'),
  party_role  text not null check (party_role in ('importer', 'exporter', 'supplier')),
  legal_name  text not null,
  tax_code    text,
  address     text,
  country     text not null default 'VN',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  deleted_at  timestamptz,
  row_version integer not null default 1
);

-- ---------------------------------------------------------------------
-- 4. Cài đặt có hiệu lực theo thời gian (không sửa đè)
-- ---------------------------------------------------------------------
create table public.app_settings (
  id          uuid primary key default gen_random_uuid(),
  key         text not null check (key ~ '^[a-z0-9_.]+$'),
  value_json  jsonb not null,
  valid_from  timestamptz not null default now(),
  valid_to    timestamptz,
  note        text,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  check (valid_to is null or valid_to > valid_from)
);
-- mỗi key chỉ có 1 bản đang hiệu lực
create unique index app_settings_one_open_per_key on public.app_settings(key) where valid_to is null;

-- Chỉ được đóng bản cũ (điền valid_to), không được sửa giá trị
create or replace function app.tg_app_settings_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.key is distinct from old.key
     or new.value_json is distinct from old.value_json
     or new.valid_from is distinct from old.valid_from
     or old.valid_to is not null then
    raise exception 'Cài đặt không sửa đè được. Tạo bản mới bằng app.set_setting().' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger app_settings_immutable
  before update on public.app_settings
  for each row execute function app.tg_app_settings_immutable();

-- ---------------------------------------------------------------------
-- 5. File đính kèm (file thật nằm trên Google Drive hoặc Supabase Storage)
-- ---------------------------------------------------------------------
create table public.attachments (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid references public.customers(id),
  entity_id        uuid,
  entity_type      text not null check (entity_type ~ '^[a-z_]+$'),
  entity_ref_id    uuid not null,
  storage_provider text not null default 'gdrive' check (storage_provider in ('gdrive', 'supabase')),
  storage_key      text not null,       -- Drive file id hoặc đường dẫn storage
  file_name        text not null,
  mime_type        text not null check (mime_type in (
                     'image/jpeg', 'image/png', 'image/webp', 'image/heic',
                     'application/pdf',
                     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                     'application/vnd.ms-excel',
                     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                     'text/csv')),
  size_bytes       bigint not null check (size_bytes > 0 and size_bytes <= 20 * 1024 * 1024),
  version          integer not null default 1 check (version >= 1),
  visibility       text not null default 'internal' check (visibility in ('internal', 'customer')),
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  deleted_at       timestamptz,
  row_version      integer not null default 1,
  unique (storage_provider, storage_key),
  foreign key (customer_id, entity_id) references public.customer_entities(customer_id, id),
  check (visibility = 'internal' or customer_id is not null)
);
comment on column public.attachments.visibility is 'internal: chỉ nhân viên; customer: khách thấy trong phạm vi customer_id/entity_id.';
create index attachments_ref_idx      on public.attachments(entity_type, entity_ref_id);
create index attachments_customer_idx on public.attachments(customer_id, entity_id);

-- ---------------------------------------------------------------------
-- Gắn trigger cột chuẩn + chặn xóa vật lý
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'customers', 'customer_entities', 'customer_contacts',
                           'customer_users', 'staff_customer_assignments', 'trade_parties', 'attachments']
  loop
    execute format('create trigger %I_std before insert or update on public.%I
                    for each row execute function app.tg_standard_columns()', t, t);
  end loop;
  foreach t in array array['profiles', 'customers', 'customer_entities', 'customer_contacts',
                           'trade_parties', 'attachments', 'app_settings']
  loop
    execute format('create trigger %I_no_delete before delete on public.%I
                    for each row execute function app.tg_block_hard_delete()', t, t);
  end loop;
end;
$$;
