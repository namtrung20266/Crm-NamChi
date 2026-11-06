-- =====================================================================
-- NAMCHI ERP – Giai đoạn 2: Đơn hàng, biểu phí, phiếu tính tiền, tiền vào,
-- phân bổ tiền, thanh toán NCC, công nợ. Tài liệu mục 7.
-- Nguyên tắc: tiền VND bigint; mọi tính toán ở hàm DB; không xóa vật lý;
-- khách chỉ thấy khoản được chia sẻ; giá vốn nằm bảng riêng.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Ngữ cảnh người dùng trong 1 lần gọi (giảm số lượt gọi mạng)
-- ---------------------------------------------------------------------
create or replace function public.my_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', p.user_id, 'full_name', p.full_name, 'email', p.email, 'user_type', p.user_type,
    'is_active', p.is_active,
    'roles', coalesce((select jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name))
                       from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p.user_id), '[]'),
    'permissions', coalesce((select jsonb_agg(distinct pe.code)
                       from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
                       join public.permissions pe on pe.id = rp.permission_id where ur.user_id = p.user_id), '[]'),
    'customer', (select jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name)
                 from public.customer_users cu join public.customers c on c.id = cu.customer_id where cu.user_id = p.user_id),
    'entity', (select jsonb_build_object('id', e.id, 'code', e.code, 'legal_name', e.legal_name)
               from public.customer_users cu join public.customer_entities e on e.id = cu.entity_id where cu.user_id = p.user_id)
  )
  from public.profiles p
  where p.user_id = auth.uid();
$$;
revoke all on function public.my_context() from public, anon;
grant execute on function public.my_context() to authenticated;

-- ---------------------------------------------------------------------
-- 1. Quyền mới
-- ---------------------------------------------------------------------
insert into public.permissions (code, module, description) values
  ('order.write',            'order',   'Tạo, sửa đơn hàng, đổi trạng thái'),
  ('order.create_own',       'order',   'Khách tự tạo đơn cho công ty mình'),
  ('finance.read',           'finance', 'Xem phiếu tính tiền, tiền vào, công nợ'),
  ('finance.statement.write','finance', 'Lập/tính lại phiếu tính tiền, thêm khoản phát sinh'),
  ('finance.receipt.write',  'finance', 'Ghi nhận tiền vào, phân bổ tiền, thanh toán NCC'),
  ('fee.manage',             'finance', 'Quản lý biểu phí')
on conflict (code) do nothing;

with m(role_code, perm_code) as (values
  ('admin','order.write'), ('admin','finance.read'), ('admin','finance.statement.write'), ('admin','finance.receipt.write'), ('admin','fee.manage'),
  ('manager','finance.read'),
  ('cs','order.write'), ('cs','finance.read'), ('cs','finance.statement.write'),
  ('accountant','order.write'), ('accountant','finance.read'), ('accountant','finance.statement.write'), ('accountant','finance.receipt.write'), ('accountant','fee.manage'),
  ('xnk','order.write'),
  ('warehouse_cn','order.write'),
  ('warehouse_vn','order.write'),
  ('cust_admin','order.create_own'), ('cust_member','order.create_own')
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from m join public.roles r on r.code = m.role_code join public.permissions p on p.code = m.perm_code
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2. Biểu phí: loại phí + quy tắc có hiệu lực (giá bán và giá vốn)
-- ---------------------------------------------------------------------
create table public.fee_types (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique check (code ~ '^[A-Z0-9_]{2,30}$'),
  name                text not null,
  calc_method         text not null check (calc_method in ('percent_goods', 'percent_goods_after_tax', 'per_kg', 'actual')),
  visible_to_customer boolean not null default true,
  sort_order          integer not null default 100,
  is_active           boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  updated_by uuid, deleted_at timestamptz, row_version integer not null default 1
);

create table public.fee_rules (
  id                 uuid primary key default gen_random_uuid(),
  fee_type_id        uuid not null references public.fee_types(id),
  customer_id        uuid references public.customers(id),          -- trống = mặc định mọi khách
  china_invoice_type text check (china_invoice_type in ('HDCD', 'HDPT', 'KHD')), -- trống = mọi loại
  goods_group        text,                                           -- trống = mọi nhóm hàng
  sell_rate          numeric(18,6) not null check (sell_rate >= 0),  -- % hoặc đ/kg
  cost_rate          numeric(18,6) check (cost_rate >= 0),           -- trống = chưa có giá vốn
  valid_from         timestamptz not null default now(),
  valid_to           timestamptz,
  note               text,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  check (valid_to is null or valid_to > valid_from)
);
create index fee_rules_lookup on public.fee_rules(fee_type_id, customer_id, valid_from);

-- quy tắc không sửa đè: chỉ được đóng (điền valid_to)
create or replace function app.tg_fee_rules_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.fee_type_id, new.customer_id, new.china_invoice_type, new.goods_group, new.sell_rate, new.cost_rate, new.valid_from)
     is distinct from (old.fee_type_id, old.customer_id, old.china_invoice_type, old.goods_group, old.sell_rate, old.cost_rate, old.valid_from)
     or old.valid_to is not null then
    raise exception 'Quy tắc phí không sửa đè được. Tạo quy tắc mới có ngày hiệu lực.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger fee_rules_immutable before update on public.fee_rules for each row execute function app.tg_fee_rules_immutable();

