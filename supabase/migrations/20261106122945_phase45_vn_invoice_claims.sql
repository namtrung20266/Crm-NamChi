-- =====================================================================
-- NAMCHI ERP – Giai đoạn 4: Kho Việt Nam (kiểm đếm 2 tầng, phiếu giao nhiều đợt)
--             Giai đoạn 5: HĐ đầu vào theo Mã HH, HĐ bán nhiều đợt, tồn HĐ,
--             khiếu nại, credit note (bồi thường / xử lý chênh / hàng mẫu).
-- Quy tắc cứng: giao không vượt số đã về VN; HĐ bán không vượt HĐ đầu vào và
-- chỉ dòng đã đạt/không cần hồ sơ chuyên ngành; credit note phải duyệt mới trừ công nợ.
-- =====================================================================

insert into public.permissions (code, module, description) values
  ('invoice.write',    'invoice', 'Nhập HĐ đầu vào, lập/xuất HĐ bán'),
  ('claim.write',      'claim',   'Tiếp nhận, xử lý khiếu nại'),
  ('claim.create_own', 'claim',   'Khách tạo khiếu nại cho công ty mình'),
  ('credit.approve',   'finance', 'Duyệt credit note (bồi thường, xử lý chênh)')
on conflict (code) do nothing;
with m(role_code, perm_code) as (values
  ('admin','invoice.write'), ('admin','claim.write'), ('admin','credit.approve'),
  ('accountant','invoice.write'), ('accountant','claim.write'), ('accountant','credit.approve'),
  ('cs','claim.write'), ('manager','claim.write'), ('warehouse_vn','claim.write'),
  ('cust_admin','claim.create_own'), ('cust_member','claim.create_own')
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from m join public.roles r on r.code = m.role_code join public.permissions p on p.code = m.perm_code
on conflict do nothing;

-- =====================================================================
-- GIAI ĐOẠN 4
-- =====================================================================

-- Đối chiếu theo xe: kiện trên list bốc vs đã về VN
create or replace view public.trip_package_check with (security_invoker = true) as
select pl.trip_id, p.order_id, o.code as order_code, e.legal_name as entity,
       count(*) as expected, count(*) filter (where p.status in ('ve_vn','da_giao')) as received,
       count(*) filter (where p.status in ('thieu')) as missing,
       count(*) filter (where p.status in ('hong','sai_hang')) as problem
from public.picking_lists pl
join public.picking_list_packages x on x.picking_list_id = pl.id
join public.packages p on p.id = x.package_id
join public.orders o on o.id = p.order_id
join public.customer_entities e on e.id = o.entity_id
where pl.status <> 'huy'
group by pl.trip_id, p.order_id, o.code, e.legal_name;

-- Tầng nhanh: xe về đủ → đánh dấu mọi kiện trên xe đã về VN, chuyển đơn sang "Đã về kho VN"
create or replace function public.receive_trip(p_trip_id uuid, p_counted integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_expected integer; v_vn uuid; v_n integer;
begin
  if not app.has_perm('warehouse.write') then raise exception 'Không có quyền kho' using errcode = '42501'; end if;
  select count(*) into v_expected from public.picking_lists pl join public.picking_list_packages x on x.picking_list_id = pl.id
   where pl.trip_id = p_trip_id and pl.status <> 'huy';
  if v_expected = 0 then raise exception 'Xe chưa có kiện nào trên list bốc' using errcode = '22023'; end if;
  if p_counted <> v_expected then
    return jsonb_build_object('ok', false, 'expected', v_expected, 'counted', p_counted,
      'message', 'Lệch số kiện: cần kiểm từng kiện theo đơn');
  end if;
  select id into v_vn from public.warehouses where code = 'VN';
  update public.packages p set status = 've_vn', warehouse_id = v_vn, row_version = p.row_version
   where p.id in (select x.package_id from public.picking_lists pl join public.picking_list_packages x on x.picking_list_id = pl.id
                  where pl.trip_id = p_trip_id and pl.status <> 'huy')
     and p.status not in ('da_giao');
  get diagnostics v_n = row_count;
  update public.orders o set status = 've_kho_vn', vn_received_at = current_date, row_version = o.row_version
   where o.id in (select distinct p.order_id from public.picking_lists pl join public.picking_list_packages x on x.picking_list_id = pl.id
                  join public.packages p on p.id = x.package_id where pl.trip_id = p_trip_id and pl.status <> 'huy')
     and o.status in ('dang_mua','cho_shop_giao','shop_da_phat','ve_kho_qc','ve_bang_tuong','tren_xe');
  update public.trips set status = 've_vn', actual_date = coalesce(actual_date, current_date), row_version = row_version where id = p_trip_id;
  return jsonb_build_object('ok', true, 'expected', v_expected, 'counted', p_counted, 'updated', v_n);
end $$;

-- Số lượng mỗi dòng hàng đã về VN (theo xe đã về) và đã giao
create sequence public.goods_issue_seq;
create table public.goods_issues (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique default ('PX' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMMDD') || '-' || lpad(nextval('public.goods_issue_seq')::text, 3, '0')),
  order_id      uuid not null references public.orders(id),
  customer_id   uuid not null,
  entity_id     uuid not null,
  packages      integer not null default 0 check (packages >= 0),
  deliverer     text,
  receiver_name text,
  receiver_phone text,
  status        text not null default 'nhap' check (status in ('nhap','da_giao','huy')),
  delivered_at  timestamptz,
  note          text,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  updated_by uuid, deleted_at timestamptz, row_version integer not null default 1
);
create table public.goods_issue_lines (
  id             uuid primary key default gen_random_uuid(),
  goods_issue_id uuid not null references public.goods_issues(id),
  order_item_id  uuid not null references public.order_items(id),
  qty            numeric(18,3) not null check (qty > 0),
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  unique (goods_issue_id, order_item_id)
);

create or replace view public.item_flow with (security_invoker = true) as
select i.id as order_item_id, i.order_id, i.customer_id, i.entity_id, i.line_no, i.declared_name_vi, i.hs_code, i.uom, i.qty,
       i.compliance_need, i.compliance_status,
       coalesce((select sum(pli.qty) from public.picking_list_items pli join public.picking_lists pl on pl.id = pli.picking_list_id
                 join public.trips t on t.id = pl.trip_id where pli.order_item_id = i.id and pl.status <> 'huy' and t.status = 've_vn'), 0) as arrived_qty,
       coalesce((select sum(gl.qty) from public.goods_issue_lines gl join public.goods_issues g on g.id = gl.goods_issue_id
                 where gl.order_item_id = i.id and g.status <> 'huy'), 0) as issued_qty
from public.order_items i where i.deleted_at is null;

create or replace function app.tg_goods_issue_line_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare g public.goods_issues; f record;
begin
  select * into g from public.goods_issues where id = new.goods_issue_id;
  if g.status <> 'nhap' then raise exception 'Phiếu đã giao/hủy, không sửa được' using errcode = '42501'; end if;
  select * into f from public.item_flow where order_item_id = new.order_item_id;
  if f.order_id <> g.order_id then raise exception 'Dòng hàng không thuộc đơn của phiếu' using errcode = '23514'; end if;
  perform 1 from public.order_items where id = new.order_item_id for update;
  if f.issued_qty + new.qty > f.arrived_qty then
    raise exception 'Vượt số đã về VN: đã về %, đã giao %, giao thêm %', f.arrived_qty, f.issued_qty, new.qty using errcode = '23514';
  end if;
  return new;
end $$;
create trigger goods_issue_lines_guard before insert on public.goods_issue_lines for each row execute function app.tg_goods_issue_line_guard();

create or replace function app.tg_goods_issue_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = new.order_id;
  new.customer_id := o.customer_id; new.entity_id := o.entity_id;
  if tg_op = 'UPDATE' and new.status = 'da_giao' and old.status <> 'da_giao' then new.delivered_at := now(); end if;
  return new;
end $$;
create trigger goods_issues_defaults before insert or update on public.goods_issues for each row execute function app.tg_goods_issue_defaults();

-- =====================================================================
-- GIAI ĐOẠN 5 – HÓA ĐƠN
-- =====================================================================
create table public.purchase_invoices (
  id            uuid primary key default gen_random_uuid(),
  seller_id     uuid not null references public.trade_parties(id),
  invoice_no    text not null,
  invoice_date  date not null,
  note          text,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  updated_by uuid, deleted_at timestamptz, row_version integer not null default 1,
  unique (seller_id, invoice_no)
);
create table public.purchase_invoice_lines (
  id                  uuid primary key default gen_random_uuid(),
  purchase_invoice_id uuid not null references public.purchase_invoices(id),
  order_item_id       uuid not null references public.order_items(id),
  hh_code             text,                                  -- Mã HH trên HĐ đầu vào
  description         text not null,
  uom                 text not null,
  qty                 numeric(18,3) not null check (qty > 0),
  unit_price_vnd      numeric(18,2) not null check (unit_price_vnd >= 0),
  amount_vnd          bigint not null check (amount_vnd >= 0),
  vat_rate            numeric(5,2) not null check (vat_rate between 0 and 20),
  vat_vnd             bigint not null check (vat_vnd >= 0),
  created_at timestamptz not null default now(), created_by uuid default auth.uid()
);
create index pil_item_idx on public.purchase_invoice_lines(order_item_id);

create sequence public.sales_invoice_seq;
create table public.sales_invoices (
  id            uuid primary key default gen_random_uuid(),
  draft_code    text not null unique default ('HDB' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMM') || '-' || lpad(nextval('public.sales_invoice_seq')::text, 4, '0')),
  customer_id   uuid not null references public.customers(id),
  entity_id     uuid not null,
  batch_label   text,                                       -- L1, L2…
  invoice_no    text,                                       -- số HĐ sau khi phát hành trên MISA
  invoice_date  date,
  payment_method text not null default 'TM/CK',
  status        text not null default 'nhap' check (status in ('nhap','da_xuat_file','da_phat_hanh','huy')),
  note          text,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  updated_by uuid, deleted_at timestamptz, row_version integer not null default 1,
  foreign key (customer_id, entity_id) references public.customer_entities(customer_id, id),
  check (status <> 'da_phat_hanh' or (invoice_no is not null and invoice_date is not null))
);
create table public.sales_invoice_lines (
  id               uuid primary key default gen_random_uuid(),
  sales_invoice_id uuid not null references public.sales_invoices(id),
  order_item_id    uuid not null references public.order_items(id),
  customer_id      uuid not null,
  entity_id        uuid not null,
  hh_code          text,
  description      text not null,
  uom              text not null,
  qty              numeric(18,3) not null check (qty > 0),
  unit_price_vnd   numeric(18,2) not null check (unit_price_vnd >= 0),
  amount_vnd       bigint not null check (amount_vnd >= 0),
  vat_rate         numeric(5,2) not null check (vat_rate between 0 and 20),
  vat_vnd          bigint not null check (vat_vnd >= 0),
  created_at timestamptz not null default now(), created_by uuid default auth.uid()
);
create index sil_item_idx on public.sales_invoice_lines(order_item_id);

-- Tồn hóa đơn theo dòng hàng
create or replace view public.invoice_stock with (security_invoker = true) as
select i.id as order_item_id, i.order_id, i.customer_id, i.entity_id, i.line_no, i.declared_name_vi, i.uom, i.qty,
       i.compliance_need, i.compliance_status,
       coalesce((select sum(l.qty) from public.purchase_invoice_lines l join public.purchase_invoices p on p.id = l.purchase_invoice_id
                 where l.order_item_id = i.id and p.deleted_at is null), 0) as purchased_qty,
       coalesce((select sum(l.qty) from public.sales_invoice_lines l join public.sales_invoices s on s.id = l.sales_invoice_id
                 where l.order_item_id = i.id and s.status <> 'huy'), 0) as sold_qty,
       (select max(l.hh_code) from public.purchase_invoice_lines l where l.order_item_id = i.id) as hh_code,
       (select max(l.vat_rate) from public.purchase_invoice_lines l where l.order_item_id = i.id) as vat_rate,
       (i.compliance_status in ('khong_can', 'dat')) as compliance_ok
from public.order_items i where i.deleted_at is null;

create or replace function app.tg_sales_line_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare s public.sales_invoices; st record;
begin
  select * into s from public.sales_invoices where id = new.sales_invoice_id;
  if s.status <> 'nhap' then raise exception 'HĐ đã xuất file/phát hành, không sửa dòng' using errcode = '42501'; end if;
  perform 1 from public.order_items where id = new.order_item_id for update;
  select * into st from public.invoice_stock where order_item_id = new.order_item_id;
  if st.entity_id <> s.entity_id then raise exception 'Dòng hàng không thuộc công ty nhận HĐ này' using errcode = '23514'; end if;
  if not st.compliance_ok then raise exception 'Dòng % chưa xong hồ sơ chuyên ngành, chưa được xuất HĐ', st.line_no using errcode = '23514'; end if;
  if st.sold_qty + new.qty > st.purchased_qty then
    raise exception 'Vượt HĐ đầu vào: đầu vào %, đã xuất %, xuất thêm %', st.purchased_qty, st.sold_qty, new.qty using errcode = '23514';
  end if;
  new.customer_id := s.customer_id; new.entity_id := s.entity_id;
  return new;
end $$;
create trigger sales_lines_guard before insert on public.sales_invoice_lines for each row execute function app.tg_sales_line_guard();
create trigger sales_lines_append_only before update on public.sales_invoice_lines for each row execute function app.tg_append_only();
create trigger purchase_lines_append_only before update on public.purchase_invoice_lines for each row execute function app.tg_append_only();

-- =====================================================================
-- GIAI ĐOẠN 5 – KHIẾU NẠI & CREDIT NOTE
-- =====================================================================
create sequence public.claim_seq;
create table public.claims (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique default ('KN' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMM') || '-' || lpad(nextval('public.claim_seq')::text, 4, '0')),
  customer_id   uuid not null,
  entity_id     uuid not null,
  order_id      uuid not null references public.orders(id),
  order_item_id uuid references public.order_items(id),
  claim_type    text not null check (claim_type in ('thieu','hong','sai_hang','cham','chat_luong','khac')),
  description   text not null,
  requested_vnd bigint check (requested_vnd >= 0),
  status        text not null default 'moi' check (status in ('moi','dang_xac_minh','cho_ncc','cho_khach','cho_boi_thuong','da_giai_quyet','dong','tu_choi')),
  assignee_id   uuid references public.profiles(user_id),
  due_date      date default (current_date + 7),
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  updated_by uuid, deleted_at timestamptz, row_version integer not null default 1
);
create table public.claim_messages (
  id         bigint generated always as identity primary key,
  claim_id   uuid not null references public.claims(id),
  body       text not null check (length(trim(body)) > 0),
  internal   boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create trigger claim_messages_append_only before update or delete on public.claim_messages for each row execute function app.tg_append_only();

create or replace function app.tg_claims_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = new.order_id;
  new.customer_id := o.customer_id; new.entity_id := o.entity_id;
  if tg_op = 'INSERT' and auth.uid() is not null and not app.is_staff() then
    new.status := 'moi'; new.assignee_id := null;
  end if;
  if tg_op = 'UPDATE' and auth.uid() is not null and not app.is_staff() then
    raise exception 'Khách trao đổi qua tin nhắn, không sửa khiếu nại' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger claims_defaults before insert or update on public.claims for each row execute function app.tg_claims_defaults();

create table public.credit_notes (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id),
  customer_id  uuid not null,
  entity_id    uuid not null,
  claim_id     uuid references public.claims(id),
  kind         text not null check (kind in ('boi_thuong','xu_ly_chenh','ho_tro_hang_mau','khac')),
  amount_vnd   bigint not null check (amount_vnd <> 0),   -- dương = giảm phải thu của khách
  reason       text not null check (length(trim(reason)) >= 5),
  status       text not null default 'nhap' check (status in ('nhap','da_duyet','huy')),
  approved_by  uuid, approved_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid default auth.uid()
);
create or replace function app.tg_credit_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = new.order_id;
  new.customer_id := o.customer_id; new.entity_id := o.entity_id;
  if tg_op = 'INSERT' then new.status := 'nhap'; new.approved_by := null; new.approved_at := null; end if;
  if tg_op = 'UPDATE' and (new.amount_vnd, new.order_id, new.kind) is distinct from (old.amount_vnd, old.order_id, old.kind) then
    raise exception 'Credit note không sửa số tiền; hủy và lập lại' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.status <> 'nhap' then raise exception 'Credit note đã duyệt/hủy' using errcode = '42501'; end if;
  return new;
end $$;
create trigger credit_notes_defaults before insert or update on public.credit_notes for each row execute function app.tg_credit_defaults();

-- Duyệt: dưới ngưỡng cài đặt → kế toán; trên ngưỡng → cần finance.ledger.edit (Admin)
create or replace function public.approve_credit_note(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.credit_notes; v_thr bigint;
begin
  if not app.has_perm('credit.approve') then raise exception 'Không có quyền duyệt' using errcode = '42501'; end if;
  select * into c from public.credit_notes where id = p_id for update;
  if not found or c.status <> 'nhap' then raise exception 'Credit note không ở trạng thái chờ duyệt' using errcode = '22023'; end if;
  if c.created_by = auth.uid() then raise exception 'Người lập không tự duyệt' using errcode = '42501'; end if;
  select (value_json)::text::bigint into v_thr from public.app_settings where key = 'finance.writeoff_threshold_vnd' and valid_to is null;
  if abs(c.amount_vnd) > coalesce(v_thr, 50000) and not app.has_perm('finance.ledger.edit') then
    raise exception 'Vượt ngưỡng %đ, cần Admin duyệt', coalesce(v_thr, 50000) using errcode = '42501';
  end if;
  update public.credit_notes set status = 'da_duyet', approved_by = auth.uid(), approved_at = now() where id = c.id;
end $$;

-- Công nợ đơn tính cả credit note đã duyệt
create or replace view public.order_finance with (security_invoker = true) as
select o.id as order_id, o.code, o.customer_id, o.entity_id, o.status, o.created_at,
       s.id as statement_id, s.kind as statement_kind, s.status as statement_status, s.version,
       coalesce(s.total_vnd, 0) as total_vnd, coalesce(s.deposit_vnd, 0) as deposit_vnd,
       coalesce((select sum(a.amount_vnd) from public.receipt_allocations a where a.order_id = o.id), 0)::bigint as paid_vnd,
       coalesce(s.total_vnd, 0)
         - coalesce((select sum(a.amount_vnd) from public.receipt_allocations a where a.order_id = o.id), 0)::bigint
         - coalesce((select sum(c.amount_vnd) from public.credit_notes c where c.order_id = o.id and c.status = 'da_duyet'), 0)::bigint as remaining_vnd,
       coalesce((select sum(c.amount_vnd) from public.credit_notes c where c.order_id = o.id and c.status = 'da_duyet'), 0)::bigint as credit_vnd
from public.orders o
left join lateral (
  select * from public.order_statements st where st.order_id = o.id and st.status <> 'superseded' order by st.version desc limit 1
) s on true
where o.deleted_at is null;

-- =====================================================================
-- Trigger chuẩn, nhật ký, quyền, RLS
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['goods_issues', 'purchase_invoices', 'sales_invoices', 'claims'] loop
    execute format('create trigger %I_std before insert or update on public.%I for each row execute function app.tg_standard_columns()', t, t);
    execute format('create trigger %I_no_delete before delete on public.%I for each row execute function app.tg_block_hard_delete()', t, t);
  end loop;
  foreach t in array array['goods_issues', 'goods_issue_lines', 'purchase_invoices', 'purchase_invoice_lines', 'sales_invoices',
                           'sales_invoice_lines', 'claims', 'claim_messages', 'credit_notes'] loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function audit.tg_log_change()', t, t);
  end loop;
end $$;
create trigger credit_notes_no_delete before delete on public.credit_notes for each row execute function app.tg_block_hard_delete();

revoke all on public.goods_issues, public.goods_issue_lines, public.item_flow, public.trip_package_check, public.purchase_invoices,
              public.purchase_invoice_lines, public.sales_invoices, public.sales_invoice_lines, public.invoice_stock,
              public.claims, public.claim_messages, public.credit_notes, public.order_finance from anon, authenticated;
grant select on public.goods_issues, public.goods_issue_lines, public.item_flow, public.trip_package_check, public.purchase_invoices,
              public.purchase_invoice_lines, public.sales_invoices, public.sales_invoice_lines, public.invoice_stock,
              public.claims, public.claim_messages, public.credit_notes, public.order_finance to authenticated;
grant insert, update on public.goods_issues, public.purchase_invoices, public.sales_invoices, public.claims, public.credit_notes to authenticated;
grant insert on public.goods_issue_lines, public.purchase_invoice_lines, public.sales_invoice_lines, public.claim_messages to authenticated;
grant delete on public.goods_issue_lines to authenticated;
grant usage on sequence public.goods_issue_seq, public.sales_invoice_seq, public.claim_seq to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
revoke all on function public.receive_trip(uuid, integer), public.approve_credit_note(uuid) from public, anon;
grant execute on function public.receive_trip(uuid, integer), public.approve_credit_note(uuid) to authenticated;

alter table public.goods_issues enable row level security;
alter table public.goods_issue_lines enable row level security;
alter table public.purchase_invoices enable row level security;
alter table public.purchase_invoice_lines enable row level security;
alter table public.sales_invoices enable row level security;
alter table public.sales_invoice_lines enable row level security;
alter table public.claims enable row level security;
alter table public.claim_messages enable row level security;
alter table public.credit_notes enable row level security;

-- Phiếu giao: khách xem phiếu của công ty mình
create policy gi_select on public.goods_issues for select to authenticated using (deleted_at is null and app.can_see_entity(customer_id, entity_id));
create policy gi_insert on public.goods_issues for insert to authenticated
  with check (app.has_perm('warehouse.write') and exists (select 1 from public.orders o where o.id = order_id and app.staff_can_see_customer(o.customer_id)));
create policy gi_update on public.goods_issues for update to authenticated
  using (app.has_perm('warehouse.write') and app.staff_can_see_customer(customer_id)) with check (app.has_perm('warehouse.write'));
create policy gil_select on public.goods_issue_lines for select to authenticated using (exists (select 1 from public.goods_issues g where g.id = goods_issue_id));
create policy gil_insert on public.goods_issue_lines for insert to authenticated with check (app.has_perm('warehouse.write'));
create policy gil_delete on public.goods_issue_lines for delete to authenticated
  using (app.has_perm('warehouse.write') and (select status from public.goods_issues where id = goods_issue_id) = 'nhap');

-- HĐ đầu vào: nội bộ (giá vốn); HĐ bán: khách xem của công ty mình
create policy pi_select on public.purchase_invoices for select to authenticated using (app.is_staff() and app.has_perm('finance.read') and deleted_at is null);
create policy pi_insert on public.purchase_invoices for insert to authenticated with check (app.has_perm('invoice.write'));
create policy pi_update on public.purchase_invoices for update to authenticated using (app.has_perm('invoice.write')) with check (app.has_perm('invoice.write'));
create policy pil_select on public.purchase_invoice_lines for select to authenticated using (app.is_staff() and app.has_perm('finance.read'));
create policy pil_insert on public.purchase_invoice_lines for insert to authenticated with check (app.has_perm('invoice.write'));

create policy si_select on public.sales_invoices for select to authenticated using (
  deleted_at is null and ((app.is_staff() and app.has_perm('finance.read') and app.staff_can_see_customer(customer_id))
                          or (not app.is_staff() and status = 'da_phat_hanh' and app.can_see_entity(customer_id, entity_id))));
create policy si_insert on public.sales_invoices for insert to authenticated with check (app.has_perm('invoice.write'));
create policy si_update on public.sales_invoices for update to authenticated using (app.has_perm('invoice.write')) with check (app.has_perm('invoice.write'));
create policy sil_select on public.sales_invoice_lines for select to authenticated using (exists (select 1 from public.sales_invoices s where s.id = sales_invoice_id));
create policy sil_insert on public.sales_invoice_lines for insert to authenticated with check (app.has_perm('invoice.write'));

-- Khiếu nại: khách tạo/xem của công ty mình; tin nhắn nội bộ ẩn với khách
create policy claims_select on public.claims for select to authenticated using (deleted_at is null and app.can_see_entity(customer_id, entity_id));
create policy claims_insert on public.claims for insert to authenticated with check (
  (app.has_perm('claim.write') and exists (select 1 from public.orders o where o.id = order_id and app.staff_can_see_customer(o.customer_id)))
  or (app.has_perm('claim.create_own') and exists (select 1 from public.orders o where o.id = order_id and app.can_see_entity(o.customer_id, o.entity_id))));
create policy claims_update on public.claims for update to authenticated
  using (app.has_perm('claim.write') and app.staff_can_see_customer(customer_id)) with check (app.has_perm('claim.write'));
create policy cm_select on public.claim_messages for select to authenticated using (
  exists (select 1 from public.claims c where c.id = claim_id) and (not internal or app.is_staff()));
create policy cm_insert on public.claim_messages for insert to authenticated with check (
  exists (select 1 from public.claims c where c.id = claim_id) and (not internal or app.is_staff())
  and (app.has_perm('claim.write') or app.has_perm('claim.create_own')));

create policy cn_select on public.credit_notes for select to authenticated using (
  (app.is_staff() and app.has_perm('finance.read') and app.staff_can_see_customer(customer_id))
  or (not app.is_staff() and status = 'da_duyet' and app.can_see_entity(customer_id, entity_id)));
create policy cn_insert on public.credit_notes for insert to authenticated
  with check (app.has_perm('finance.statement.write') or app.has_perm('claim.write'));
-- chỉ được HỦY trực tiếp; DUYỆT phải qua approve_credit_note() (kiểm ngưỡng + người lập không tự duyệt)
create policy cn_update on public.credit_notes for update to authenticated
  using (app.has_perm('credit.approve') or created_by = (select auth.uid())) with check (status = 'huy');
