-- NAMCHI ERP – vòng 4 (08/11/2026): loại HĐ TQ có thuế suất cấu hình được, biểu phí theo công ty con,
-- bàn khai báo (trạng thái, phân bổ cân nặng, lập list bốc), phiếu giao nhiều đơn, dọn dữ liệu cho gói Free

-- 1. Loại hóa đơn Trung Quốc (Cấu hình → Danh mục): thuế suất, nhóm gốc
insert into public.lookup_values (category, code, label, sort_order, meta) values
  ('china_invoice_kind','hdpt_0','HĐ phổ thông 0%',10,'{"base":"HDPT","rate":0}'),
  ('china_invoice_kind','hdpt_1','HĐ phổ thông 1%',20,'{"base":"HDPT","rate":1}'),
  ('china_invoice_kind','hdpt_2','HĐ phổ thông 2%',30,'{"base":"HDPT","rate":2}'),
  ('china_invoice_kind','hdcd','HĐ chuyên dụng',40,'{"base":"HDCD","rate":13,"has_base":true,"payer_choice":true}'),
  ('china_invoice_kind','khd','Không hóa đơn',50,'{"base":"KHD","rate":0}'),
  ('desk_status','moi','Mới vào bàn',10,'{"tone":"neutral"}'),
  ('desk_status','can_bo_sung','Cần bổ sung thông tin',20,'{"tone":"danger"}'),
  ('desk_status','dang_xu_ly','Đang xử lý',30,'{"tone":"info"}'),
  ('desk_status','cho_ho_so','Chờ hồ sơ chuyên ngành',40,'{"tone":"warn"}'),
  ('desk_status','san_sang','Sẵn sàng (đã chốt)',50,'{"tone":"ok"}'),
  ('desk_status','da_len_list','Đã lên list bốc',60,'{"tone":"brand"}'),
  ('desk_status','da_khai','Đã khai tờ khai',70,'{"tone":"ok"}')
on conflict (category, code) do nothing;
insert into public.app_settings (key, value_json, note) values
  ('customs.weight_alloc_basis', '"value"', 'Phân bổ cân nặng kiện xuống dòng khai báo: "value" theo trị giá, "qty" theo số lượng')
on conflict do nothing;

alter table public.orders
  add column if not exists china_invoice_kind text,
  add column if not exists china_tax_rate numeric(6,3),
  add column if not exists china_tax_base_cny numeric(18,2),
  add column if not exists china_tax_payer text not null default 'cong_ty' check (china_tax_payer in ('cong_ty','khach'));
comment on column public.orders.china_tax_base_cny is 'Mốc tiền tính thuế xuất HĐ TQ (trống = tiền hàng)';
comment on column public.orders.china_tax_payer is 'cong_ty = Nam Trung trả NCC/tạm ứng (thu lại khách); khach = khách tự trả NCC';
update public.orders set china_invoice_kind = case china_invoice_type when 'HDCD' then 'hdcd' when 'KHD' then 'khd' else 'hdpt_1' end where china_invoice_kind is null;

-- Tự tính thuế xuất HĐ TQ theo loại HĐ đã chọn
create or replace function app.tg_orders_china_tax()
returns trigger language plpgsql security definer set search_path = '' as $$
declare m jsonb;
begin
  if new.china_invoice_kind is null then return new; end if;
  select meta into m from public.lookup_values where category = 'china_invoice_kind' and code = new.china_invoice_kind;
  if m is null then raise exception 'Loại hóa đơn TQ không có trong danh mục' using errcode = '23514'; end if;
  new.china_invoice_type := coalesce(m ->> 'base', new.china_invoice_type);
  if tg_op = 'INSERT' or new.china_invoice_kind is distinct from old.china_invoice_kind or new.china_tax_rate is null then
    new.china_tax_rate := coalesce((m ->> 'rate')::numeric, 0);
  end if;
  if not coalesce((m ->> 'has_base')::boolean, false) then new.china_tax_base_cny := null; end if;
  if not coalesce((m ->> 'payer_choice')::boolean, false) then new.china_tax_payer := 'cong_ty'; end if;
  new.china_tax_cny := round(coalesce(new.china_tax_base_cny, new.goods_cny) * coalesce(new.china_tax_rate, 0) / 100, 2);
  return new;
end $$;
create trigger orders_ztax before insert or update on public.orders for each row execute function app.tg_orders_china_tax();