-- ---------------------------------------------------------------------
-- 3. Đơn hàng (phần đầu đơn; dòng hàng sinh ở Giai đoạn 3 – khai báo)
-- ---------------------------------------------------------------------
create sequence public.order_code_seq;

create table public.orders (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique default ('DH' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMM') || '-' || lpad(nextval('public.order_code_seq')::text, 4, '0')),
  customer_id        uuid not null references public.customers(id),
  entity_id          uuid not null,
  order_week         text,                         -- VD: 45/2026
  supplier_name      text,                         -- shop / mã NCC
  goods_group        text,                         -- VD: giay_dep, tet, gau_bong
  goods_desc         text,
  china_invoice_type text not null default 'HDPT' check (china_invoice_type in ('HDCD', 'HDPT', 'KHD')),
  goods_qty          numeric(18,3) not null default 0 check (goods_qty >= 0),
  goods_cny          numeric(18,2) not null default 0 check (goods_cny >= 0),
  fx_rate            numeric(18,6) not null check (fx_rate > 0),            -- tỷ giá chốt với khách, ghim theo đơn
  china_tax_cny      numeric(18,2) not null default 0 check (china_tax_cny >= 0), -- thuế xuất HĐ TQ thực tế
  weight_kg          numeric(12,3) not null default 0 check (weight_kg >= 0),     -- cân tính phí (GĐ3 lấy từ kiện)
  cbm                numeric(12,4) not null default 0 check (cbm >= 0),
  packages           integer not null default 0 check (packages >= 0),
  vat_rate           numeric(5,2) not null default 8 check (vat_rate between 0 and 20), -- tạm tính; GĐ5 lấy theo dòng HĐ
  status             text not null default 'dang_len_don' check (status in (
                       'dang_len_don','cho_coc','dang_mua','cho_shop_giao','shop_da_phat','ve_kho_qc',
                       've_bang_tuong','tren_xe','ve_kho_vn','dang_giao','da_giao','hoan_tat','tam_giu','huy')),
  expected_week      text,
  delay_reason       text check (delay_reason in ('dung_lich','san_xuat_7','san_xuat_15','san_xuat_tren_15','khac')),
  shop_shipped_at    date,
  cn_received_at     date,
  vn_received_at     date,
  note               text,                         -- khách thấy
  internal_note      text,                         -- chỉ nội bộ (đọc qua view đã lọc)
  cs_owner_id        uuid references public.profiles(user_id),
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  updated_by uuid, deleted_at timestamptz, row_version integer not null default 1,
  foreign key (customer_id, entity_id) references public.customer_entities(customer_id, id)
);
create index orders_customer_idx on public.orders(customer_id, entity_id, created_at desc);
create index orders_status_idx on public.orders(status) where deleted_at is null;

-- Lịch sử trạng thái
create table public.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id),
  from_status text, to_status text not null,
  changed_by uuid default auth.uid(), changed_at timestamptz not null default now(), note text
);
create index osh_order_idx on public.order_status_history(order_id, changed_at desc);

create or replace function app.tg_order_status_history()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.order_status_history(order_id, from_status, to_status, changed_by)
    values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status, auth.uid());
  end if;
  return new;
end $$;
create trigger orders_status_history after insert or update of status on public.orders
  for each row execute function app.tg_order_status_history();

