-- =====================================================================
-- Test bảo mật Giai đoạn 1 (tài liệu mục 8.5) – pgTAP
-- Chạy: supabase test db   hoặc   scripts/local/run_tests.sh
-- Toàn bộ chạy trong transaction và ROLLBACK, không để lại dữ liệu.
-- =====================================================================
begin;
create extension if not exists pgtap;
select plan(45);

-- ---------------------------------------------------------------------
-- Dữ liệu dựng test (chạy bằng quyền chủ DB)
-- ---------------------------------------------------------------------
create schema t;
create function t.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function t.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;
grant usage on schema t to authenticated, anon, service_role;
grant execute on all functions in schema t to authenticated, anon, service_role;

create function t.affected(p_sql text) returns int language plpgsql as $f$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $f$;

create temp table ids (k text primary key, v uuid);
grant select on ids to authenticated, anon, service_role;
insert into ids values
  ('admin', gen_random_uuid()), ('manager', gen_random_uuid()), ('cs_a', gen_random_uuid()),
  ('cs_b', gen_random_uuid()), ('accountant', gen_random_uuid()), ('xnk', gen_random_uuid()),
  ('wh_cn', gen_random_uuid()), ('wh_vn', gen_random_uuid()),
  ('lc_admin', gen_random_uuid()), ('sv_user', gen_random_uuid()), ('tv_user', gen_random_uuid()),
  ('kh2_user', gen_random_uuid()),
  ('LC', gen_random_uuid()), ('KH2', gen_random_uuid()),
  ('SV', gen_random_uuid()), ('TV', gen_random_uuid()), ('K2E', gen_random_uuid());

create function t.id(p_k text) returns uuid language sql stable as $$ select v from ids where k = p_k $$;
grant execute on function t.id(text) to authenticated, anon;

insert into auth.users (id, email) select v, k || '@test.local' from ids
 where k not in ('LC', 'KH2', 'SV', 'TV', 'K2E');

insert into public.profiles (user_id, full_name, user_type)
select v, k, case when k in ('lc_admin', 'sv_user', 'tv_user', 'kh2_user') then 'customer' else 'staff' end
from ids where k not in ('LC', 'KH2', 'SV', 'TV', 'K2E');

insert into public.user_roles (user_id, role_id)
select t.id(x.u), r.id from (values
  ('admin','admin'), ('manager','manager'), ('cs_a','cs'), ('cs_b','cs'), ('accountant','accountant'),
  ('xnk','xnk'), ('wh_cn','warehouse_cn'), ('wh_vn','warehouse_vn'),
  ('lc_admin','cust_admin'), ('sv_user','cust_member'), ('tv_user','cust_member'), ('kh2_user','cust_member')
) x(u, r) join public.roles r on r.code = x.r;

insert into public.customers (id, code, name) values (t.id('LC'), 'LC', 'Lanchi'), (t.id('KH2'), 'KH2', 'Khách thứ hai');
insert into public.customer_entities (id, customer_id, code, legal_name) values
  (t.id('SV'),  t.id('LC'),  'SV',  'Sen Vàng'),
  (t.id('TV'),  t.id('LC'),  'TV',  'Thịnh Vượng'),
  (t.id('K2E'), t.id('KH2'), 'K2E', 'Công ty con KH2');

insert into public.customer_users (user_id, customer_id, entity_id) values
  (t.id('lc_admin'), t.id('LC'),  null),
  (t.id('sv_user'),  t.id('LC'),  t.id('SV')),
  (t.id('tv_user'),  t.id('LC'),  t.id('TV')),
  (t.id('kh2_user'), t.id('KH2'), t.id('K2E'));

insert into public.staff_customer_assignments (staff_user_id, customer_id, valid_from) values
  (t.id('cs_a'), t.id('LC'),  current_date - 10),
  (t.id('cs_b'), t.id('KH2'), current_date - 10);

insert into public.customer_contacts (customer_id, entity_id, name) values
  (t.id('LC'), null,       'Liên hệ chung Lanchi'),
  (t.id('LC'), t.id('SV'), 'Kế toán Sen Vàng'),
  (t.id('LC'), t.id('TV'), 'Kế toán Thịnh Vượng');

insert into public.attachments (customer_id, entity_id, entity_type, entity_ref_id, storage_key, file_name, mime_type, size_bytes, visibility) values
  (t.id('LC'),  t.id('SV'), 'test', gen_random_uuid(), 'f-sv',     'sv.pdf',     'application/pdf', 1000, 'customer'),
  (t.id('LC'),  t.id('TV'), 'test', gen_random_uuid(), 'f-tv',     'tv.pdf',     'application/pdf', 1000, 'customer'),
  (t.id('LC'),  null,       'test', gen_random_uuid(), 'f-lc',     'lc.pdf',     'application/pdf', 1000, 'customer'),
  (t.id('LC'),  t.id('SV'), 'test', gen_random_uuid(), 'f-int',    'noibo.pdf',  'application/pdf', 1000, 'internal'),
  (t.id('KH2'), t.id('K2E'),'test', gen_random_uuid(), 'f-kh2',    'kh2.pdf',    'application/pdf', 1000, 'customer');

