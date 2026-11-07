-- NAMCHI ERP – vòng 3 (08/11/2026): tự lập phiếu tạm tính khi khách gửi đơn, khách không cần xác nhận; phân công CSKH sửa được
insert into public.app_settings (key, value_json, note) values
('order.auto_quote_on_submit', 'true', 'Tự lập phiếu tạm tính ngay khi đơn được gửi'),
('order.quote_requires_customer_confirm', 'false', 'Khách phải bấm xác nhận phiếu (tắt = phiếu tự chốt, khách chỉ xem)')
on conflict do nothing;
update public.app_settings set valid_to = now() where key = 'order.payment_requires_confirmed_quote' and valid_to is null;
insert into public.app_settings (key, value_json, note, valid_from) values ('order.payment_requires_confirmed_quote', 'false', 'Phiếu tự chốt nên không chặn thanh toán', now());

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

-- Phiếu tự chốt khi cấu hình không yêu cầu khách xác nhận
create or replace function app.tg_statement_auto_confirm()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
if not coalesce((app.setting('order.quote_requires_customer_confirm'))::text::boolean, false) and new.status = 'active' then
perform set_config('app.sys', 'on', true);
update public.order_statements set status = 'confirmed', confirmed_at = now() where id = new.id;
perform set_config('app.sys', '', true);
end if;
return null;
end $$;
create trigger order_statements_auto_confirm after insert on public.order_statements for each row execute function app.tg_statement_auto_confirm();

create or replace function app.tg_statement_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
if coalesce(current_setting('app.sys', true), '') = 'on' then return null; end if;
select * into o from public.orders where id = new.order_id;
if new.status = 'confirmed' and old.status <> 'confirmed' then
perform app.notify(app.order_staff_users(o.id), 'order.quote', 'Đơn ' || o.code || ': khách đã xác nhận phiếu tính tiền', null, '/don-hang/chi-tiet/?id=' || o.id, o.id);
end if;
return null;
end $$;

-- Tự lập phiếu tạm tính khi đơn chuyển sang Chờ báo giá (khách gửi hoặc CSKH tạo)
create or replace function app.tg_order_auto_quote()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_prev text;
begin
if new.status <> 'cho_bao_gia' or (tg_op = 'UPDATE' and old.status = 'cho_bao_gia') then return null; end if;
if not coalesce((app.setting('order.auto_quote_on_submit'))::text::boolean, true) or new.goods_cny <= 0 then return null; end if;
if exists (select 1 from public.order_statements where order_id = new.id and status <> 'superseded') then return null; end if;
v_prev := coalesce(current_setting('app.sys', true), '');
perform set_config('app.sys', 'on', true);
perform public.build_statement(new.id, 'tam_tinh', '[]'::jsonb);
perform set_config('app.sys', v_prev, true);
return null;
end $$;
create trigger orders_auto_quote after insert or update of status on public.orders for each row execute function app.tg_order_auto_quote();

-- Phân công CSKH: công ty con (entity) hoặc cả khách tổng (entity trống = Quản lý CSKH). Sửa được bất cứ lúc nào.
create or replace function public.set_cs_assignment(p_customer_id uuid, p_entity_id uuid, p_staff_user_id uuid, p_move_open_orders boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
if not (app.has_perm('settings.manage') or app.has_perm('user.manage')) then raise exception 'Không có quyền phân công CSKH' using errcode = '42501'; end if;
if p_entity_id is not null and not exists (select 1 from public.customer_entities where id = p_entity_id and customer_id = p_customer_id) then
raise exception 'Công ty con không thuộc khách này' using errcode = '22023'; end if;
if p_staff_user_id is not null and not exists (select 1 from public.profiles where user_id = p_staff_user_id and user_type = 'staff' and is_active) then
raise exception 'Nhân viên không hợp lệ' using errcode = '22023'; end if;
delete from public.staff_customer_assignments
where customer_id = p_customer_id and entity_id is not distinct from p_entity_id and valid_from >= current_date;
update public.staff_customer_assignments set valid_to = current_date - 1
where customer_id = p_customer_id and entity_id is not distinct from p_entity_id and (valid_to is null or valid_to >= current_date);
if p_staff_user_id is not null then
insert into public.staff_customer_assignments (staff_user_id, customer_id, entity_id, valid_from) values (p_staff_user_id, p_customer_id, p_entity_id, current_date);
if p_move_open_orders and p_entity_id is not null then
perform set_config('app.sys', 'on', true);
update public.orders set cs_owner_id = p_staff_user_id, row_version = row_version
where entity_id = p_entity_id and deleted_at is null and status not in ('hoan_tat', 'huy');
perform set_config('app.sys', '', true);
end if;
end if;
end $$;
revoke all on function public.set_cs_assignment(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.set_cs_assignment(uuid, uuid, uuid, boolean) to authenticated;