-- Khách tạo đơn: chỉ được trạng thái 'dang_len_don', không đặt tỷ giá tùy ý ngoài mặc định
create or replace function app.tg_orders_customer_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not app.is_staff() then
    if tg_op = 'INSERT' then
      new.status := 'dang_len_don';
      new.internal_note := null;
      new.cs_owner_id := null;
      new.china_tax_cny := 0;
      new.weight_kg := 0;
      -- tỷ giá do Nam Trung chốt: khách tạo đơn nhận tỷ giá mặc định, CSKH sửa sau
      select coalesce((s.value_json)::text::numeric, 3650) into new.fx_rate
      from public.app_settings s where s.key = 'finance.default_fx_rate' and s.valid_to is null;
      new.fx_rate := coalesce(new.fx_rate, 3650);
    else
      raise exception 'Khách hàng không sửa đơn sau khi gửi; liên hệ CSKH' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger orders_customer_guard before insert or update on public.orders
  for each row execute function app.tg_orders_customer_guard();

-- ---------------------------------------------------------------------
-- 4. Phiếu tính tiền (3 phiên bản) + dòng phí + giá vốn nội bộ
-- ---------------------------------------------------------------------
create table public.order_statements (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id),
  customer_id  uuid not null,
  entity_id    uuid not null,
  version      integer not null,
  kind         text not null check (kind in ('du_tinh', 'tam_tinh', 'quyet_toan')),
  status       text not null default 'active' check (status in ('active', 'confirmed', 'superseded')),
  subtotal_vnd bigint not null default 0,
  vat_rate     numeric(5,2) not null,
  vat_vnd      bigint not null default 0,
  total_vnd    bigint not null default 0,
  deposit_vnd  bigint not null default 0,        -- cọc L1 đề xuất
  fx_rate      numeric(18,6) not null,
  confirmed_by uuid, confirmed_at timestamptz,
  created_at   timestamptz not null default now(), created_by uuid default auth.uid(),
  unique (order_id, version)
);
create index order_statements_order_idx on public.order_statements(order_id, version desc);

create table public.order_statement_lines (
  id            uuid primary key default gen_random_uuid(),
  statement_id  uuid not null references public.order_statements(id),
  order_id      uuid not null,
  customer_id   uuid not null,
  entity_id     uuid not null,
  fee_type_id   uuid references public.fee_types(id),
  label         text not null,
  basis_vnd     bigint,
  rate          numeric(18,6),
  amount_vnd    bigint not null,
  source        text not null check (source in ('goods', 'rule', 'manual')),
  visible_to_customer boolean not null default true,
  sort_order    integer not null default 100,
  created_at    timestamptz not null default now(), created_by uuid default auth.uid()
);
create index osl_statement_idx on public.order_statement_lines(statement_id);

-- Giá vốn nội bộ theo phiếu (khách KHÔNG có policy đọc)
create table public.order_costs (
  id           uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.order_statements(id),
  order_id     uuid not null,
  fee_type_id  uuid references public.fee_types(id),
  label        text not null,
  amount_vnd   bigint,                      -- trống = chưa có giá vốn
  source       text not null check (source in ('goods', 'rule', 'manual')),
  created_at   timestamptz not null default now(), created_by uuid default auth.uid()
);
create index order_costs_order_idx on public.order_costs(order_id, statement_id);

-- ---------------------------------------------------------------------
-- 5. Tiền vào, phân bổ, thanh toán nhà cung cấp
-- ---------------------------------------------------------------------
create table public.bank_receipts (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers(id),
  received_at  date not null default current_date,
  amount_vnd   bigint not null check (amount_vnd > 0),
  bank_ref     text,
  payer_note   text,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  updated_by uuid, deleted_at timestamptz, row_version integer not null default 1
);
create index bank_receipts_customer_idx on public.bank_receipts(customer_id, received_at desc);

create table public.receipt_allocations (
  id          uuid primary key default gen_random_uuid(),
  receipt_id  uuid not null references public.bank_receipts(id),
  order_id    uuid not null references public.orders(id),
  customer_id uuid not null,
  entity_id   uuid not null,
  kind        text not null check (kind in ('L1', 'L2', 'khac')),
  amount_vnd  bigint not null check (amount_vnd <> 0),   -- âm = đảo phân bổ
  note        text,
  created_at  timestamptz not null default now(), created_by uuid default auth.uid()
);
create index ra_order_idx on public.receipt_allocations(order_id);
create index ra_receipt_idx on public.receipt_allocations(receipt_id);