-- ---------------------------------------------------------------------
-- A. Người chưa đăng nhập
-- ---------------------------------------------------------------------
set local role anon;
select throws_ok('select count(*) from public.customers', '42501', null, 'A1 anon không đọc được customers');
select throws_ok('select count(*) from public.attachments', '42501', null, 'A2 anon không đọc được attachments');
reset role;

-- ---------------------------------------------------------------------
-- B. Tài khoản khách và công ty con
-- ---------------------------------------------------------------------
select t.login(t.id('lc_admin'));
select is((select count(*)::int from public.customer_entities), 2, 'B1 Lanchi (toàn bộ) thấy đủ 2 công ty con');
select is((select count(*)::int from public.customers), 1, 'B2 Lanchi chỉ thấy khách của mình');
select is((select count(*)::int from public.attachments), 3, 'B3 Lanchi thấy file khách của cả 2 công ty con + file chung, không thấy file nội bộ');
select t.logout();

select t.login(t.id('sv_user'));
select is((select count(*)::int from public.customer_entities), 1, 'B4 Sen Vàng chỉ thấy 1 công ty con');
select is((select code from public.customer_entities), 'SV', 'B5 công ty con đó là SV');
select is((select count(*)::int from public.customer_entities where id = t.id('TV')), 0, 'B6 Sen Vàng mở thẳng ID của Thịnh Vượng → không thấy');
select is((select count(*)::int from public.attachments where storage_key = 'f-tv'), 0, 'B7 Sen Vàng không thấy file Thịnh Vượng');
select is((select count(*)::int from public.attachments where storage_key = 'f-int'), 0, 'B8 Sen Vàng không thấy file nội bộ dù gắn công ty mình');
select is((select count(*)::int from public.attachments where storage_key in ('f-sv', 'f-lc')), 2, 'B9 Sen Vàng thấy file của mình và file chung');
select is((select count(*)::int from public.customer_contacts where name = 'Kế toán Thịnh Vượng'), 0, 'B10 Sen Vàng không thấy liên hệ của Thịnh Vượng');
select is((select count(*)::int from public.customers where id = t.id('KH2')), 0, 'B11 Sen Vàng không thấy khách khác');
select is((select count(*)::int from public.customer_users), 1, 'B12 Sen Vàng chỉ thấy dòng tài khoản của chính mình');
select is((select count(*)::int from public.trade_parties), 0, 'B13 khách không thấy đối tác nhập khẩu');
select is((select count(*)::int from public.app_settings), 0, 'B14 khách không thấy cài đặt');

-- leo thang quyền
select throws_ok($$insert into public.user_roles (user_id, role_id) select t.id('sv_user'), id from public.roles where code = 'cust_admin'$$,
                 '42501', null, 'B15 khách không tự nâng mình lên quản trị khách');
select is(t.affected($$update public.customers set name = 'hack' where id = t.id('LC')$$),
          0, 'B16 khách không sửa được thông tin khách hàng');
select is(t.affected($$update public.profiles set full_name = 'hack' where user_id = t.id('tv_user')$$),
          0, 'B17 khách không sửa được hồ sơ người khác');
select throws_ok($$update public.profiles set is_active = false where user_id = t.id('sv_user')$$,
                 '42501', null, 'B18 không tự sửa cột is_active (chỉ được tên, điện thoại)');
select lives_ok($$update public.profiles set full_name = 'Sen Vàng KT' where user_id = t.id('sv_user')$$, 'B19 tự sửa tên mình được');

-- upload
select throws_ok($$insert into public.attachments (customer_id, entity_id, entity_type, entity_ref_id, storage_key, file_name, mime_type, size_bytes, visibility)
                   values (t.id('LC'), t.id('TV'), 'order', gen_random_uuid(), 'x1', 'a.png', 'image/png', 10, 'customer')$$,
                 '42501', null, 'B20 Sen Vàng không upload file vào Thịnh Vượng');
select throws_ok($$insert into public.attachments (customer_id, entity_id, entity_type, entity_ref_id, storage_key, file_name, mime_type, size_bytes, visibility)
                  values (t.id('LC'), t.id('SV'), 'order', gen_random_uuid(), 'x2', 'a.png', 'image/png', 10, 'customer')$$,
                 '42501', null, 'B21 người dùng không tự ghi bảng file (chỉ Edge Function sau khi đẩy Drive)');
select t.logout();
set local role service_role;
select throws_ok($$insert into public.attachments (customer_id, entity_id, entity_type, entity_ref_id, storage_key, file_name, mime_type, size_bytes, visibility)
                   values (t.id('LC'), t.id('SV'), 'order', gen_random_uuid(), 'x3', 'big.pdf', 'application/pdf', 60000000, 'customer')$$,
                 '23514', null, 'B22 file > 50 MB bị chặn');
