-- Test Giai đoạn 3: kiện, cân đo, khai báo, list bốc, list xe, snapshot
begin;
create extension if not exists pgtap;
select plan(16);
create schema t;
create function t.login(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p)::text, true); execute 'set local role authenticated'; end $$;
create function t.logout() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
grant usage on schema t to authenticated; grant execute on all functions in schema t to authenticated;
create temp table ids (k text primary key, v uuid default gen_random_uuid());
grant select on ids to authenticated;
insert into ids (k) select unnest(array['wh','xnk','cs','sv','tv','LC','SV','TV','O1','O2','P1','P2','I1','PL1','PL2','T1']);
create function t.id(p text) returns uuid language sql stable as $$ select v from ids where k = p $$;
grant execute on function t.id(text) to authenticated;
insert into auth.users (id, email) select v, k || '@t.local' from ids where k in ('wh','xnk','cs','sv','tv');
insert into public.profiles (user_id, full_name, user_type) values (t.id('wh'),'wh','staff'),(t.id('xnk'),'xnk','staff'),(t.id('cs'),'cs','staff'),(t.id('sv'),'sv','customer'),(t.id('tv'),'tv','customer');
insert into public.user_roles (user_id, role_id) select t.id(u), r.id from (values ('wh','warehouse_cn'),('xnk','xnk'),('cs','cs'),('sv','cust_member'),('tv','cust_member')) x(u,c) join public.roles r on r.code = x.c;
insert into public.customers (id, code, name) values (t.id('LC'),'LC','Lanchi');
insert into public.customer_entities (id, customer_id, code, legal_name) values (t.id('SV'),t.id('LC'),'SV','Sen Vàng'),(t.id('TV'),t.id('LC'),'TV','Thịnh Vượng');
insert into public.customer_users values (t.id('sv'),t.id('LC'),t.id('SV')),(t.id('tv'),t.id('LC'),t.id('TV'));
insert into public.staff_customer_assignments (staff_user_id, customer_id, valid_from) values (t.id('cs'), t.id('LC'), current_date - 1);
insert into public.orders (id, customer_id, entity_id, goods_cny, fx_rate) values (t.id('O1'), t.id('LC'), t.id('SV'), 1000, 3650), (t.id('O2'), t.id('LC'), t.id('TV'), 500, 3650);

select t.login(t.id('wh'));
select lives_ok($$insert into public.packages (id, order_id, seq_no, gw_kg, length_cm, width_cm, height_cm) values (t.id('P1'), t.id('O1'), 1, 10, 60, 50, 40)$$, 'K1 kho nhận kiện, cân đo');
select is((select chargeable_kg from public.packages where id = t.id('P1')), 20.000::numeric, 'K2 cân tính phí = MAX(10kg, 60×50×40/6000 = 20kg)');
select is((select cbm from public.packages where id = t.id('P1')), 0.120000::numeric, 'K3 khối = 0,12 m³');
insert into public.packages (id, order_id, seq_no, gw_kg, length_cm, width_cm, height_cm) values (t.id('P2'), t.id('O1'), 2, 25, 30, 30, 30);
select is((select weight_kg from public.orders where id = t.id('O1')), 45.000::numeric, 'K4 đơn tự cộng cân tính phí 20 + 25');
select is((select label from public.package_labels where id = t.id('P2')), (select code from public.orders where id = t.id('O1')) || '-2/2', 'K5 mã kiện [Mã đơn]-2/2');
select throws_ok($$insert into public.order_items (order_id, declared_name_vi, qty) values (t.id('O1'), 'x', 1)$$, '42501', null, 'K6 kho không lập dòng khai báo');
select t.logout();

select t.login(t.id('cs'));
select lives_ok($$insert into public.order_items (id, order_id, declared_name_vi, model, qty, unit_price_cny, manufacturer) values (t.id('I1'), t.id('O1'), 'Bao lì xì giấy', 'YN01', 100, 0.68, 'Nghĩa Ô')$$, 'K7 CSKH lập dòng khai báo');
select throws_ok($$select public.confirm_order_item(t.id('I1'))$$, '42501', null, 'K8 CSKH không tự xác nhận khai báo');
select t.logout();

select t.login(t.id('xnk'));
select throws_ok($$select public.confirm_order_item(t.id('I1'))$$, '22023', null, 'K9 chưa có HS thì không xác nhận được');
update public.order_items set hs_code = '48172000', row_version = row_version where id = t.id('I1');
select lives_ok($$select public.confirm_order_item(t.id('I1'))$$, 'K10 XNK xác nhận, lưu thư viện');
insert into public.trips (id, plate) values (t.id('T1'), '20C-123.45');
insert into public.picking_lists (id, trip_id) values (t.id('PL1'), t.id('T1')), (t.id('PL2'), t.id('T1'));
insert into public.picking_list_items (picking_list_id, order_item_id, qty) values (t.id('PL1'), t.id('I1'), 60);
select throws_ok($$insert into public.picking_list_items (picking_list_id, order_item_id, qty) values (t.id('PL2'), t.id('I1'), 50)$$, '23514', null, 'K11 không bốc vượt số lượng (60 + 50 > 100)');
insert into public.picking_list_packages (picking_list_id, package_id) values (t.id('PL1'), t.id('P1'));
select throws_ok($$insert into public.picking_list_packages (picking_list_id, package_id) values (t.id('PL2'), t.id('P1'))$$, '23514', null, 'K12 một kiện không nằm 2 list bốc');
select lives_ok($$select public.lock_trip(t.id('T1'))$$, 'K13 chốt list xe tạo bộ dữ liệu');
select throws_ok($$update public.declaration_snapshots set lines = '[]' where trip_id = t.id('T1')$$, '42501', null, 'K14 bộ dữ liệu đã chốt không sửa được');
select t.logout();

select t.login(t.id('tv'));
select is((select count(*)::int from public.packages), 0, 'K15 Thịnh Vượng không thấy kiện của Sen Vàng');
select is((select count(*)::int from public.picking_lists), 0, 'K16 khách không thấy list bốc (chứa hàng nhiều khách)');
select t.logout();

select * from finish();
rollback;