-- 2. Biểu phí theo công ty con (ưu tiên: công ty con > khách tổng > mặc định)
alter table public.fee_rules add column if not exists entity_id uuid references public.customer_entities(id);
create or replace function app.pick_rule_e(p_fee uuid, p_customer uuid, p_entity uuid, p_inv text, p_group text, p_at timestamptz)
returns public.fee_rules language sql stable security definer set search_path = '' as $$
  select r.* from public.fee_rules r
  where r.fee_type_id = p_fee
    and (r.customer_id is null or r.customer_id = p_customer)
    and (r.entity_id is null or r.entity_id = p_entity)
    and (r.china_invoice_type is null or r.china_invoice_type = p_inv)
    and (r.goods_group is null or r.goods_group = p_group)
    and r.valid_from <= p_at and (r.valid_to is null or r.valid_to > p_at)
  order by (r.entity_id is not null) desc, (r.customer_id is not null) desc, (r.china_invoice_type is not null) desc, (r.goods_group is not null) desc, r.valid_from desc
  limit 1;
$$;
revoke all on function app.pick_rule_e(uuid, uuid, uuid, text, text, timestamptz) from public;
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
if not app.has_perm('finance.statement.write') and coalesce(current_setting('app.sys', true), '') <> 'on' then
raise exception 'Không có quyền lập phiếu tính tiền' using errcode = '42501';
end if;
if p_kind not in ('du_tinh', 'tam_tinh', 'quyet_toan') then
raise exception 'Loại phiếu không hợp lệ' using errcode = '22023';
end if;
select * into o from public.orders where id = p_order_id and deleted_at is null for update;
if not found or (not app.staff_can_see_customer(o.customer_id) and coalesce(current_setting('app.sys', true), '') <> 'on') then
raise exception 'Không tìm thấy đơn' using errcode = '42501';
end if;
select id into v_prev from public.order_statements where order_id = o.id and status <> 'superseded' order by version desc limit 1;
update public.order_statements set status = 'superseded' where order_id = o.id and status <> 'superseded';
select coalesce(max(version), 0) + 1 into v_ver from public.order_statements where order_id = o.id;
insert into public.order_statements (order_id, customer_id, entity_id, version, kind, vat_rate, fx_rate)
values (o.id, o.customer_id, o.entity_id, v_ver, p_kind, o.vat_rate, o.fx_rate) returning id into v_stmt;
v_goods := round(o.goods_cny * o.fx_rate)::bigint;
v_tax := case when o.china_tax_payer = 'khach' then 0 else round(o.china_tax_cny * o.fx_rate)::bigint end;
insert into public.order_statement_lines (statement_id, order_id, customer_id, entity_id, label, basis_vnd, rate, amount_vnd, source, sort_order)
values (v_stmt, o.id, o.customer_id, o.entity_id, 'Tiền hàng (' || o.goods_cny || ' tệ × ' || o.fx_rate || ')', null, o.fx_rate, v_goods, 'goods', 1);
insert into public.order_costs (statement_id, order_id, label, amount_vnd, source) values (v_stmt, o.id, 'Tiền hàng', v_goods, 'goods');
v_sub := v_goods;
if v_tax > 0 then
insert into public.order_statement_lines (statement_id, order_id, customer_id, entity_id, label, rate, amount_vnd, source, sort_order)
values (v_stmt, o.id, o.customer_id, o.entity_id, 'Thuế xuất HĐ TQ ' || coalesce((select l.label from public.lookup_values l where l.category = 'china_invoice_kind' and l.code = o.china_invoice_kind), o.china_invoice_type) || ' (' || coalesce(o.china_tax_rate, 0) || '% × ' || coalesce(o.china_tax_base_cny, o.goods_cny) || ' tệ)', o.fx_rate, v_tax, 'goods', 2);
insert into public.order_costs (statement_id, order_id, label, amount_vnd, source) values (v_stmt, o.id, 'Thuế xuất HĐ TQ', v_tax, 'goods');
v_sub := v_sub + v_tax;
end if;
for ft in select * from public.fee_types where is_active and deleted_at is null and calc_method <> 'actual' order by sort_order loop
r := app.pick_rule_e(ft.id, o.customer_id, o.entity_id, o.china_invoice_type, o.goods_group, o.created_at);
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
if v_prev is not null then
insert into public.order_statement_lines (statement_id, order_id, customer_id, entity_id, fee_type_id, label, amount_vnd, source, visible_to_customer, sort_order)
select v_stmt, order_id, customer_id, entity_id, fee_type_id, label, amount_vnd, 'manual', visible_to_customer, sort_order
from public.order_statement_lines where statement_id = v_prev and source = 'manual';
insert into public.order_costs (statement_id, order_id, fee_type_id, label, amount_vnd, source)
select v_stmt, order_id, fee_type_id, label, amount_vnd, 'manual' from public.order_costs where statement_id = v_prev and source = 'manual';
select v_sub + coalesce(sum(amount_vnd), 0) into v_sub from public.order_statement_lines where statement_id = v_stmt and source = 'manual';
end if;
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
v_dep_rate := coalesce(o.deposit_rate, (app.setting('finance.deposit_rate_percent'))::text::numeric, 80);
update public.order_statements
set subtotal_vnd = v_sub, vat_vnd = v_vat, total_vnd = v_sub + v_vat,
deposit_vnd = round(v_goods * v_dep_rate / 100)::bigint
where id = v_stmt;
perform app.notify(app.order_customer_users(o.id), 'order.quote',
'Đơn ' || o.code || ': có phiếu tính tiền ' || case p_kind when 'du_tinh' then 'dự tính' when 'tam_tinh' then 'tạm tính' else 'quyết toán' end || ' mới',
'Tổng ' || to_char(v_sub + v_vat, 'FM999G999G999G999') || ' đ – vui lòng kiểm tra và xác nhận', '/don-hang/chi-tiet/?id=' || o.id, o.id);
return v_stmt;
end;
$$;

