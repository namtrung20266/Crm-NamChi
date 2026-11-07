-- Vòng 3: tự lập phiếu khi gửi đơn, phiếu tự chốt (khách chỉ xem), phân công CSKH sửa được
begin;
create extension if not exists pgtap;
select plan(7);
create schema t;
create function t.login(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p)::text, true); execute 'set local role authenticated'; end $$;
create function t.logout() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
grant usage on schema t to authenticated; grant execute on all functions in schema t to authenticated;
create temp table ids (k text primary key, v uuid default gen_random_uuid()); grant select on ids to authenticated;
insert into ids (k) select unnest(array['adm','cs1','cs2','sv','LC','SV','O1']);
create function t.id(p text) returns uuid language sql stable as $$ select v from ids where k = p $$; grant execute on function t.id(text) to authenticated;
insert into auth.users (id, email) select v, k || '@t.local' from ids where k in ('adm','cs1','cs2','sv');
insert into public.profiles (user_id, full_name, user_type) values (t.id('adm'),'Admin','staff'),(t.id('cs1'),'CS1','staff'),(t.id('cs2'),'CS2','staff'),(t.id('sv'),'SV','customer');
insert into public.user_roles (user_id, role_id) select t.id(u), r.id from (values ('adm','admin'),('cs1','cs'),('cs2','cs'),('sv','cust_admin')) x(u,c) join public.roles r on r.code = x.c;
insert into public.customers (id, code, name) values (t.id('LC'),'LC','Lanchi');
insert into public.customer_entities (id, customer_id, code, legal_name) values (t.id('SV'),t.id('LC'),'SV','Sen Vàng');
insert into public.customer_users values (t.id('sv'),t.id('LC'),t.id('SV'));

select t.login(t.id('adm'));
select lives_ok($$select public.set_cs_assignment(t.id('LC'), t.id('SV'), t.id('cs1'))$$, 'A1 admin phân công CSKH cho công ty con');
select t.logout();
select t.login(t.id('sv'));
select lives_ok($$insert into public.orders (id, customer_id, entity_id, goods_cny, goods_desc, status) values (t.id('O1'), t.id('LC'), t.id('SV'), 10000, 'Hàng test', 'cho_bao_gia')$$, 'A2 khách gửi đơn');
select is((select status from public.order_statements where order_id = t.id('O1')), 'confirmed', 'A3 phiếu tạm tính tự lập và tự chốt');
select is((select status from public.orders where id = t.id('O1')), 'cho_coc', 'A4 đơn chuyển thẳng Chờ đặt cọc, khách không cần xác nhận');
select t.logout();
select is((select cs_owner_id from public.orders where id = t.id('O1')), t.id('cs1'), 'A5 đơn tự gán CSKH công ty con');
select t.login(t.id('adm'));
select lives_ok($$select public.set_cs_assignment(t.id('LC'), t.id('SV'), t.id('cs2'), true)$$, 'A6 đổi CSKH, chuyển cả đơn đang chạy');
select t.logout();
select is((select cs_owner_id from public.orders where id = t.id('O1')), t.id('cs2'), 'A7 đơn đang chạy chuyển sang CSKH mới');
select * from finish();
rollback;
