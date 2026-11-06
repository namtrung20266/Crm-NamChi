-- Test trang quản trị: giá vốn biểu phí, giá vốn thực tế từng khoản, lợi nhuận, dashboard, danh sách đơn
begin;
create extension if not exists pgtap;
select plan(14);
create schema t;
create function t.login(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p)::text, true); execute 'set local role authenticated'; end $$;
create function t.logout() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
grant usage on schema t to authenticated; grant execute on all functions in schema t to authenticated;
create temp table ids (k text primary key, v uuid default gen_random_uuid());
grant select on ids to authenticated;
insert into ids (k) select unnest(array['adm','acc','mgr','cs','sv','LC','SV','O1']);
create function t.id(p text) returns uuid language sql stable as $$ select v from ids where k = p $$;
grant execute on function t.id(text) to authenticated;
insert into auth.users (id, email) select v, k || '@t.local' from ids where k in ('adm','acc','mgr','cs','sv');
insert into public.profiles (user_id, full_name, user_type) values (t.id('adm'),'Admin','staff'),(t.id('acc'),'KT','staff'),(t.id('mgr'),'QL','staff'),(t.id('cs'),'CS','staff'),(t.id('sv'),'SV','customer');
insert into public.user_roles (user_id, role_id) select t.id(u), r.id from (values ('adm','admin'),('acc','accountant'),('mgr','manager'),('cs','cs'),('sv','cust_admin')) x(u,c) join public.roles r on r.code = x.c;
insert into public.customers (id, code, name) values (t.id('LC'),'LC','Lanchi');
insert into public.customer_entities (id, customer_id, code, legal_name) values (t.id('SV'),t.id('LC'),'SV','Sen Vàng');
insert into public.customer_users values (t.id('sv'),t.id('LC'),t.id('SV'));
insert into public.staff_customer_assignments (staff_user_id, customer_id, valid_from) values (t.id('cs'), t.id('LC'), current_date - 1);
insert into public.orders (id, customer_id, entity_id, goods_cny, fx_rate, china_invoice_type, weight_kg, status) values (t.id('O1'), t.id('LC'), t.id('SV'), 10000, 3700, 'HDPT', 100, 'cho_bao_gia');

select t.login(t.id('adm'));
select lives_ok($$select public.set_fee_cost((select r.id from public.fee_rules r join public.fee_types f on f.id = r.fee_type_id where f.code = 'MUA_HANG' and r.valid_to is null and r.customer_id is null limit 1), 0.5)$$, 'C1 admin đặt giá vốn phí mua hàng (tạo phiên bản mới)');
select is((select count(*)::int from public.fee_rules r join public.fee_types f on f.id = r.fee_type_id where f.code = 'MUA_HANG' and r.valid_to is null), 1, 'C2 chỉ 1 mức đang hiệu lực');
select is((select cost_rate from public.fee_rules r join public.fee_types f on f.id = r.fee_type_id where f.code = 'MUA_HANG' and r.valid_to is null), 0.5::numeric(18,6), 'C3 mức mới có giá vốn, giữ giá bán');
-- đơn tạo trước khi đặt giá vốn → dùng mức cũ (chưa có giá vốn) → thiếu giá vốn
select lives_ok($$select public.build_statement(t.id('O1'), 'tam_tinh')$$, 'C4 lập phiếu');
select ok(((public.order_profit_detail(t.id('O1'))) ->> 'missing')::int > 0, 'C5 phát hiện khoản thiếu giá vốn');
select lives_ok($$select public.set_order_cost(t.id('O1'), 'MUA_HANG', 'Phí mua hàng', 150000, 'Chi thực tế')$$, 'C6 admin nhập giá vốn thực tế 1 khoản');
select is((select (l ->> 'cost_vnd')::bigint from jsonb_array_elements(public.order_profit_detail(t.id('O1')) -> 'lines') l where l ->> 'key' = 'MUA_HANG'), 150000::bigint, 'C7 giá vốn nhập tay được ưu tiên');
insert into public.supplier_payments (order_id, method, amount_cny, fx_rate) values (t.id('O1'), 'nam_trung', 10000, 3650);
select is((select (l ->> 'cost_vnd')::bigint from jsonb_array_elements(public.order_profit_detail(t.id('O1')) -> 'lines') l where l ->> 'key' = 'goods'), 36500000::bigint, 'C8 tiền hàng tính theo tỷ giá trả NCC thực tế');
select ok((public.admin_dashboard() -> 'profit') is not null and (public.admin_dashboard() -> 'kpi' ->> 'orders_active')::int = 1, 'C9 dashboard có KPI và lợi nhuận cho admin');
select is((select count(*)::int from public.admin_orders('{}')), 1, 'C10 danh sách đơn quản trị');
select t.logout();

select t.login(t.id('mgr'));
select ok((public.admin_dashboard() -> 'profit') = 'null'::jsonb or (public.admin_dashboard() -> 'profit') is null, 'C11 Quản lý không thấy lợi nhuận trên dashboard');
select throws_ok($$select public.set_order_cost(t.id('O1'), 'MUA_HANG', 'x', 1)$$, '42501', null, 'C12 Quản lý không đặt giá vốn');
select t.logout();

select t.login(t.id('cs'));
select throws_ok($$select public.order_profit_detail(t.id('O1'))$$, '42501', null, 'C13 CSKH không xem lợi nhuận');
select t.logout();
select t.login(t.id('sv'));
select throws_ok($$select public.admin_dashboard()$$, '42501', null, 'C14 khách không gọi dashboard quản trị');
select t.logout();
select * from finish();
rollback;