select throws_ok($$insert into public.attachments (customer_id, entity_id, entity_type, entity_ref_id, storage_key, file_name, mime_type, size_bytes, visibility)
                   values (t.id('LC'), t.id('SV'), 'order', gen_random_uuid(), 'x4', 'm.xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12', 100, 'customer')$$,
                 '23514', null, 'B23 file Excel có macro (.xlsm) bị chặn');
reset role;

-- ---------------------------------------------------------------------
-- C. CSKH theo phân công
-- ---------------------------------------------------------------------
select t.login(t.id('cs_a'));
select is((select array_agg(code order by code) from public.customers), array['LC'], 'C1 CSKH A chỉ thấy Lanchi');
select is((select count(*)::int from public.attachments where storage_key = 'f-int'), 1, 'C2 CSKH thấy file nội bộ của khách mình');
select t.logout();

select t.login(t.id('cs_b'));
select is((select array_agg(code order by code) from public.customers), array['KH2'], 'C3 CSKH B chỉ thấy KH2');
select t.logout();

update public.staff_customer_assignments set valid_to = current_date - 1 where staff_user_id = t.id('cs_a');
select t.login(t.id('cs_a'));
select is((select count(*)::int from public.customers), 0, 'C4 hết phân công thì CSKH A mất quyền ngay');
select t.logout();

-- ---------------------------------------------------------------------
-- D. Quyền lợi nhuận
-- ---------------------------------------------------------------------
select t.login(t.id('wh_cn'));      select ok(not app.has_perm('finance.profit.read'), 'D1 Kho TQ không xem lợi nhuận');      select t.logout();
select t.login(t.id('wh_vn'));      select ok(not app.has_perm('finance.profit.read'), 'D2 Kho VN không xem lợi nhuận');      select t.logout();
select t.login(t.id('xnk'));        select ok(not app.has_perm('finance.profit.read'), 'D3 XNK không xem lợi nhuận');         select t.logout();
select t.login(t.id('manager'));    select ok(not app.has_perm('finance.profit.read'), 'D4 Quản lý không xem lợi nhuận');     select t.logout();
select t.login(t.id('admin'));      select ok(app.has_perm('finance.profit.read'),     'D5 Admin xem được lợi nhuận');        select t.logout();
select t.login(t.id('accountant')); select ok(app.has_perm('finance.profit.read'),     'D6 Kế toán xem được lợi nhuận');      select t.logout();

-- ---------------------------------------------------------------------
-- E. Cài đặt có hiệu lực
-- ---------------------------------------------------------------------
select t.login(t.id('manager'));
select throws_ok($$select public.set_setting('shipping.volumetric_divisor', '5000')$$, '42501', null,
                 'E1 Quản lý không đổi được cài đặt');
select t.logout();

select t.login(t.id('admin'));
select lives_ok($$select public.set_setting('shipping.volumetric_divisor', '5000', now() + interval '1 day', 'test')$$,
                'E2 Admin đặt hệ số mới có hiệu lực từ ngày mai');
select is(public.get_setting('shipping.volumetric_divisor'), '6000'::jsonb, 'E3 hôm nay vẫn là 6000 (đơn cũ không đổi)');
select is(public.get_setting('shipping.volumetric_divisor', now() + interval '2 day'), '5000'::jsonb, 'E4 từ ngày mai là 5000');
select t.logout();
select throws_ok($$update public.app_settings set value_json = '1' where key = 'shipping.volumetric_divisor' and valid_to is not null$$,
                 '42501', null, 'E5 không sửa đè được bản cài đặt cũ, kể cả chủ DB');

-- ---------------------------------------------------------------------
-- F. Nhật ký, xóa vật lý, sửa đè đồng thời
-- ---------------------------------------------------------------------
select t.login(t.id('admin'));
select set_config('app.change_reason', 'Cập nhật MST theo giấy phép', true);
update public.customers set tax_code = '0100000000' where id = t.id('LC');
select is((select count(*)::int from public.audit_log_view
           where table_name = 'public.customers' and row_id = t.id('LC')::text
             and action = 'UPDATE' and actor_id = t.id('admin') and reason = 'Cập nhật MST theo giấy phép'
             and changed_fields = array['tax_code']),
          1, 'F1 sửa khách hàng ghi nhật ký đủ người, lý do, trường đổi');
select throws_ok($$delete from public.customers where id = t.id('KH2')$$, '42501', null, 'F2 không xóa vật lý khách hàng');
select throws_ok($$update public.customers set name = 'x', row_version = row_version - 1 where id = t.id('LC')$$,
                 '40001', null, 'F3 sửa bằng phiên bản cũ bị từ chối (chống sửa đè)');
select t.logout();

select throws_ok($$update audit.logs set reason = 'xoá dấu vết'$$, '42501', null, 'F4 không sửa nhật ký, kể cả chủ DB');

select t.login(t.id('cs_b'));
select is((select count(*)::int from public.audit_log_view), 0, 'F5 CSKH không đọc nhật ký');
select t.logout();

select * from finish();
rollback;