-- Kiểm tra: cùng khách, không phân bổ vượt số tiền nhận (khóa dòng chống ghi đồng thời)
create or replace function app.tg_allocation_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_rec public.bank_receipts;
  v_ord public.orders;
  v_sum bigint;
begin
  select * into v_rec from public.bank_receipts where id = new.receipt_id for update;
  select * into v_ord from public.orders where id = new.order_id;
  if v_rec.customer_id <> v_ord.customer_id then
    raise exception 'Tiền của khách này không phân bổ được cho đơn của khách khác' using errcode = '23514';
  end if;
  new.customer_id := v_ord.customer_id;
  new.entity_id := v_ord.entity_id;
  select coalesce(sum(amount_vnd), 0) into v_sum from public.receipt_allocations where receipt_id = new.receipt_id;
  if v_sum + new.amount_vnd > v_rec.amount_vnd then
    raise exception 'Vượt số tiền của giao dịch: đã phân bổ %, còn lại %', v_sum, v_rec.amount_vnd - v_sum using errcode = '23514';
  end if;
  if v_sum + new.amount_vnd < 0 then
    raise exception 'Đảo phân bổ vượt số đã phân bổ' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger receipt_allocations_guard before insert on public.receipt_allocations
  for each row execute function app.tg_allocation_guard();

create table public.supplier_payments (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id),
  paid_at     date not null default current_date,
  method      text not null check (method in ('nam_trung', 'khach_tra_ho')),
  amount_cny  numeric(18,2) not null check (amount_cny > 0),
  fx_rate     numeric(18,6) not null check (fx_rate > 0),   -- tỷ giá THỰC TẾ lúc trả
  amount_vnd  bigint generated always as (round(amount_cny * fx_rate)::bigint) stored,
  note        text,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  updated_by uuid, deleted_at timestamptz, row_version integer not null default 1
);
create index supplier_payments_order_idx on public.supplier_payments(order_id);

-- Bảng sổ cái không sửa/xóa (sai thì ghi dòng đảo)
create or replace function app.tg_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Bảng % chỉ ghi thêm. Sai thì ghi bút toán đảo.', tg_table_name using errcode = '42501';
end $$;
create trigger receipt_allocations_append_only before update or delete on public.receipt_allocations
  for each row execute function app.tg_append_only();
create trigger statement_lines_append_only before update or delete on public.order_statement_lines
  for each row execute function app.tg_append_only();
create trigger order_costs_append_only before update or delete on public.order_costs
  for each row execute function app.tg_append_only();

-- ---------------------------------------------------------------------
-- 6. Trigger chuẩn + nhật ký
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['fee_types', 'orders', 'bank_receipts', 'supplier_payments'] loop
    execute format('create trigger %I_std before insert or update on public.%I for each row execute function app.tg_standard_columns()', t, t);
    execute format('create trigger %I_no_delete before delete on public.%I for each row execute function app.tg_block_hard_delete()', t, t);
  end loop;
  foreach t in array array['fee_types', 'fee_rules', 'orders', 'order_statements', 'order_statement_lines', 'order_costs',
                           'bank_receipts', 'receipt_allocations', 'supplier_payments'] loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function audit.tg_log_change()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 7. Tính phiếu tính tiền (chạy trong DB, 1 transaction)
--    Mức phí lấy theo NGÀY TẠO ĐƠN → đổi biểu phí không làm đổi đơn cũ.
-- ---------------------------------------------------------------------
create or replace function app.pick_rule(p_fee uuid, p_customer uuid, p_inv text, p_group text, p_at timestamptz)
returns public.fee_rules language sql stable security definer set search_path = '' as $$
  select r.* from public.fee_rules r
  where r.fee_type_id = p_fee
    and (r.customer_id is null or r.customer_id = p_customer)
    and (r.china_invoice_type is null or r.china_invoice_type = p_inv)
    and (r.goods_group is null or r.goods_group = p_group)
    and r.valid_from <= p_at and (r.valid_to is null or r.valid_to > p_at)
  order by (r.customer_id is not null) desc, (r.china_invoice_type is not null) desc, (r.goods_group is not null) desc, r.valid_from desc
  limit 1;
$$;

