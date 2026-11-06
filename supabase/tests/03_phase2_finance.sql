-- Test Giai đoạn 2: đơn hàng, phiếu tính tiền, tiền vào, phân bổ, phạm vi xem
begin;
create extension if not exists pgtap;
select plan(18);
create schema t;
create function t.login(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p)::text, true); execute 'set local role authenticated'; end $$;
create function t.logout() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create function t.affected(p_sql text) returns int language plpgsql as $f$ declare n int; begin execute p_sql; get diagnostics n = row_count; return n; end $f$;
grant usage on schema t to authenticated; grant execute on all functions in schema t to authenticated;
create temp table ids (k text primary key, v uuid default gen_random_uuid());
grant select on ids to authenticated;
insert into ids (k) select unnest(array['acc','cs','wh','lc','sv','tv','LC','KH2','SV','TV','K2','O1','O2','O3','R1','R2']);
create function t.id(p text) returns uuid language sql stable as $$ select v from ids where k = p $$;
grant execute on function t.id(text) to authenticated;
insert into auth.users (id, email) select v, k || '@t.local' from ids where k in ('acc','cs','wh','lc','sv','tv');
insert into public.profiles (user_id, full_name, user_type) values
 (t.id('acc'),'acc','staff'),(t.id('cs'),'cs','staff'),(t.id('wh'),'wh','staff'),(t.id('lc'),'lc','customer'),(t.id('sv'),'sv','customer'),(t.id('tv'),'tv','customer');
insert into public.user_roles (user_id, role_id) select t.id(u), r.id from (values ('acc','accountant'),('cs','cs'),('wh','warehouse_vn'),('lc','cust_admin'),('sv','cust_member'),('tv','cust_member')) x(u,c) join public.roles r on r.code = x.c;
insert into public.customers (id, code, name) values (t.id('LC'),'LC','Lanchi'),(t.id('KH2'),'KH2','KH2');
insert into public.customer_entities (id, customer_id, code, legal_name) values (t.id('SV'),t.id('LC'),'SV','Sen Vàng'),(t.id('TV'),t.id('LC'),'TV','Thịnh Vượng'),(t.id('K2'),t.id('KH2'),'K2','K2');
insert into public.customer_users values (t.id('lc'),t.id('LC'),null),(t.id('sv'),t.id('LC'),t.id('SV')),(t.id('tv'),t.id('LC'),t.id('TV'));
insert into public.staff_customer_assignments (staff_user_id, customer_id, valid_from) values (t.id('cs'), t.id('LC'), current_date - 1);
-- Đơn mẫu theo File_chiphi DON1 đơn 10220: 31.200 tệ × 4.055, HĐ phổ thông, thuế TQ 312 tệ, 455 kg
insert into public.orders (id, customer_id, entity_id, goods_cny, fx_rate, china_invoice_type, china_tax_cny, weight_kg, vat_rate)
values (t.id('O1'), t.id('LC'), t.id('SV'), 31200, 4055, 'HDPT', 312, 455, 8),
       (t.id('O2'), t.id('LC'), t.id('TV'), 1000, 4000, 'KHD', 0, 10, 8),
       (t.id('O3'), t.id('KH2'), t.id('K2'), 1000, 4000, 'HDPT', 0, 0, 8);

select t.login(t.id('cs'));
select lives_ok($$select public.build_statement(t.id('O1'), 'du_tinh')$$, 'F1 CSKH lập phiếu dự tính');
select is((select subtotal_vnd from public.order_statements where order_id = t.id('O1') and status = 'active'),
  -- 126.516.000 + 1.265.160 (thuế TQ) + 2% + 2% tiền hàng + 0,8% × (tiền hàng+thuế) + 455×12.000
  126516000::bigint + 1265160 + 2530320 + 2530320 + 1022249 + 5460000, 'F2 tạm tính khớp biểu phí File_chiphi');
select throws_ok($$select public.build_statement(t.id('O3'), 'du_tinh')$$, '42501', null, 'F3 CSKH không lập phiếu cho khách không phụ trách');
select lives_ok($$select public.build_statement(t.id('O1'), 'tam_tinh', '[{"label":"Phí kiểm định","amount_vnd":1183333,"cost_vnd":1100000}]')$$, 'F4 lập phiếu tạm tính kèm phí kiểm định');
select is((select count(*)::int from public.order_statements where order_id = t.id('O1') and status <> 'superseded'), 1, 'F5 chỉ 1 phiếu hiệu lực, phiếu cũ bị thay thế');
select is((select count(*)::int from public.order_costs), 0, 'F6 CSKH không xem được giá vốn');
select t.logout();

select t.login(t.id('acc'));
select ok((select cost_vnd from public.order_profit where order_id = t.id('O1')) is not null, 'F7 Kế toán xem được giá vốn/lợi nhuận');
insert into public.bank_receipts (id, customer_id, amount_vnd) values (t.id('R1'), t.id('LC'), 100000000), (t.id('R2'), t.id('KH2'), 5000000);
select lives_ok($$insert into public.receipt_allocations (receipt_id, order_id, kind, amount_vnd) values (t.id('R1'), t.id('O1'), 'L1', 90000000)$$, 'F8 phân bổ tiền vào đơn');
select throws_ok($$insert into public.receipt_allocations (receipt_id, order_id, kind, amount_vnd) values (t.id('R1'), t.id('O2'), 'L1', 20000000)$$, '23514', null, 'F9 không phân bổ vượt số tiền nhận');
select throws_ok($$insert into public.receipt_allocations (receipt_id, order_id, kind, amount_vnd) values (t.id('R2'), t.id('O1'), 'L1', 1000)$$, '23514', null, 'F10 không phân bổ tiền khách này cho đơn khách khác');
select throws_ok($$update public.receipt_allocations set amount_vnd = 1$$, '42501', null, 'F11 phân bổ không sửa được, chỉ đảo');
select is((select paid_vnd from public.order_finance where order_id = t.id('O1')), 90000000::bigint, 'F12 đơn ghi nhận đã thanh toán');
select t.logout();

select t.login(t.id('sv'));
select is((select count(*)::int from public.orders), 1, 'F13 Sen Vàng chỉ thấy đơn của mình');
select is((select count(*)::int from public.bank_receipts), 0, 'F14 công ty con không xem giao dịch tiền cấp Lanchi');
select ok((select count(*) from public.order_statement_lines) > 0 and (select count(*) from public.order_costs) = 0, 'F15 khách thấy dòng phí, không thấy giá vốn');
select lives_ok($$select public.confirm_statement((select id from public.order_statements where order_id = t.id('O1') and status = 'active'))$$, 'F16 khách xác nhận phiếu');
select is(t.affected($$update public.orders set goods_cny = 1 where id = t.id('O1')$$), 0, 'F17 khách không sửa đơn sau khi gửi');
select t.logout();

select t.login(t.id('wh'));
select is((select count(*)::int from public.order_statements), 0, 'F18 Kho không xem phiếu tính tiền');
select t.logout();

select * from finish();
rollback;