create or replace function app.order_profit_calc(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o public.orders; st public.order_statements; v_lines jsonb; v_rev bigint; v_cost bigint; v_missing integer; v_sp_cny numeric; v_sp_vnd bigint;
begin
  select * into o from public.orders where id = p_order_id;
  select * into st from public.order_statements where order_id = p_order_id and status <> 'superseded' order by version desc limit 1;
  if st.id is null then
    return jsonb_build_object('has_statement', false, 'lines', '[]'::jsonb, 'revenue_vnd', 0, 'cost_vnd', 0, 'profit_vnd', 0, 'missing', 0);
  end if;
  select coalesce(sum(amount_cny), 0), coalesce(sum(amount_vnd), 0) into v_sp_cny, v_sp_vnd
    from public.supplier_payments where order_id = p_order_id and deleted_at is null;

  with rev as (
    select case when l.source = 'goods' and l.sort_order = 1 then 'goods'
                when l.source = 'goods' then 'china_tax'
                when l.source = 'rule' then coalesce(ft.code, l.label)
                else 'manual:' || l.label end as k,
           min(case when l.source = 'goods' and l.sort_order = 1 then 'Tiền hàng' else l.label end) as label,
           sum(l.amount_vnd) as revenue, min(l.sort_order) as sort
    from public.order_statement_lines l left join public.fee_types ft on ft.id = l.fee_type_id
    where l.statement_id = st.id group by 1
  ),
  cst as (
    select case when c.source = 'goods' and c.label = 'Tiền hàng' then 'goods'
                when c.source = 'goods' then 'china_tax'
                when c.source = 'rule' then coalesce(ft.code, c.label)
                else 'manual:' || c.label end as k,
           case when count(c.amount_vnd) = count(*) then sum(c.amount_vnd) end as cost_rule
    from public.order_costs c left join public.fee_types ft on ft.id = c.fee_type_id
    where c.statement_id = st.id group by 1
  ),
  ovr as (
    select distinct on (cost_key) cost_key as k, amount_vnd, note, created_at
    from public.order_cost_entries where order_id = p_order_id order by cost_key, created_at desc, id desc
  ),
  keys as (select k from rev union select k from ovr),
  x as (
    select k.k, coalesce(r.label, (select e.label from public.order_cost_entries e where e.order_id = p_order_id and e.cost_key = k.k order by e.id desc limit 1)) label,
           coalesce(r.revenue, 0) revenue, c.cost_rule,
           case when k.k = 'goods' and o.goods_cny > 0 and v_sp_cny >= o.goods_cny then round(v_sp_vnd * o.goods_cny / v_sp_cny)::bigint
            when k.k = 'china_tax' and o.china_tax_cny > 0 and v_sp_cny >= o.goods_cny + o.china_tax_cny then round(v_sp_vnd * o.china_tax_cny / v_sp_cny)::bigint end as cost_actual,
           v.amount_vnd as cost_override, v.note as override_note, v.created_at as override_at, coalesce(r.sort, 500) sort
    from keys k left join rev r on r.k = k.k left join cst c on c.k = k.k left join ovr v on v.k = k.k
  )
  select jsonb_agg(jsonb_build_object('key', k, 'label', label, 'revenue_vnd', revenue, 'cost_rule_vnd', cost_rule, 'cost_actual_vnd', cost_actual,
           'cost_override_vnd', cost_override, 'override_note', override_note, 'override_at', override_at,
           'cost_vnd', coalesce(cost_override, cost_actual, cost_rule),
           'source', case when cost_override is not null then 'nhap_tay' when cost_actual is not null then 'thuc_te_ncc' when cost_rule is not null then 'bieu_phi' else 'thieu' end,
           'profit_vnd', revenue - coalesce(cost_override, cost_actual, cost_rule, 0)) order by sort, label),
         coalesce(sum(revenue), 0), coalesce(sum(coalesce(cost_override, cost_actual, cost_rule)), 0),
         count(*) filter (where coalesce(cost_override, cost_actual, cost_rule) is null)
    into v_lines, v_rev, v_cost, v_missing
  from x;

  return jsonb_build_object('has_statement', true, 'statement_kind', st.kind, 'statement_version', st.version,
    'lines', coalesce(v_lines, '[]'::jsonb), 'revenue_vnd', v_rev, 'cost_vnd', v_cost, 'profit_vnd', v_rev - v_cost,
    'margin_pct', case when v_rev > 0 then round((v_rev - v_cost) * 100.0 / v_rev, 2) end,
    'missing', v_missing, 'vat_vnd', st.vat_vnd, 'total_vnd', st.total_vnd,
    'supplier_paid_cny', v_sp_cny, 'supplier_paid_vnd', v_sp_vnd, 'goods_cny', o.goods_cny);
end $$;

create or replace function public.set_fee_cost(p_rule_id uuid, p_cost_rate numeric, p_valid_from timestamptz default now(), p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.fee_rules; v_id uuid; v_from timestamptz := coalesce(p_valid_from, now());
begin
  if not (app.has_perm('fee.manage') and app.has_perm('finance.cost.write')) then
    raise exception 'Không có quyền đặt giá vốn biểu phí' using errcode = '42501';
  end if;
  select * into r from public.fee_rules where id = p_rule_id for update;
  if not found or r.valid_to is not null then raise exception 'Mức phí đã hết hiệu lực, chọn mức đang áp dụng' using errcode = '22023'; end if;
  if p_cost_rate is null or p_cost_rate < 0 then raise exception 'Giá vốn không hợp lệ' using errcode = '22023'; end if;
  if v_from <= r.valid_from then v_from := greatest(now(), r.valid_from + interval '1 second'); end if;
  update public.fee_rules set valid_to = v_from where id = r.id;
  insert into public.fee_rules (fee_type_id, customer_id, entity_id, china_invoice_type, goods_group, sell_rate, cost_rate, valid_from, note)
  values (r.fee_type_id, r.customer_id, r.entity_id, r.china_invoice_type, r.goods_group, r.sell_rate, p_cost_rate, v_from,
          coalesce(nullif(trim(p_note), ''), 'Đặt giá vốn ' || p_cost_rate))
  returning id into v_id;
  return v_id;
end $$;

-- 3. Bàn khai báo: trạng thái xử lý, phân bổ cân nặng/khối từ kiện, ghi chú
alter table public.order_items
  add column if not exists desk_status text not null default 'moi',
  add column if not exists alloc_weight_kg numeric(12,3),
  add column if not exists alloc_cbm numeric(12,6),
  add column if not exists weight_override_kg numeric(12,3) check (weight_override_kg is null or weight_override_kg >= 0),
  add column if not exists desk_note text;
update public.order_items set desk_status = 'san_sang' where status = 'da_xac_nhan';

create or replace function app.tg_order_items_customer_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_rank integer;
begin
  if auth.uid() is null or app.is_staff() or coalesce(current_setting('app.sys', true), '') = 'on' then return new; end if;
  select d.rank into v_rank from public.orders o join public.order_status_defs d on d.code = o.status where o.id = new.order_id;
  if v_rank is null or v_rank >= 100 then
    raise exception 'Hàng đã lên xe/hoàn tất, khách không sửa dòng khai báo. Nhắn CSKH trên đơn.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'da_xac_nhan' then raise exception 'Dòng đã được XNK xác nhận, nhắn CSKH để điều chỉnh' using errcode = '42501'; end if;
    new.order_id := old.order_id; new.line_no := old.line_no;
    new.desk_status := old.desk_status; new.weight_override_kg := old.weight_override_kg; new.desk_note := old.desk_note;
  end if;
  new.status := 'nhap'; new.confirmed_by := null; new.confirmed_at := null; new.catalog_id := null;
  return new;
end $$;

-- trạng thái bàn khai báo đi theo xác nhận
create or replace function app.tg_order_items_desk()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.desk_status not in (select code from public.lookup_values where category = 'desk_status') then
    raise exception 'Trạng thái khai báo không có trong danh mục' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.status = 'da_xac_nhan' and old.status <> 'da_xac_nhan' and new.desk_status in ('moi','can_bo_sung','dang_xu_ly','cho_ho_so') then
    new.desk_status := 'san_sang';
  elsif tg_op = 'UPDATE' and new.status = 'nhap' and old.status = 'da_xac_nhan' and new.desk_status = 'san_sang' then
    new.desk_status := 'dang_xu_ly';
  end if;
  return new;
end $$;
create trigger order_items_zdesk before insert or update on public.order_items for each row execute function app.tg_order_items_desk();

-- Phân bổ cân nặng (kg thực) và khối của các kiện xuống từng dòng: dòng có nhập tay giữ nguyên, phần còn lại chia theo trị giá/số lượng
create or replace function app.allocate_order_weight(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_kg numeric; v_cbm numeric; v_fixed numeric; v_basis text; v_tot numeric;
begin
  if p_order_id is null then return; end if;
  select coalesce(sum(gw_kg), 0), coalesce(sum(cbm), 0) into v_kg, v_cbm from public.packages where order_id = p_order_id and deleted_at is null;
  select coalesce(sum(weight_override_kg), 0) into v_fixed from public.order_items where order_id = p_order_id and deleted_at is null and weight_override_kg is not null;
  v_basis := coalesce(app.setting('customs.weight_alloc_basis') #>> '{}', 'value');
  select coalesce(sum(case when v_basis = 'qty' then qty else value_cny end), 0) into v_tot
    from public.order_items where order_id = p_order_id and deleted_at is null and weight_override_kg is null;
  perform set_config('app.sys', 'on', true);
  perform set_config('app.alloc', 'on', true);
  update public.order_items i set
    alloc_weight_kg = case when i.weight_override_kg is not null then i.weight_override_kg
                           when v_tot > 0 then round(greatest(v_kg - v_fixed, 0) * (case when v_basis = 'qty' then i.qty else i.value_cny end) / v_tot, 3) else null end,
    alloc_cbm = case when v_kg > 0 and coalesce(i.weight_override_kg, 0) >= 0 then
                  round(v_cbm * coalesce(i.weight_override_kg, case when v_tot > 0 then greatest(v_kg - v_fixed, 0) * (case when v_basis = 'qty' then i.qty else i.value_cny end) / v_tot else 0 end) / v_kg, 6) end,
    row_version = i.row_version
  where i.order_id = p_order_id and i.deleted_at is null;
  perform set_config('app.alloc', '', true);
  perform set_config('app.sys', '', true);
end $$;
revoke all on function app.allocate_order_weight(uuid) from public, anon, authenticated;

create or replace function app.tg_alloc_from_packages()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.allocate_order_weight(case when tg_op = 'DELETE' then old.order_id else new.order_id end);
  return null;
end $$;
create trigger packages_zalloc after insert or update of gw_kg, length_cm, width_cm, height_cm, deleted_at or delete on public.packages
  for each row execute function app.tg_alloc_from_packages();

create or replace function app.tg_alloc_from_items()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app.alloc', true), '') = 'on' then return null; end if;
  perform app.allocate_order_weight(case when tg_op = 'DELETE' then old.order_id else new.order_id end);
  return null;
end $$;
create trigger order_items_zalloc after insert or update of qty, unit_price_cny, weight_override_kg, deleted_at on public.order_items
  for each row execute function app.tg_alloc_from_items();

select app.allocate_order_weight(id) from public.orders;

-- Danh sách bàn khai báo (1 lần gọi)
create or replace function public.desk_items(p_filter jsonb default '{}')
returns setof jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(i) || jsonb_build_object(
    'order_code', o.code, 'order_status', o.status, 'entity_name', e.legal_name, 'entity_id', o.entity_id, 'customer_ref', o.customer_ref,
    'pkg_total', (select count(*) from public.packages p where p.order_id = o.id and p.deleted_at is null),
    'order_gw_kg', (select coalesce(sum(gw_kg), 0) from public.packages p where p.order_id = o.id and p.deleted_at is null),
    'images', (select count(*) from public.attachments a where a.entity_type = 'order_item' and a.entity_ref_id = i.id and a.deleted_at is null),
    'thumb_id', (select a.id from public.attachments a where a.entity_type = 'order_item' and a.entity_ref_id = i.id and a.deleted_at is null and a.mime_type like 'image/%' order by a.created_at limit 1),
    'picked_qty', (select coalesce(sum(pli.qty), 0) from public.picking_list_items pli join public.picking_lists pl on pl.id = pli.picking_list_id where pli.order_item_id = i.id and pl.status <> 'huy'),
    'warnings', (select coalesce(jsonb_agg(w.detail), '[]') from public.order_item_warnings w where w.item_id = i.id))
  from public.order_items i join public.orders o on o.id = i.order_id join public.customer_entities e on e.id = o.entity_id
  where i.deleted_at is null and o.deleted_at is null and app.is_staff() and app.staff_can_see_customer(o.customer_id)
    and o.status not in ('huy', 'dang_len_don')
    and (nullif(p_filter ->> 'desk_status', '') is null or i.desk_status = p_filter ->> 'desk_status')
    and (nullif(p_filter ->> 'entity_id', '') is null or o.entity_id = (p_filter ->> 'entity_id')::uuid)
    and (coalesce((p_filter ->> 'include_done')::boolean, false) or i.desk_status <> 'da_khai')
  order by o.created_at desc, i.line_no
  limit 2000;
$$;

-- Lập list bốc từ các dòng đã chọn: thêm phần còn lại của dòng + các kiện của đơn đang ở kho TQ chưa vào list nào
create or replace function public.create_picking_from_items(p_item_ids uuid[], p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_pl uuid; r record; v_left numeric; v_orders uuid[];
begin
  if not app.has_perm('logistics.write') then raise exception 'Không có quyền lập list bốc' using errcode = '42501'; end if;
  if coalesce(array_length(p_item_ids, 1), 0) = 0 then raise exception 'Chưa chọn dòng hàng' using errcode = '22023'; end if;
  insert into public.picking_lists (note) values (p_note) returning id into v_pl;
  for r in select i.* from public.order_items i where i.id = any(p_item_ids) and i.deleted_at is null loop
    if r.status <> 'da_xac_nhan' then raise exception 'Dòng % của đơn chưa được xác nhận khai báo', r.line_no using errcode = '23514'; end if;
    select r.qty - coalesce(sum(pli.qty), 0) into v_left from public.picking_list_items pli join public.picking_lists pl on pl.id = pli.picking_list_id
      where pli.order_item_id = r.id and pl.status <> 'huy';
    if v_left > 0 then insert into public.picking_list_items (picking_list_id, order_item_id, qty) values (v_pl, r.id, v_left); end if;
  end loop;
  select array_agg(distinct order_id) into v_orders from public.order_items where id = any(p_item_ids);
  insert into public.picking_list_packages (picking_list_id, package_id)
  select v_pl, p.id from public.packages p join public.warehouses w on w.id = p.warehouse_id
  where p.order_id = any(v_orders) and p.deleted_at is null and p.status = 've_kho' and w.country = 'CN'
    and not exists (select 1 from public.picking_list_packages x join public.picking_lists pl on pl.id = x.picking_list_id where x.package_id = p.id and pl.status <> 'huy');
  perform set_config('app.sys', 'on', true);
  update public.order_items set desk_status = 'da_len_list', row_version = row_version where id = any(p_item_ids) and desk_status in ('san_sang','moi','dang_xu_ly');
  perform set_config('app.sys', '', true);
  return v_pl;
end $$;

-- 4. Hàng đã về VN: nếu mọi kiện của đơn đã ở VN (kể cả không qua list bốc) thì coi như đã về đủ
create or replace view public.item_flow with (security_invoker = true) as
select i.id as order_item_id, i.order_id, i.customer_id, i.entity_id, i.line_no, i.declared_name_vi, i.hs_code, i.uom, i.qty,
       i.compliance_need, i.compliance_status,
       greatest(
         coalesce((select sum(pli.qty) from public.picking_list_items pli join public.picking_lists pl on pl.id = pli.picking_list_id
                   join public.trips t on t.id = pl.trip_id where pli.order_item_id = i.id and pl.status <> 'huy' and t.status = 've_vn'), 0),
         case when exists (select 1 from public.packages p where p.order_id = i.order_id and p.deleted_at is null)
               and not exists (select 1 from public.packages p where p.order_id = i.order_id and p.deleted_at is null and p.status not in ('ve_vn','da_giao','thieu','hong','sai_hang'))
              then i.qty else 0 end) as arrived_qty,
       coalesce((select sum(gl.qty) from public.goods_issue_lines gl join public.goods_issues g on g.id = gl.goods_issue_id
                 where gl.order_item_id = i.id and g.status <> 'huy'), 0) as issued_qty
from public.order_items i where i.deleted_at is null;

-- 5. Phiếu giao nhiều đơn cho 1 công ty con, chọn số kiện giao thực tế; lái xe ký nhận
create sequence if not exists public.delivery_note_seq;
create table public.delivery_notes (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique default ('PG' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMMDD') || '-' || lpad(nextval('public.delivery_note_seq')::text, 3, '0')),
  customer_id   uuid not null,
  entity_id     uuid not null,
  delivery_date date not null default current_date,
  driver_name   text, driver_phone text, vehicle_plate text,
  receiver_name text, receiver_phone text, address text,
  status        text not null default 'nhap' check (status in ('nhap','dang_giao','da_giao','huy')),
  delivered_at  timestamptz,
  note          text,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  updated_by uuid, deleted_at timestamptz, row_version integer not null default 1,
  foreign key (customer_id, entity_id) references public.customer_entities(customer_id, id)
);
alter table public.goods_issues add column if not exists delivery_note_id uuid references public.delivery_notes(id);
create trigger delivery_notes_std before insert or update on public.delivery_notes for each row execute function app.tg_standard_columns();
create trigger delivery_notes_audit after insert or update on public.delivery_notes for each row execute function audit.tg_log_change();
alter table public.delivery_notes enable row level security;
grant select on public.delivery_notes to authenticated;
grant usage on sequence public.delivery_note_seq to authenticated;
create policy dn_select on public.delivery_notes for select to authenticated using (deleted_at is null and app.can_see_entity(customer_id, entity_id));

-- Đơn sẵn sàng giao: kiện đang ở VN chưa giao
create or replace function public.delivery_candidates(p_customer_id uuid default null, p_entity_id uuid default null)
returns table (order_id uuid, code text, entity_id uuid, entity_name text, goods_desc text, status text, pkg_total integer, pkg_ready integer, pkg_delivered integer, remaining_vnd bigint)
language sql stable security definer set search_path = '' as $$
  select o.id, o.code, o.entity_id, e.legal_name, o.goods_desc, o.status,
         (select count(*)::int from public.packages p where p.order_id = o.id and p.deleted_at is null),
         (select count(*)::int from public.packages p where p.order_id = o.id and p.deleted_at is null and p.status = 've_vn'),
         (select count(*)::int from public.packages p where p.order_id = o.id and p.deleted_at is null and p.status = 'da_giao'),
         (select coalesce(s.total_vnd, 0) from public.order_statements s where s.order_id = o.id and s.status <> 'superseded' order by s.version desc limit 1)
           - app.order_paid_vnd(o.id) - app.order_credit_vnd(o.id)
  from public.orders o join public.customer_entities e on e.id = o.entity_id
  where o.deleted_at is null and app.is_staff() and app.staff_can_see_customer(o.customer_id)
    and (p_customer_id is null or o.customer_id = p_customer_id) and (p_entity_id is null or o.entity_id = p_entity_id)
    and exists (select 1 from public.packages p where p.order_id = o.id and p.deleted_at is null and p.status = 've_vn')
  order by e.legal_name, o.code;
$$;

create or replace function public.create_delivery_note(p_entity_id uuid, p_orders jsonb, p_header jsonb default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_dn uuid; v_c uuid; x jsonb; o public.orders; v_ready int; v_n int; v_gi uuid; f record; v_q numeric;
begin
  if not app.has_perm('warehouse.write') then raise exception 'Không có quyền lập phiếu giao' using errcode = '42501'; end if;
  select customer_id into v_c from public.customer_entities where id = p_entity_id;
  if v_c is null or not app.staff_can_see_customer(v_c) then raise exception 'Không tìm thấy công ty' using errcode = '42501'; end if;
  if jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) = 0 then raise exception 'Chưa chọn đơn' using errcode = '22023'; end if;
  insert into public.delivery_notes (customer_id, entity_id, delivery_date, driver_name, driver_phone, vehicle_plate, receiver_name, receiver_phone, address, note)
  values (v_c, p_entity_id, coalesce(nullif(p_header ->> 'delivery_date', '')::date, current_date), nullif(p_header ->> 'driver_name', ''), nullif(p_header ->> 'driver_phone', ''),
          nullif(p_header ->> 'vehicle_plate', ''), nullif(p_header ->> 'receiver_name', ''), nullif(p_header ->> 'receiver_phone', ''), nullif(p_header ->> 'address', ''), nullif(p_header ->> 'note', ''))
  returning id into v_dn;
  for x in select * from jsonb_array_elements(p_orders) loop
    select * into o from public.orders where id = (x ->> 'order_id')::uuid and deleted_at is null for update;
    if not found or o.entity_id <> p_entity_id then raise exception 'Đơn không thuộc công ty đã chọn' using errcode = '23514'; end if;
    select count(*) into v_ready from public.packages where order_id = o.id and deleted_at is null and status = 've_vn';
    v_n := coalesce((x ->> 'packages')::int, v_ready);
    if v_n <= 0 or v_n > v_ready then raise exception 'Đơn %: số kiện giao % không hợp lệ (đang có % kiện tại kho VN)', o.code, v_n, v_ready using errcode = '23514'; end if;
    insert into public.goods_issues (order_id, packages, delivery_note_id, receiver_name, receiver_phone, deliverer)
    values (o.id, v_n, v_dn, nullif(p_header ->> 'receiver_name', ''), nullif(p_header ->> 'receiver_phone', ''), nullif(p_header ->> 'driver_name', ''))
    returning id into v_gi;
    -- dòng hàng: giao đủ kiện còn lại → giao hết; giao một phần → chia theo tỷ lệ kiện (làm tròn xuống, sửa được trước khi chốt)
    for f in select * from public.item_flow where order_id = o.id and arrived_qty - issued_qty > 0 loop
      v_q := case when v_n = v_ready then f.arrived_qty - f.issued_qty else floor((f.arrived_qty - f.issued_qty) * v_n / v_ready) end;
      if v_q > 0 then insert into public.goods_issue_lines (goods_issue_id, order_item_id, qty) values (v_gi, f.order_item_id, v_q); end if;
    end loop;
  end loop;
  return v_dn;
end $$;

create or replace function public.set_delivery_status(p_note_id uuid, p_status text, p_header jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
declare dn public.delivery_notes; g record;
begin
  if not app.has_perm('warehouse.write') then raise exception 'Không có quyền' using errcode = '42501'; end if;
  select * into dn from public.delivery_notes where id = p_note_id for update;
  if not found then raise exception 'Không tìm thấy phiếu' using errcode = '42501'; end if;
  if dn.status in ('da_giao','huy') then raise exception 'Phiếu đã chốt' using errcode = '22023'; end if;
  if p_header is not null then
    update public.delivery_notes set driver_name = coalesce(p_header ->> 'driver_name', driver_name), driver_phone = coalesce(p_header ->> 'driver_phone', driver_phone),
      vehicle_plate = coalesce(p_header ->> 'vehicle_plate', vehicle_plate), receiver_name = coalesce(p_header ->> 'receiver_name', receiver_name),
      receiver_phone = coalesce(p_header ->> 'receiver_phone', receiver_phone), address = coalesce(p_header ->> 'address', address), note = coalesce(p_header ->> 'note', note),
      row_version = row_version where id = dn.id;
  end if;
  if p_status = 'dang_giao' then
    update public.delivery_notes set status = 'dang_giao', row_version = row_version where id = dn.id;
  elsif p_status = 'da_giao' then
    update public.delivery_notes set status = 'da_giao', delivered_at = now(), row_version = row_version where id = dn.id;
    for g in select * from public.goods_issues where delivery_note_id = dn.id and status = 'nhap' loop
      update public.packages set status = 'da_giao', row_version = row_version
       where id in (select id from public.packages where order_id = g.order_id and deleted_at is null and status = 've_vn' order by seq_no limit g.packages);
      update public.goods_issues set status = 'da_giao', row_version = row_version where id = g.id;
    end loop;
  elsif p_status = 'huy' then
    update public.goods_issues set status = 'huy', row_version = row_version where delivery_note_id = dn.id and status = 'nhap';
    update public.delivery_notes set status = 'huy', row_version = row_version where id = dn.id;
  elsif p_status <> 'nhap' then raise exception 'Trạng thái không hợp lệ' using errcode = '22023';
  end if;
end $$;

-- 6. Giữ dung lượng gói Free: dọn thông báo đã đọc > 60 ngày, chưa đọc > 180 ngày
create or replace function app.housekeeping()
returns void language sql security definer set search_path = '' as $$
  delete from public.notifications where (read_at is not null and created_at < now() - interval '60 days') or created_at < now() - interval '180 days';
$$;
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('namchi-housekeeping', '15 3 * * 0', 'select app.housekeeping()');
  end if;
exception when others then raise notice 'pg_cron không bật được: %', sqlerrm;
end $$;

revoke all on function public.desk_items(jsonb), public.create_picking_from_items(uuid[], text), public.delivery_candidates(uuid, uuid),
  public.create_delivery_note(uuid, jsonb, jsonb), public.set_delivery_status(uuid, text, jsonb) from public, anon;
grant execute on function public.desk_items(jsonb), public.create_picking_from_items(uuid[], text), public.delivery_candidates(uuid, uuid),
  public.create_delivery_note(uuid, jsonb, jsonb), public.set_delivery_status(uuid, text, jsonb) to authenticated;

-- 7. Danh sách đơn cho khách (không có ghi chú nội bộ, CSKH, lợi nhuận)
create or replace function public.customer_orders(p_filter jsonb default '{}')
returns setof jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id, 'code', o.code, 'customer_ref', o.customer_ref, 'entity_name', e.legal_name, 'entity_id', o.entity_id,
    'goods_desc', o.goods_desc, 'supplier_name', o.supplier_name, 'china_invoice_type', o.china_invoice_type, 'goods_cny', o.goods_cny, 'goods_qty', o.goods_qty,
    'weight_kg', o.weight_kg, 'packages', o.packages, 'order_week', o.order_week, 'status', o.status, 'created_at', o.created_at, 'note', o.note,
    'thumb_id', (select a.id from public.attachments a where a.deleted_at is null and a.visibility = 'customer' and a.mime_type like 'image/%'
      and ((a.entity_type = 'order' and a.entity_ref_id = o.id) or (a.entity_type = 'order_item' and a.entity_ref_id in (select i.id from public.order_items i where i.order_id = o.id)))
      order by (a.entity_type = 'order') desc, a.created_at limit 1),
    'images_count', (select count(*) from public.attachments a where a.deleted_at is null and a.visibility = 'customer' and a.mime_type like 'image/%'
      and ((a.entity_type = 'order' and a.entity_ref_id = o.id) or (a.entity_type = 'order_item' and a.entity_ref_id in (select i.id from public.order_items i where i.order_id = o.id))))
  ) || to_jsonb(pg) - 'order_id' - 'status' - 'status_rank' - 'wallet_balance_vnd'
  from public.orders o join public.customer_entities e on e.id = o.entity_id
  cross join lateral (select * from public.order_progress(array[o.id])) pg
  where o.deleted_at is null and not app.is_staff() and app.can_see_entity(o.customer_id, o.entity_id)
    and (nullif(p_filter ->> 'entity_id', '') is null or o.entity_id = (p_filter ->> 'entity_id')::uuid)
  order by o.created_at desc limit 2000;
$$;
revoke all on function public.customer_orders(jsonb) from public, anon;
grant execute on function public.customer_orders(jsonb) to authenticated;