create or replace function public.build_statement(p_order_id uuid, p_kind text, p_extra jsonb default '[]')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  ft public.fee_types;
  r public.fee_rules;
  v_stmt uuid;
  v_ver integer;
  v_goods bigint;
  v_tax bigint;
  v_basis bigint;
  v_amt bigint;
  v_cost bigint;
  v_sub bigint := 0;
  v_vat bigint;
  v_dep_rate numeric;
  v_prev uuid;
  x jsonb;
begin
  if not app.has_perm('finance.statement.write') then
    raise exception 'Không có quyền lập phiếu tính tiền' using errcode = '42501';
  end if;
  if p_kind not in ('du_tinh', 'tam_tinh', 'quyet_toan') then
    raise exception 'Loại phiếu không hợp lệ' using errcode = '22023';
  end if;
  select * into o from public.orders where id = p_order_id and deleted_at is null for update;
  if not found or not app.staff_can_see_customer(o.customer_id) then
    raise exception 'Không tìm thấy đơn' using errcode = '42501';
  end if;

  select id into v_prev from public.order_statements where order_id = o.id and status <> 'superseded' order by version desc limit 1;
  update public.order_statements set status = 'superseded' where order_id = o.id and status <> 'superseded';
  select coalesce(max(version), 0) + 1 into v_ver from public.order_statements where order_id = o.id;

  insert into public.order_statements (order_id, customer_id, entity_id, version, kind, vat_rate, fx_rate)
  values (o.id, o.customer_id, o.entity_id, v_ver, p_kind, o.vat_rate, o.fx_rate) returning id into v_stmt;

  v_goods := round(o.goods_cny * o.fx_rate)::bigint;
  v_tax := round(o.china_tax_cny * o.fx_rate)::bigint;

  insert into public.order_statement_lines (statement_id, order_id, customer_id, entity_id, label, basis_vnd, rate, amount_vnd, source, sort_order)
  values (v_stmt, o.id, o.customer_id, o.entity_id, 'Tiền hàng (' || o.goods_cny || ' tệ × ' || o.fx_rate || ')', null, o.fx_rate, v_goods, 'goods', 1);
  insert into public.order_costs (statement_id, order_id, label, amount_vnd, source) values (v_stmt, o.id, 'Tiền hàng', v_goods, 'goods');
  v_sub := v_goods;
  if v_tax > 0 then
    insert into public.order_statement_lines (statement_id, order_id, customer_id, entity_id, label, rate, amount_vnd, source, sort_order)
    values (v_stmt, o.id, o.customer_id, o.entity_id, 'Thuế xuất hóa đơn Trung Quốc', o.fx_rate, v_tax, 'goods', 2);
    insert into public.order_costs (statement_id, order_id, label, amount_vnd, source) values (v_stmt, o.id, 'Thuế xuất HĐ TQ', v_tax, 'goods');
    v_sub := v_sub + v_tax;
  end if;

  for ft in select * from public.fee_types where is_active and deleted_at is null and calc_method <> 'actual' order by sort_order loop
    r := app.pick_rule(ft.id, o.customer_id, o.china_invoice_type, o.goods_group, o.created_at);
    continue when r.id is null;
    v_basis := case ft.calc_method
                 when 'percent_goods' then v_goods
                 when 'percent_goods_after_tax' then v_goods + v_tax
                 else null end;
    v_amt := case ft.calc_method
               when 'per_kg' then round(o.weight_kg * r.sell_rate)::bigint
               else round(v_basis * r.sell_rate / 100)::bigint end;
    v_cost := case when r.cost_rate is null then null
                   when ft.calc_method = 'per_kg' then round(o.weight_kg * r.cost_rate)::bigint
                   else round(v_basis * r.cost_rate / 100)::bigint end;
    continue when v_amt = 0 and coalesce(v_cost, 0) = 0;
    insert into public.order_statement_lines (statement_id, order_id, customer_id, entity_id, fee_type_id, label, basis_vnd, rate, amount_vnd, source, visible_to_customer, sort_order)
    values (v_stmt, o.id, o.customer_id, o.entity_id, ft.id, ft.name, v_basis, r.sell_rate, v_amt, 'rule', ft.visible_to_customer, 10 + ft.sort_order);
    insert into public.order_costs (statement_id, order_id, fee_type_id, label, amount_vnd, source) values (v_stmt, o.id, ft.id, ft.name, v_cost, 'rule');
    v_sub := v_sub + v_amt;
  end loop;

  -- giữ lại các khoản phát sinh nhập tay của phiếu trước
  if v_prev is not null then
    insert into public.order_statement_lines (statement_id, order_id, customer_id, entity_id, fee_type_id, label, amount_vnd, source, visible_to_customer, sort_order)
    select v_stmt, order_id, customer_id, entity_id, fee_type_id, label, amount_vnd, 'manual', visible_to_customer, sort_order
    from public.order_statement_lines where statement_id = v_prev and source = 'manual';
    insert into public.order_costs (statement_id, order_id, fee_type_id, label, amount_vnd, source)
    select v_stmt, order_id, fee_type_id, label, amount_vnd, 'manual' from public.order_costs where statement_id = v_prev and source = 'manual';
    select v_sub + coalesce(sum(amount_vnd), 0) into v_sub from public.order_statement_lines where statement_id = v_stmt and source = 'manual';
  end if;

  -- khoản phát sinh mới truyền vào: [{label, amount_vnd, cost_vnd, fee_type_id, visible}]
  for x in select * from jsonb_array_elements(coalesce(p_extra, '[]')) loop
    v_amt := (x ->> 'amount_vnd')::bigint;
    insert into public.order_statement_lines (statement_id, order_id, customer_id, entity_id, fee_type_id, label, amount_vnd, source, visible_to_customer, sort_order)
    values (v_stmt, o.id, o.customer_id, o.entity_id, nullif(x ->> 'fee_type_id', '')::uuid, x ->> 'label', v_amt, 'manual',
            coalesce((x ->> 'visible')::boolean, true), 200);
    insert into public.order_costs (statement_id, order_id, fee_type_id, label, amount_vnd, source)
    values (v_stmt, o.id, nullif(x ->> 'fee_type_id', '')::uuid, x ->> 'label', nullif(x ->> 'cost_vnd', '')::bigint, 'manual');
    v_sub := v_sub + v_amt;
  end loop;

  v_vat := round(v_sub * o.vat_rate / 100)::bigint;
  select coalesce((public.get_setting('finance.deposit_rate_percent'))::text::numeric, 80) into v_dep_rate;
  update public.order_statements
     set subtotal_vnd = v_sub, vat_vnd = v_vat, total_vnd = v_sub + v_vat,
         deposit_vnd = round(v_goods * v_dep_rate / 100)::bigint
   where id = v_stmt;
  return v_stmt;
