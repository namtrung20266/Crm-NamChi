-- =====================================================================
-- NAMCHI ERP – Giai đoạn 3: Kho TQ, kiện & cân đo, dòng khai báo, thư viện
-- khai báo (HS), list bốc, list xe, bộ dữ liệu chốt (snapshot).
-- Quy tắc cứng: bốc không vượt số lượng; 1 kiện chỉ nằm 1 list bốc đang
-- hiệu lực; snapshot đã chốt không sửa được; cân tính phí = MAX(kg, kg quy đổi).
-- =====================================================================

insert into public.permissions (code, module, description) values
  ('warehouse.write', 'warehouse', 'Nhận kiện, cân đo, chuyển kho, kiểm đếm'),
  ('customs.write',   'customs',   'Lập dòng khai báo, thư viện tên hàng/HS'),
  ('customs.confirm', 'customs',   'Xác nhận HS, chốt list xe, tạo bộ dữ liệu chốt'),
  ('logistics.write', 'logistics', 'Lập list bốc, list xe')
on conflict (code) do nothing;

with m(role_code, perm_code) as (values
  ('admin','warehouse.write'), ('admin','customs.write'), ('admin','customs.confirm'), ('admin','logistics.write'),
  ('warehouse_cn','warehouse.write'), ('warehouse_vn','warehouse.write'),
  ('cs','customs.write'), ('cs','logistics.write'),
  ('xnk','customs.write'), ('xnk','customs.confirm'), ('xnk','logistics.write')
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from m join public.roles r on r.code = m.role_code join public.permissions p on p.code = m.perm_code
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 1. Kho
-- ---------------------------------------------------------------------
create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_]{2,10}$'),
  name text not null,
  country text not null check (country in ('CN', 'VN')),
  sort_order integer not null default 100
);
insert into public.warehouses (code, name, country, sort_order) values
  ('QC', 'Kho Quảng Châu', 'CN', 10), ('BT', 'Kho Bằng Tường', 'CN', 20), ('AP', 'Kho AP (cửa khẩu)', 'CN', 30), ('VN', 'Kho Việt Nam', 'VN', 40);

-- ---------------------------------------------------------------------
-- 2. Kiện hàng: mã [Mã đơn]-[STT]/[Tổng], cân đo, quy đổi khối
-- ---------------------------------------------------------------------
create table public.packages (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id),
  customer_id   uuid not null,
  entity_id     uuid not null,
  seq_no        integer not null check (seq_no > 0),
  gw_kg         numeric(12,3) not null default 0 check (gw_kg >= 0),
  length_cm     numeric(10,1) not null default 0 check (length_cm >= 0),
  width_cm      numeric(10,1) not null default 0 check (width_cm >= 0),
  height_cm     numeric(10,1) not null default 0 check (height_cm >= 0),
  vol_divisor   numeric(10,2) not null default 6000 check (vol_divisor > 0),   -- ghim hệ số lúc tạo kiện
  cbm           numeric(12,6) generated always as (round(length_cm * width_cm * height_cm / 1000000, 6)) stored,
  vol_kg        numeric(12,3) generated always as (round(length_cm * width_cm * height_cm / vol_divisor, 3)) stored,
  chargeable_kg numeric(12,3) generated always as (greatest(gw_kg, round(length_cm * width_cm * height_cm / vol_divisor, 3))) stored,
  warehouse_id  uuid references public.warehouses(id),
  status        text not null default 'du_kien' check (status in ('du_kien','ve_kho','tren_xe','ve_vn','thieu','hong','sai_hang','da_giao')),
  note          text,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  updated_by uuid, deleted_at timestamptz, row_version integer not null default 1,
  unique (order_id, seq_no)
);
create index packages_order_idx on public.packages(order_id) where deleted_at is null;

