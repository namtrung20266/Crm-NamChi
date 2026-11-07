-- Vòng 4: thuế HĐ TQ theo loại, biểu phí công ty con, phân bổ cân nặng, list bốc từ bàn khai báo, phiếu giao
begin;
create extension if not exists pgtap;
select plan(12);
create temp table ids (k text primary key, v uuid default gen_random_uuid());
insert into ids (k) select unnest(array['adm','LC','SV','O1','O2']);
create function pg_temp.id(p text) returns uuid language sql stable as $$ select v from ids where k = p $$;
insert into auth.users (id, email) values (pg_temp.id('adm'), 'adm@t.local');
insert into public.profiles (user_id, full_name, user_type) values (pg_temp.id('adm'),'Admin','staff');
insert into public.user_roles (user_id, role_id) select pg_temp.id('adm'), id from public.roles where code = 'admin';
insert into public.customers (id, code, name) values (pg_temp.id('LC'),'LC','Lanchi');
insert into public.customer_entities (id, customer_id, code, legal_name) values (pg_temp.id('SV'),pg_temp.id('LC'),'SV','Sen Vàng');
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.id('adm'))::text, true);
update public.app_settings set valid_to = now() where key in ('order.auto_quote_on_submit') and valid_to is null;
insert into public.app_settings (key, value_json, note, valid_from) values ('order.auto_quote_on_submit','false','test',now());

insert into public.orders (id, customer_id, entity_id, goods_cny, fx_rate, china_invoice_kind, status) values (pg_temp.id('O1'), pg_temp.id('LC'), pg_temp.id('SV'), 10000, 3600, 'hdpt_2', 'cho_bao_gia');
select is((select china_tax_cny from public.orders where id = pg_temp.id('O1')), 200.00::numeric(18,2), 'T1 HĐPT 2% tự tính thuế 200 tệ');
select is((select china_invoice_type from public.orders where id = pg_temp.id('O1')), 'HDPT', 'T2 loại gốc HĐPT để áp biểu phí');
insert into public.orders (id, customer_id, entity_id, goods_cny, fx_rate, china_invoice_kind, china_tax_base_cny, china_tax_payer, status)
values (pg_temp.id('O2'), pg_temp.id('LC'), pg_temp.id('SV'), 10000, 3600, 'hdcd', 4000, 'cong_ty', 'cho_bao_gia');
select is((select china_tax_cny from public.orders where id = pg_temp.id('O2')), 520.00::numeric(18,2), 'T3 HĐCD tính trên mốc 4.000 tệ × 13%');
select lives_ok($$select public.build_statement(pg_temp.id('O2'), 'tam_tinh')$$, 'T4 lập phiếu HĐCD');
select is((select count(*)::int from public.order_statement_lines l join public.order_statements s on s.id = l.statement_id where s.order_id = pg_temp.id('O2') and l.label like 'Thuế xuất%'), 0, 'T5 Nam Trung chịu thuế HĐCD: không thu khách trên phiếu');
-- biểu phí công ty con được ưu tiên
insert into public.fee_rules (fee_type_id, customer_id, entity_id, sell_rate, valid_from) select id, pg_temp.id('LC'), pg_temp.id('SV'), 9.5, now() - interval '1 day' from public.fee_types where code = 'MUA_HANG';
select lives_ok($$select public.build_statement(pg_temp.id('O1'), 'tam_tinh')$$, 'T6 lập phiếu HĐPT');
select is((select l.rate from public.order_statement_lines l join public.order_statements s on s.id = l.statement_id join public.fee_types f on f.id = l.fee_type_id
           where s.order_id = pg_temp.id('O1') and s.status <> 'superseded' and f.code = 'MUA_HANG'), 9.5::numeric, 'T7 phí mua hàng lấy biểu phí riêng của công ty con');
-- phân bổ cân nặng
insert into public.order_items (order_id, declared_name_vi, qty, unit_price_cny, hs_code) values (pg_temp.id('O1'), 'A', 100, 60, '61103000'), (pg_temp.id('O1'), 'B', 100, 40, '61103000');
insert into public.packages (order_id, seq_no, gw_kg, length_cm, width_cm, height_cm, warehouse_id, status)
select pg_temp.id('O1'), g, 50, 50, 50, 50, (select id from public.warehouses where code = 'QC'), 've_kho' from generate_series(1,2) g;
select is((select string_agg(alloc_weight_kg::text, ',' order by line_no) from public.order_items where order_id = pg_temp.id('O1')), '60.000,40.000', 'T8 100 kg chia theo trị giá 60/40');
update public.order_items set weight_override_kg = 30, row_version = row_version where order_id = pg_temp.id('O1') and line_no = 2;
select is((select string_agg(alloc_weight_kg::text, ',' order by line_no) from public.order_items where order_id = pg_temp.id('O1')), '70.000,30.000', 'T9 nhập tay dòng 2 = 30 kg, dòng 1 nhận phần còn lại');
-- list bốc từ bàn khai báo
select public.confirm_order_item(id) from public.order_items where order_id = pg_temp.id('O1');
select ok(public.create_picking_from_items(array(select id from public.order_items where order_id = pg_temp.id('O1'))) is not null, 'T10 lập list bốc từ dòng đã chốt');
select is((select count(*)::int from public.picking_list_packages), 2, 'T11 list bốc kéo theo 2 kiện đang ở kho TQ');
-- phiếu giao: kiện về VN, giao 1/2 kiện
update public.packages set status = 've_vn', warehouse_id = (select id from public.warehouses where code = 'VN'), row_version = row_version where order_id = pg_temp.id('O1');
select ok(public.create_delivery_note(pg_temp.id('SV'), jsonb_build_array(jsonb_build_object('order_id', pg_temp.id('O1'), 'packages', 1)), '{"driver_name":"Anh Tài"}') is not null, 'T12 lập phiếu giao 1/2 kiện');
select * from finish();
rollback;