end;
$$;

-- Khách (hoặc nhân viên) xác nhận phiếu đang hiệu lực
create or replace function public.confirm_statement(p_statement_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.order_statements;
begin
  select * into s from public.order_statements where id = p_statement_id for update;
  if not found or s.status <> 'active' then
    raise exception 'Phiếu không còn hiệu lực để xác nhận' using errcode = '22023';
  end if;
  if not (app.can_see_entity(s.customer_id, s.entity_id)
          and (not app.is_staff() or app.has_perm('finance.statement.write'))) then
    raise exception 'Không có quyền xác nhận phiếu này' using errcode = '42501';
  end if;
  update public.order_statements set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now() where id = s.id;
end $$;

-- ---------------------------------------------------------------------
-- 8. View tổng hợp tài chính theo đơn và công nợ
-- ---------------------------------------------------------------------
create or replace view public.order_finance
with (security_invoker = true) as
select o.id as order_id, o.code, o.customer_id, o.entity_id, o.status, o.created_at,
       s.id as statement_id, s.kind as statement_kind, s.status as statement_status, s.version,
       coalesce(s.total_vnd, 0) as total_vnd, coalesce(s.deposit_vnd, 0) as deposit_vnd,
       coalesce((select sum(a.amount_vnd) from public.receipt_allocations a where a.order_id = o.id), 0)::bigint as paid_vnd,
       coalesce(s.total_vnd, 0) - coalesce((select sum(a.amount_vnd) from public.receipt_allocations a where a.order_id = o.id), 0)::bigint as remaining_vnd
from public.orders o
left join lateral (
  select * from public.order_statements st where st.order_id = o.id and st.status <> 'superseded' order by st.version desc limit 1
) s on true
where o.deleted_at is null;

create or replace view public.receipt_balance
with (security_invoker = true) as
select r.id as receipt_id, r.customer_id, r.received_at, r.amount_vnd, r.bank_ref, r.payer_note,
       coalesce((select sum(a.amount_vnd) from public.receipt_allocations a where a.receipt_id = r.id), 0)::bigint as allocated_vnd,
       r.amount_vnd - coalesce((select sum(a.amount_vnd) from public.receipt_allocations a where a.receipt_id = r.id), 0)::bigint as unallocated_vnd
from public.bank_receipts r
where r.deleted_at is null;

-- Lợi nhuận đơn (chỉ người có finance.profit.read đọc được order_costs → view trả rỗng cho người khác)
create or replace view public.order_profit
with (security_invoker = true) as
select f.order_id, f.code, f.customer_id, f.entity_id, f.total_vnd,
       (select s.subtotal_vnd from public.order_statements s where s.id = f.statement_id) as revenue_ex_vat,
       (select sum(c.amount_vnd) from public.order_costs c where c.statement_id = f.statement_id) as cost_vnd,
       (select count(*) from public.order_costs c where c.statement_id = f.statement_id and c.amount_vnd is null) as missing_cost_lines
from public.order_finance f
where app.has_perm('finance.profit.read');

-- ---------------------------------------------------------------------
-- 9. Quyền bảng + RLS
-- ---------------------------------------------------------------------
revoke all on public.fee_types, public.fee_rules, public.orders, public.order_status_history,
                public.order_statements, public.order_statement_lines, public.order_costs,
                public.bank_receipts, public.receipt_allocations, public.supplier_payments,
                public.order_finance, public.receipt_balance, public.order_profit from anon, authenticated;
grant select on public.fee_types, public.fee_rules, public.orders, public.order_status_history,
                public.order_statements, public.order_statement_lines, public.order_costs,
                public.bank_receipts, public.receipt_allocations, public.supplier_payments,
                public.order_finance, public.receipt_balance, public.order_profit to authenticated;
grant insert, update on public.fee_types, public.orders, public.bank_receipts, public.supplier_payments to authenticated;
grant insert on public.fee_rules, public.receipt_allocations to authenticated;
grant update (valid_to) on public.fee_rules to authenticated;
grant usage on sequence public.order_code_seq to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
revoke all on function public.build_statement(uuid, text, jsonb) from public, anon;
revoke all on function public.confirm_statement(uuid) from public, anon;
grant execute on function public.build_statement(uuid, text, jsonb), public.confirm_statement(uuid) to authenticated;
revoke all on function app.pick_rule(uuid, uuid, text, text, timestamptz) from public;

alter table public.fee_types             enable row level security;
alter table public.fee_rules             enable row level security;
alter table public.orders                enable row level security;
alter table public.order_status_history  enable row level security;
alter table public.order_statements      enable row level security;
alter table public.order_statement_lines enable row level security;
alter table public.order_costs           enable row level security;
alter table public.bank_receipts         enable row level security;
alter table public.receipt_allocations   enable row level security;
alter table public.supplier_payments     enable row level security;

create policy fee_types_select on public.fee_types for select to authenticated using (app.is_staff());
create policy fee_types_write on public.fee_types for insert to authenticated with check (app.has_perm('fee.manage'));
create policy fee_types_update on public.fee_types for update to authenticated using (app.has_perm('fee.manage')) with check (app.has_perm('fee.manage'));
create policy fee_rules_select on public.fee_rules for select to authenticated using (app.is_staff());
create policy fee_rules_insert on public.fee_rules for insert to authenticated with check (app.has_perm('fee.manage'));
create policy fee_rules_update on public.fee_rules for update to authenticated using (app.has_perm('fee.manage')) with check (app.has_perm('fee.manage'));

create policy orders_select on public.orders for select to authenticated
  using (deleted_at is null and app.can_see_entity(customer_id, entity_id));
create policy orders_insert on public.orders for insert to authenticated with check (
  (app.has_perm('order.write') and app.staff_can_see_customer(customer_id))
  or (app.has_perm('order.create_own') and customer_id = app.current_customer_id()
      and (app.current_entity_id() is null or entity_id = app.current_entity_id()))
);
create policy orders_update on public.orders for update to authenticated
  using (app.has_perm('order.write') and app.staff_can_see_customer(customer_id))
  with check (app.has_perm('order.write') and app.staff_can_see_customer(customer_id));

create policy osh_select on public.order_status_history for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

create policy statements_select on public.order_statements for select to authenticated
  using (app.can_see_entity(customer_id, entity_id) and (app.is_staff() and app.has_perm('finance.read') or not app.is_staff()));
create policy statement_lines_select on public.order_statement_lines for select to authenticated
  using (app.can_see_entity(customer_id, entity_id)
         and ((app.is_staff() and app.has_perm('finance.read')) or (not app.is_staff() and visible_to_customer)));
create policy order_costs_select on public.order_costs for select to authenticated
  using (app.has_perm('finance.profit.read'));

-- Tiền vào: kế toán/admin/quản lý/CSKH theo phạm vi; phía khách chỉ tài khoản cấp Lanchi (không gắn công ty con)
create policy receipts_select on public.bank_receipts for select to authenticated using (
  deleted_at is null and (
    (app.has_perm('finance.read') and app.staff_can_see_customer(customer_id))
    or (not app.is_staff() and customer_id = app.current_customer_id() and app.current_entity_id() is null)));
create policy receipts_insert on public.bank_receipts for insert to authenticated with check (app.has_perm('finance.receipt.write'));
create policy receipts_update on public.bank_receipts for update to authenticated
  using (app.has_perm('finance.receipt.write')) with check (app.has_perm('finance.receipt.write'));

create policy allocations_select on public.receipt_allocations for select to authenticated using (
  (app.is_staff() and app.has_perm('finance.read') and app.staff_can_see_customer(customer_id))
  or (not app.is_staff() and app.can_see_entity(customer_id, entity_id)));
create policy allocations_insert on public.receipt_allocations for insert to authenticated
  with check (app.has_perm('finance.receipt.write'));

create policy supplier_payments_select on public.supplier_payments for select to authenticated
  using (deleted_at is null and app.has_perm('finance.read') and app.is_staff()
         and exists (select 1 from public.orders o where o.id = order_id and app.staff_can_see_customer(o.customer_id)));
create policy supplier_payments_insert on public.supplier_payments for insert to authenticated
  with check (app.has_perm('finance.receipt.write'));
create policy supplier_payments_update on public.supplier_payments for update to authenticated
  using (app.has_perm('finance.receipt.write')) with check (app.has_perm('finance.receipt.write'));

-- ---------------------------------------------------------------------
-- 10. Biểu phí Lanchi ban đầu (từ File_chiphi) + cài đặt
-- ---------------------------------------------------------------------
insert into public.fee_types (code, name, calc_method, visible_to_customer, sort_order) values
  ('MUA_HANG',  'Phí mua hàng',              'percent_goods',           true, 10),
  ('TNDN',      'Phí xử lý thuế (TNDN)',     'percent_goods',           true, 20),
  ('HANDLE',    'Phí handle',                'percent_goods_after_tax', true, 30),
  ('CUOC_KG',   'Cước vận chuyển (theo kg)', 'per_kg',                  true, 40),
  ('KIEM_DINH', 'Phí kiểm định',             'actual',                  true, 50),
  ('SHIP_ND',   'Ship nội địa / giao hàng',  'actual',                  true, 60),
  ('THUE_NK',   'Thuế nhập khẩu',            'actual',                  true, 70),
  ('KHAC',      'Phí phát sinh khác',        'actual',                  true, 90);

insert into public.fee_rules (fee_type_id, china_invoice_type, goods_group, sell_rate, note, valid_from)
select f.id, x.inv, x.grp, x.rate, x.note, '2026-01-01'::timestamptz
from (values
  ('MUA_HANG', null, null, 2.0,   'File_chiphi: 2% tiền hàng'),
  ('TNDN',     null, null, 2.0,   'File_chiphi: 2% tiền hàng'),
  ('HANDLE',   'HDPT', null, 0.8, 'Anh chốt 06/11: 0,8% HĐ phổ thông'),
  ('HANDLE',   'KHD',  null, 1.5, 'Anh chốt 06/11: 1,5% không hóa đơn'),
  ('CUOC_KG',  null, null, 12000, 'File_chiphi: 12.000đ/kg'),
  ('CUOC_KG',  null, 'giay_dep', 11000, 'File_chiphi: giày dép 11.000đ/kg')
) x(code, inv, grp, rate, note)
join public.fee_types f on f.code = x.code;

insert into public.app_settings (key, value_json, note) values
  ('finance.deposit_rate_percent', '80', 'Cọc L1 = % tiền hàng phải trả NCC'),
  ('finance.default_fx_rate', '3650', 'Tỷ giá mặc định gợi ý khi tạo đơn (CSKH sửa theo đơn)')
on conflict do nothing;