create table public.package_events (
  id bigint generated always as identity primary key,
  package_id uuid not null references public.packages(id),
  event text not null,
  warehouse_id uuid references public.warehouses(id),
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index package_events_pkg_idx on public.package_events(package_id, created_at desc);

-- Gán khách/công ty + hệ số khối từ cài đặt khi tạo kiện
create or replace function app.tg_packages_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o public.orders; v numeric;
begin
  select * into o from public.orders where id = new.order_id;
  new.customer_id := o.customer_id;
  new.entity_id := o.entity_id;
  if tg_op = 'INSERT' then
    select (s.value_json)::text::numeric into v from public.app_settings s
     where s.key = 'shipping.volumetric_divisor' and s.valid_from <= now() and (s.valid_to is null or s.valid_to > now())
     order by s.valid_from desc limit 1;
    new.vol_divisor := coalesce(v, 6000);
  else
    new.vol_divisor := old.vol_divisor;
  end if;
  return new;
end $$;
create trigger packages_defaults before insert or update on public.packages for each row execute function app.tg_packages_defaults();

-- Nhật ký kiện tự động khi đổi trạng thái/kho
create or replace function app.tg_package_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.warehouse_id is distinct from old.warehouse_id then
    insert into public.package_events(package_id, event, warehouse_id, created_by)
    values (new.id, new.status, new.warehouse_id, auth.uid());
  end if;
  return new;
end $$;
create trigger packages_event after insert or update on public.packages for each row execute function app.tg_package_event();

-- Cộng dồn cân/khối/số kiện lên đơn (để phiếu tính tiền dùng số thật)
create or replace function app.tg_packages_rollup()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_order uuid := coalesce(new.order_id, old.order_id);
begin
  update public.orders o set
    weight_kg = coalesce(x.kg, 0), cbm = coalesce(x.cbm, 0), packages = coalesce(x.n, 0), row_version = o.row_version
  from (select sum(chargeable_kg) kg, sum(cbm) cbm, count(*) n from public.packages where order_id = v_order and deleted_at is null) x
  where o.id = v_order;
  return null;
end $$;
create trigger packages_rollup after insert or update or delete on public.packages for each row execute function app.tg_packages_rollup();

-- Mã kiện hiển thị: [Mã đơn]-[STT]/[Tổng]
create or replace view public.package_labels with (security_invoker = true) as
select p.*, o.code as order_code,
       o.code || '-' || p.seq_no || '/' || (select count(*) from public.packages p2 where p2.order_id = p.order_id and p2.deleted_at is null) as label,
       w.code as warehouse_code
from public.packages p join public.orders o on o.id = p.order_id left join public.warehouses w on w.id = p.warehouse_id
where p.deleted_at is null;

-- ---------------------------------------------------------------------
-- 3. Thư viện khai báo (tên chuẩn + HS) – có version, chỉ gợi ý
-- ---------------------------------------------------------------------
create table public.customs_catalog (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid references public.customers(id),
  model           text,
  name_cn         text,
  declared_name_vi text not null,
  declared_name_en text,
  hs_code         text not null check (hs_code ~ '^[0-9]{8}$'),
  uom             text not null,
  import_tax_rate numeric(5,2),
  vat_rate        numeric(5,2),
  policy_note     text,
  version         integer not null default 1,
  supersedes_id   uuid references public.customs_catalog(id),
  is_current      boolean not null default true,
  confirmed_by    uuid, confirmed_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid default auth.uid()
);
create index customs_catalog_search on public.customs_catalog(customer_id, is_current);

-- ---------------------------------------------------------------------
-- 4. Dòng khai báo (dòng hàng của đơn) – sinh ở bước khai báo
-- ---------------------------------------------------------------------
create table public.order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders(id),
  customer_id      uuid not null,
  entity_id        uuid not null,
  line_no          integer not null,
  catalog_id       uuid references public.customs_catalog(id),
  name_cn          text,
  model            text,
  declared_name_vi text not null,
  declared_name_en text,
  hs_code          text check (hs_code is null or hs_code ~ '^[0-9]{8}$'),
  uom              text not null default 'Chiếc',
  qty              numeric(18,3) not null check (qty > 0),
  unit_price_cny   numeric(18,4) not null default 0 check (unit_price_cny >= 0),
  value_cny        numeric(18,2) generated always as (round(qty * unit_price_cny, 2)) stored,
  origin           text not null default 'CN',
  manufacturer     text,
  material         text,
  usage            text,
  spec             text,
  compliance_need  text not null default 'none' check (compliance_need in ('none','qc','hop_quy','form_e','khac')),
  compliance_status text not null default 'khong_can' check (compliance_status in ('khong_can','can_lam','dang_lam','cho_ket_qua','dat','khong_dat')),
  status           text not null default 'nhap' check (status in ('nhap','da_xac_nhan')),
  confirmed_by     uuid, confirmed_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  updated_by uuid, deleted_at timestamptz, row_version integer not null default 1,
  unique (order_id, line_no)
);
create index order_items_order_idx on public.order_items(order_id) where deleted_at is null;

