-- Test cấp tài khoản (mời) – ai được mời ai
begin;
create extension if not exists pgtap;
select plan(12);

create schema t;
create function t.login(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p)::text, true); execute 'set local role authenticated'; end $$;
create function t.logout() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
grant usage on schema t to authenticated; grant execute on all functions in schema t to authenticated;
create temp table ids (k text primary key, v uuid default gen_random_uuid());
grant select on ids to authenticated;
insert into ids (k) select unnest(array['admin','cs_a','lc_admin','tv_admin','sv_user','LC','KH2','SV','TV','n1','n2','n3','n4','n5','n6']);
create function t.id(p text) returns uuid language sql stable as $$ select v from ids where k = p $$;
grant execute on function t.id(text) to authenticated;

insert into auth.users (id, email) select v, k || '@t.local' from ids where k not in ('LC','KH2','SV','TV');
insert into public.profiles (user_id, full_name, user_type) values
  (t.id('admin'),'admin','staff'), (t.id('cs_a'),'cs_a','staff'),
  (t.id('lc_admin'),'lc_admin','customer'), (t.id('tv_admin'),'tv_admin','customer'), (t.id('sv_user'),'sv_user','customer');
insert into public.user_roles (user_id, role_id) select t.id(u), r.id from (values
  ('admin','admin'),('cs_a','cs'),('lc_admin','cust_admin'),('tv_admin','cust_admin'),('sv_user','cust_member')) x(u, c)
  join public.roles r on r.code = x.c;
insert into public.customers (id, code, name) values (t.id('LC'),'LC','Lanchi'), (t.id('KH2'),'KH2','KH2');
insert into public.customer_entities (id, customer_id, code, legal_name) values
  (t.id('SV'), t.id('LC'), 'SV', 'Sen Vàng'), (t.id('TV'), t.id('LC'), 'TV', 'Thịnh Vượng');
insert into public.customer_users (user_id, customer_id, entity_id) values
  (t.id('lc_admin'), t.id('LC'), null), (t.id('tv_admin'), t.id('LC'), t.id('TV')), (t.id('sv_user'), t.id('LC'), t.id('SV'));
insert into public.staff_customer_assignments (staff_user_id, customer_id, valid_from) values (t.id('cs_a'), t.id('LC'), current_date - 1);

select t.login(t.id('admin'));
select lives_ok($$select public.provision_user(t.id('n1'), 'n1@t.local', 'Nhân viên kho', 'staff', 'warehouse_vn')$$, 'P1 Admin cấp tài khoản nhân viên');
select is((select role_names from public.user_directory where user_id = t.id('n1')), 'Kho Việt Nam', 'P2 vai trò được gán đúng');
select t.logout();

select t.login(t.id('cs_a'));
select throws_ok($$select public.provision_user(t.id('n2'), 'n2@t.local', 'x', 'staff', 'admin')$$, '42501', null, 'P3 CSKH không cấp được tài khoản nhân viên');
select lives_ok($$select public.provision_user(t.id('n2'), 'n2@t.local', 'Kế toán SV', 'customer', 'cust_member', t.id('LC'), t.id('SV'))$$, 'P4 CSKH mời tài khoản cho khách mình phụ trách');
select throws_ok($$select public.provision_user(t.id('n3'), 'n3@t.local', 'x', 'customer', 'cust_member', t.id('KH2'), null)$$, '42501', null, 'P5 CSKH không mời được cho khách không phụ trách');
select t.logout();

select t.login(t.id('lc_admin'));
select lives_ok($$select public.provision_user(t.id('n3'), 'n3@t.local', 'TV mới', 'customer', 'cust_member', t.id('LC'), t.id('TV'))$$, 'P6 Quản trị Lanchi mời được vào mọi công ty con');
select throws_ok($$select public.provision_user(t.id('n4'), 'n4@t.local', 'x', 'staff', 'admin')$$, '42501', null, 'P7 Khách không tạo được nhân viên/admin');
select t.logout();

select t.login(t.id('tv_admin'));
select throws_ok($$select public.provision_user(t.id('n4'), 'n4@t.local', 'x', 'customer', 'cust_member', t.id('LC'), t.id('SV'))$$, '42501', null, 'P8 Quản trị Thịnh Vượng không mời vào Sen Vàng');
select throws_ok($$select public.provision_user(t.id('n4'), 'n4@t.local', 'x', 'customer', 'cust_member', t.id('LC'), null)$$, '42501', null, 'P9 Quản trị Thịnh Vượng không mời tài khoản toàn Lanchi');
select lives_ok($$select public.provision_user(t.id('n4'), 'n4@t.local', 'TV 2', 'customer', 'cust_admin', t.id('LC'), t.id('TV'))$$, 'P10 Quản trị Thịnh Vượng mời trong công ty mình');
select t.logout();

select t.login(t.id('sv_user'));
select throws_ok($$select public.provision_user(t.id('n5'), 'n5@t.local', 'x', 'customer', 'cust_member', t.id('LC'), t.id('SV'))$$, '42501', null, 'P11 Thành viên thường không mời được');
select is((select count(*)::int from public.user_directory), 1, 'P12 Thành viên thường chỉ thấy chính mình trong danh bạ');
select t.logout();

select * from finish();
rollback;