create or replace function app.tg_order_items_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = new.order_id;
  new.customer_id := o.customer_id;
  new.entity_id := o.entity_id;
  if tg_op = 'INSERT' and new.line_no is null then
    select coalesce(max(line_no), 0) + 1 into new.line_no from public.order_items where order_id = new.order_id;
  end if;
  -- dòng đã xác nhận: sửa nội dung khai báo phải có quyền xác nhận và tự về trạng thái nháp
  if tg_op = 'UPDATE' and old.status = 'da_xac_nhan' and new.status = 'da_xac_nhan'
     and (new.declared_name_vi, new.hs_code, new.uom, new.qty, new.unit_price_cny)
         is distinct from (old.declared_name_vi, old.hs_code, old.uom, old.qty, old.unit_price_cny) then
    new.status := 'nhap'; new.confirmed_by := null; new.confirmed_at := null;
  end if;
  return new;
end $$;
create trigger order_items_defaults before insert or update on public.order_items for each row execute function app.tg_order_items_defaults();

-- Xác nhận dòng khai báo (XNK): bắt buộc có HS 8 số; lưu vào thư viện nếu chưa có
create or replace function public.confirm_order_item(p_item_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.order_items; v_cat uuid;
begin
  if not app.has_perm('customs.confirm') then raise exception 'Không có quyền xác nhận khai báo' using errcode = '42501'; end if;
  select * into i from public.order_items where id = p_item_id and deleted_at is null for update;
  if not found or not app.staff_can_see_customer(i.customer_id) then raise exception 'Không tìm thấy dòng' using errcode = '42501'; end if;
  if i.hs_code is null then raise exception 'Dòng chưa có mã HS' using errcode = '22023'; end if;
  select id into v_cat from public.customs_catalog
   where is_current and hs_code = i.hs_code and lower(declared_name_vi) = lower(i.declared_name_vi)
     and coalesce(model, '') = coalesce(i.model, '') and (customer_id is null or customer_id = i.customer_id) limit 1;
  if v_cat is null then
    insert into public.customs_catalog (customer_id, model, name_cn, declared_name_vi, declared_name_en, hs_code, uom, confirmed_by, confirmed_at)
    values (i.customer_id, i.model, i.name_cn, i.declared_name_vi, i.declared_name_en, i.hs_code, i.uom, auth.uid(), now())
    returning id into v_cat;
  end if;
  update public.order_items set status = 'da_xac_nhan', confirmed_by = auth.uid(), confirmed_at = now(), catalog_id = v_cat,
         row_version = row_version where id = i.id;
end $$;

-- Cảnh báo: cùng model nhưng HS khác lần trước
create or replace view public.order_item_warnings with (security_invoker = true) as
select i.id as item_id, i.order_id, 'hs_khac_lan_truoc'::text as warning,
       'Model ' || i.model || ' từng khai HS ' || c.hs_code || ', dòng này khai ' || coalesce(i.hs_code, '(trống)') as detail
from public.order_items i
join public.customs_catalog c on c.is_current and c.model is not null and c.model = i.model
  and (c.customer_id is null or c.customer_id = i.customer_id) and c.hs_code is distinct from i.hs_code
where i.deleted_at is null and i.model is not null
union all
select i.id, i.order_id, 'thieu_truong', 'Thiếu ' || concat_ws(', ',
       case when i.hs_code is null then 'mã HS' end, case when i.manufacturer is null then 'nhà sản xuất' end,
       case when i.unit_price_cny = 0 then 'đơn giá' end)
from public.order_items i
where i.deleted_at is null and (i.hs_code is null or i.manufacturer is null or i.unit_price_cny = 0);

-- ---------------------------------------------------------------------
-- 5. List bốc – list xe – snapshot
-- ---------------------------------------------------------------------
create sequence public.picking_code_seq;
create sequence public.trip_code_seq;

create table public.trips (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique default ('XE' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMMDD') || '-' || lpad(nextval('public.trip_code_seq')::text, 3, '0')),
  plate         text,
  border_gate   text not null default 'huu_nghi' check (border_gate in ('huu_nghi', 'tan_thanh', 'mong_cai', 'khac')),
  importer_id   uuid references public.trade_parties(id),
  exporter_id   uuid references public.trade_parties(id),
  planned_date  date,
  actual_date   date,
  status        text not null default 'nhap' check (status in ('nhap','da_chot','da_khai_bao','thong_quan','ve_vn','huy')),
  declaration_no text,
  note          text,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  updated_by uuid, deleted_at timestamptz, row_version integer not null default 1
);

create table public.picking_lists (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique default ('LB' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMMDD') || '-' || lpad(nextval('public.picking_code_seq')::text, 3, '0')),
  trip_id     uuid references public.trips(id),
  status      text not null default 'nhap' check (status in ('nhap','da_xac_nhan','huy')),
  note        text,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  updated_by uuid, deleted_at timestamptz, row_version integer not null default 1
);

create table public.picking_list_items (
  id              uuid primary key default gen_random_uuid(),
  picking_list_id uuid not null references public.picking_lists(id),
  order_item_id   uuid not null references public.order_items(id),
  qty             numeric(18,3) not null check (qty > 0),
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  unique (picking_list_id, order_item_id)
);

create table public.picking_list_packages (
  id              uuid primary key default gen_random_uuid(),
  picking_list_id uuid not null references public.picking_lists(id),
  package_id      uuid not null references public.packages(id),
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  unique (picking_list_id, package_id)
);

-- Không bốc vượt số lượng dòng khai báo (cộng mọi list bốc chưa hủy); chỉ dòng đã xác nhận
create or replace function app.tg_picking_item_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare i public.order_items; v_sum numeric; v_pl public.picking_lists;
begin
  select * into v_pl from public.picking_lists where id = new.picking_list_id;
  if v_pl.status <> 'nhap' then raise exception 'List bốc đã xác nhận/hủy, không sửa được' using errcode = '42501'; end if;
  select * into i from public.order_items where id = new.order_item_id for update;
  if i.status <> 'da_xac_nhan' then raise exception 'Dòng % chưa được XNK xác nhận khai báo', i.line_no using errcode = '23514'; end if;
  if i.compliance_status = 'khong_dat' then raise exception 'Dòng % không đạt hồ sơ chuyên ngành', i.line_no using errcode = '23514'; end if;
  select coalesce(sum(pli.qty), 0) into v_sum from public.picking_list_items pli join public.picking_lists pl on pl.id = pli.picking_list_id
   where pli.order_item_id = new.order_item_id and pl.status <> 'huy' and pli.id is distinct from new.id;
  if v_sum + new.qty > i.qty then
    raise exception 'Vượt số lượng: dòng % có %, đã bốc %, thêm %', i.line_no, i.qty, v_sum, new.qty using errcode = '23514';
  end if;
  return new;
end $$;
create trigger picking_items_guard before insert or update on public.picking_list_items for each row execute function app.tg_picking_item_guard();

-- 1 kiện chỉ thuộc 1 list bốc chưa hủy
create or replace function app.tg_picking_package_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_other text;
begin
  if (select status from public.picking_lists where id = new.picking_list_id) <> 'nhap' then
    raise exception 'List bốc đã xác nhận/hủy, không sửa được' using errcode = '42501';
  end if;
  select pl.code into v_other from public.picking_list_packages x join public.picking_lists pl on pl.id = x.picking_list_id
   where x.package_id = new.package_id and pl.status <> 'huy' and x.picking_list_id <> new.picking_list_id limit 1;
  if v_other is not null then raise exception 'Kiện đã nằm trong list bốc %', v_other using errcode = '23514'; end if;
  return new;
end $$;
create trigger picking_packages_guard before insert on public.picking_list_packages for each row execute function app.tg_picking_package_guard();

-- Tổng list bốc
create or replace view public.picking_list_totals with (security_invoker = true) as
select pl.id, pl.code, pl.status, pl.trip_id, pl.created_at,
       (select count(*) from public.picking_list_packages x where x.picking_list_id = pl.id) as packages,
       (select coalesce(sum(p.gw_kg), 0) from public.picking_list_packages x join public.packages p on p.id = x.package_id where x.picking_list_id = pl.id) as gw_kg,
       (select coalesce(sum(p.cbm), 0) from public.picking_list_packages x join public.packages p on p.id = x.package_id where x.picking_list_id = pl.id) as cbm,
       (select coalesce(sum(round(pli.qty * oi.unit_price_cny, 2)), 0) from public.picking_list_items pli join public.order_items oi on oi.id = pli.order_item_id where pli.picking_list_id = pl.id) as value_cny,
       (select count(distinct oi.order_id) from public.picking_list_items pli join public.order_items oi on oi.id = pli.order_item_id where pli.picking_list_id = pl.id) as orders
from public.picking_lists pl where pl.deleted_at is null;

-- Bộ dữ liệu chốt của chuyến xe (bản sao đóng băng, có version + mã băm)
create table public.declaration_snapshots (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips(id),
  version    integer not null,
  status     text not null default 'locked' check (status in ('locked','superseded')),
  reason     text,
  lines      jsonb not null,
  totals     jsonb not null,
  content_hash text not null,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  unique (trip_id, version)
);
create trigger declaration_snapshots_append_only before delete on public.declaration_snapshots for each row execute function app.tg_append_only();

create or replace function app.tg_snapshot_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.lines is distinct from old.lines or new.totals is distinct from old.totals or new.content_hash is distinct from old.content_hash
     or new.version is distinct from old.version or new.trip_id is distinct from old.trip_id
     or (old.status = 'superseded') then
    raise exception 'Bộ dữ liệu đã chốt không sửa được; tạo version mới' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger declaration_snapshots_immutable before update on public.declaration_snapshots for each row execute function app.tg_snapshot_immutable();

create or replace function public.lock_trip(p_trip_id uuid, p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t public.trips; v_lines jsonb; v_totals jsonb; v_ver integer; v_id uuid;
begin
  if not app.has_perm('customs.confirm') then raise exception 'Không có quyền chốt list xe' using errcode = '42501'; end if;
  select * into t from public.trips where id = p_trip_id and deleted_at is null for update;
  if not found then raise exception 'Không tìm thấy chuyến xe' using errcode = '22023'; end if;
  if exists (select 1 from public.declaration_snapshots where trip_id = t.id and status = 'locked') and coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Chốt lại phải ghi lý do' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(x order by x->>'hs_code', x->>'declared_name_vi'), '[]'::jsonb) into v_lines from (
    select jsonb_build_object(
      'order_code', o.code, 'customer_code', c.code, 'entity', e.legal_name, 'line_no', oi.line_no,
      'declared_name_vi', oi.declared_name_vi, 'declared_name_en', oi.declared_name_en, 'name_cn', oi.name_cn, 'model', oi.model,
      'hs_code', oi.hs_code, 'uom', oi.uom, 'qty', pli.qty, 'unit_price_cny', oi.unit_price_cny,
      'value_cny', round(pli.qty * oi.unit_price_cny, 2), 'origin', oi.origin, 'manufacturer', oi.manufacturer,
      'compliance_need', oi.compliance_need, 'picking_list', pl.code) as x
    from public.picking_lists pl
    join public.picking_list_items pli on pli.picking_list_id = pl.id
    join public.order_items oi on oi.id = pli.order_item_id
    join public.orders o on o.id = oi.order_id
    join public.customers c on c.id = o.customer_id
    join public.customer_entities e on e.id = o.entity_id
    where pl.trip_id = t.id and pl.status <> 'huy'
  ) s;
  if jsonb_array_length(v_lines) = 0 then raise exception 'Chuyến xe chưa có dòng hàng nào' using errcode = '22023'; end if;

  select jsonb_build_object(
    'lines', jsonb_array_length(v_lines),
    'qty', (select sum((l->>'qty')::numeric) from jsonb_array_elements(v_lines) l),
    'value_cny', (select sum((l->>'value_cny')::numeric) from jsonb_array_elements(v_lines) l),
    'packages', (select count(*) from public.picking_list_packages x join public.picking_lists pl on pl.id = x.picking_list_id where pl.trip_id = t.id and pl.status <> 'huy'),
    'gw_kg', (select coalesce(sum(p.gw_kg), 0) from public.picking_list_packages x join public.picking_lists pl on pl.id = x.picking_list_id join public.packages p on p.id = x.package_id where pl.trip_id = t.id and pl.status <> 'huy'),
    'cbm', (select coalesce(sum(p.cbm), 0) from public.picking_list_packages x join public.picking_lists pl on pl.id = x.picking_list_id join public.packages p on p.id = x.package_id where pl.trip_id = t.id and pl.status <> 'huy'),
    'importer', (select code from public.trade_parties where id = t.importer_id),
    'exporter', (select legal_name from public.trade_parties where id = t.exporter_id),
    'plate', t.plate, 'trip', t.code) into v_totals;

  update public.declaration_snapshots set status = 'superseded' where trip_id = t.id and status = 'locked';
  select coalesce(max(version), 0) + 1 into v_ver from public.declaration_snapshots where trip_id = t.id;
  insert into public.declaration_snapshots (trip_id, version, reason, lines, totals, content_hash)
  values (t.id, v_ver, p_reason, v_lines, v_totals, encode(extensions.digest(v_lines::text || v_totals::text, 'sha256'), 'hex'))
  returning id into v_id;
  update public.picking_lists set status = 'da_xac_nhan', row_version = row_version where trip_id = t.id and status = 'nhap';
  update public.trips set status = 'da_chot', row_version = row_version where id = t.id and status = 'nhap';
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 6. Trigger chuẩn, nhật ký, quyền, RLS
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['packages', 'order_items', 'trips', 'picking_lists'] loop
    execute format('create trigger %I_std before insert or update on public.%I for each row execute function app.tg_standard_columns()', t, t);
    execute format('create trigger %I_no_delete before delete on public.%I for each row execute function app.tg_block_hard_delete()', t, t);
  end loop;
  foreach t in array array['packages', 'order_items', 'customs_catalog', 'trips', 'picking_lists', 'picking_list_items', 'picking_list_packages', 'declaration_snapshots'] loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function audit.tg_log_change()', t, t);
  end loop;
end $$;

revoke all on public.warehouses, public.packages, public.package_events, public.package_labels, public.customs_catalog,
              public.order_items, public.order_item_warnings, public.trips, public.picking_lists, public.picking_list_items,
              public.picking_list_packages, public.picking_list_totals, public.declaration_snapshots from anon, authenticated;
grant select on public.warehouses, public.packages, public.package_events, public.package_labels, public.customs_catalog,
              public.order_items, public.order_item_warnings, public.trips, public.picking_lists, public.picking_list_items,
              public.picking_list_packages, public.picking_list_totals, public.declaration_snapshots to authenticated;
grant insert, update on public.packages, public.order_items, public.trips, public.picking_lists to authenticated;
grant insert on public.customs_catalog, public.picking_list_items, public.picking_list_packages to authenticated;
grant delete on public.picking_list_items, public.picking_list_packages to authenticated;
grant usage on sequence public.picking_code_seq, public.trip_code_seq to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
revoke all on function public.confirm_order_item(uuid), public.lock_trip(uuid, text) from public, anon;
grant execute on function public.confirm_order_item(uuid), public.lock_trip(uuid, text) to authenticated;

alter table public.warehouses enable row level security;
alter table public.packages enable row level security;
alter table public.package_events enable row level security;
alter table public.customs_catalog enable row level security;
alter table public.order_items enable row level security;
alter table public.trips enable row level security;
alter table public.picking_lists enable row level security;
alter table public.picking_list_items enable row level security;
alter table public.picking_list_packages enable row level security;
alter table public.declaration_snapshots enable row level security;

create policy warehouses_select on public.warehouses for select to authenticated using (app.is_active_user());

-- Kiện, dòng khai báo: khách xem theo công ty; nhân viên theo phạm vi
create policy packages_select on public.packages for select to authenticated
  using (deleted_at is null and app.can_see_entity(customer_id, entity_id));
create policy packages_insert on public.packages for insert to authenticated
  with check (app.has_perm('warehouse.write') and exists (select 1 from public.orders o where o.id = order_id and app.staff_can_see_customer(o.customer_id)));
create policy packages_update on public.packages for update to authenticated
  using (app.has_perm('warehouse.write') and app.staff_can_see_customer(customer_id))
  with check (app.has_perm('warehouse.write') and app.staff_can_see_customer(customer_id));
create policy package_events_select on public.package_events for select to authenticated
  using (exists (select 1 from public.packages p where p.id = package_id));

create policy order_items_select on public.order_items for select to authenticated
  using (deleted_at is null and app.can_see_entity(customer_id, entity_id));
create policy order_items_insert on public.order_items for insert to authenticated
  with check (app.has_perm('customs.write') and exists (select 1 from public.orders o where o.id = order_id and app.staff_can_see_customer(o.customer_id)));
create policy order_items_update on public.order_items for update to authenticated
  using (app.has_perm('customs.write') and app.staff_can_see_customer(customer_id))
  with check (app.has_perm('customs.write') and app.staff_can_see_customer(customer_id));

-- Thư viện, list bốc, list xe, snapshot: chỉ nhân viên
create policy catalog_select on public.customs_catalog for select to authenticated
  using (app.is_staff() and (customer_id is null or app.staff_can_see_customer(customer_id)));
create policy catalog_insert on public.customs_catalog for insert to authenticated with check (app.has_perm('customs.confirm'));

create policy trips_select on public.trips for select to authenticated using (app.is_staff() and deleted_at is null);
create policy trips_insert on public.trips for insert to authenticated with check (app.has_perm('logistics.write'));
create policy trips_update on public.trips for update to authenticated using (app.has_perm('logistics.write')) with check (app.has_perm('logistics.write'));
create policy pl_select on public.picking_lists for select to authenticated using (app.is_staff() and deleted_at is null);
create policy pl_insert on public.picking_lists for insert to authenticated with check (app.has_perm('logistics.write'));
create policy pl_update on public.picking_lists for update to authenticated using (app.has_perm('logistics.write')) with check (app.has_perm('logistics.write'));
create policy pli_select on public.picking_list_items for select to authenticated using (app.is_staff());
create policy pli_insert on public.picking_list_items for insert to authenticated with check (app.has_perm('logistics.write'));
create policy pli_delete on public.picking_list_items for delete to authenticated
  using (app.has_perm('logistics.write') and (select status from public.picking_lists where id = picking_list_id) = 'nhap');
create policy plp_select on public.picking_list_packages for select to authenticated using (app.is_staff());
create policy plp_insert on public.picking_list_packages for insert to authenticated with check (app.has_perm('logistics.write'));
create policy plp_delete on public.picking_list_packages for delete to authenticated
  using (app.has_perm('logistics.write') and (select status from public.picking_lists where id = picking_list_id) = 'nhap');
create policy snapshots_select on public.declaration_snapshots for select to authenticated using (app.is_staff());
