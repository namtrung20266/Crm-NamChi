-- Test làm lại luồng đơn: nháp/gửi đơn, đổi trạng thái có kiểm soát, đồng bộ tự động,
-- ví (nạp, duyệt, cọc, đảo), trao đổi + thông báo, quyền gắn file, tiến độ đơn, dòng khai báo của khách
begin;
create extension if not exists pgtap;
-- Giữ luồng cũ (khách xác nhận phiếu, không tự lập phiếu) để kiểm thử các bước thủ công
update public.app_settings set valid_to = now() where key in ('order.auto_quote_on_submit','order.quote_requires_customer_confirm','order.payment_requires_confirmed_quote') and valid_to is null;
insert into public.app_settings (key, value_json, note, valid_from) values
 ('order.auto_quote_on_submit','false','test',now()), ('order.quote_requires_customer_confirm','true','test',now()), ('order.payment_requires_confirmed_quote','true','test',now());
select plan(48);
create schema t;
create function t.login(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p)::text, true); execute 'set local role authenticated'; end $$;
create function t.logout() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create function t.affected(p_sql text) returns int language plpgsql as $f$ declare n int; begin execute p_sql; get diagnostics n = row_count; return n; end $f$;
grant usage on schema t to authenticated; grant execute on all functions in schema t to authenticated;
create temp table ids (k text primary key, v uuid default gen_random_uuid());
grant select on ids to authenticated;
insert into ids (k) select unnest(array['adm','acc','cs','wh','xnk','lc','sv','sv2','tv','LC','SV','TV','O1','O2','P1','P2','I1']);
create function t.id(p text) returns uuid language sql stable as $$ select v from ids where k = p $$;
grant execute on function t.id(text) to authenticated;
create temp table v (k text primary key, x text);
grant select, insert, update on v to authenticated;

insert into auth.users (id, email) select v, k || '@t.local' from ids where k in ('adm','acc','cs','wh','xnk','lc','sv','sv2','tv');
insert into public.profiles (user_id, full_name, user_type) values
 (t.id('adm'),'Admin','staff'),(t.id('acc'),'Kế toán','staff'),(t.id('cs'),'CSKH Hà','staff'),(t.id('wh'),'Kho','staff'),(t.id('xnk'),'XNK','staff'),
 (t.id('lc'),'Lanchi','customer'),(t.id('sv'),'Sen Vàng','customer'),(t.id('sv2'),'Sen Vàng 2','customer'),(t.id('tv'),'Thịnh Vượng','customer');
insert into public.user_roles (user_id, role_id) select t.id(u), r.id from (values ('adm','admin'),('acc','accountant'),('cs','cs'),('wh','warehouse_cn'),('xnk','xnk'),
  ('lc','cust_admin'),('sv','cust_admin'),('sv2','cust_member'),('tv','cust_admin')) x(u,c) join public.roles r on r.code = x.c;
insert into public.customers (id, code, name) values (t.id('LC'),'LC','Lanchi');
insert into public.customer_entities (id, customer_id, code, legal_name) values (t.id('SV'),t.id('LC'),'SV','Sen Vàng'),(t.id('TV'),t.id('LC'),'TV','Thịnh Vượng');
insert into public.customer_users values (t.id('lc'),t.id('LC'),null),(t.id('sv'),t.id('LC'),t.id('SV')),(t.id('sv2'),t.id('LC'),t.id('SV')),(t.id('tv'),t.id('LC'),t.id('TV'));
insert into public.staff_customer_assignments (staff_user_id, customer_id, valid_from) values (t.id('cs'), t.id('LC'), current_date - 1);

-- ---------------- Khách lên đơn nháp, sửa, gửi ----------------
select t.login(t.id('sv'));
select lives_ok($$insert into public.orders (id, customer_id, entity_id, goods_cny, fx_rate, goods_desc, status, internal_note)
                  values (t.id('O1'), t.id('LC'), t.id('SV'), 10000, 1, 'Lì xì Tết', 'dang_mua', 'hack')$$, 'R1 khách tạo đơn nháp');
select is((select status || '|' || fx_rate::int || '|' || coalesce(internal_note, '-') from public.orders where id = t.id('O1')), 'dang_len_don|3650|-',
          'R2 khách không tự đặt trạng thái/tỷ giá/ghi chú nội bộ');
select is(t.affected($$update public.orders set goods_cny = 20000, row_version = 1 where id = t.id('O1')$$), 1, 'R3 khách sửa đơn khi còn nháp');
select throws_ok($$update public.orders set status = 'hoan_tat' where id = t.id('O1')$$, '42501', null, 'R4 không đổi trạng thái bằng UPDATE trực tiếp');
select throws_ok($$select public.set_order_status(t.id('O1'), 'cho_bao_gia')$$, '42501', null, 'R5 khách không gọi được chuyển trạng thái nội bộ');
select lives_ok($$select public.submit_order(t.id('O1'))$$, 'R6 khách gửi đơn');
select is((select status from public.orders where id = t.id('O1')), 'cho_bao_gia', 'R7 đơn chuyển Chờ báo giá');
select is(t.affected($$update public.orders set goods_cny = 1 where id = t.id('O1')$$), 0, 'R8 đơn đã gửi: khách không sửa được');
select lives_ok($$insert into public.order_items (order_id, declared_name_vi, qty, unit_price_cny, hs_code) values (t.id('O1'), 'Bao lì xì giấy', 1000, 2, '48173000')$$,
                'R9 khách tự nhập dòng hàng cho đơn của mình');
select is((select status from public.order_items where order_id = t.id('O1')), 'nhap', 'R10 dòng khách nhập luôn ở trạng thái nháp');
select t.logout();

select t.login(t.id('tv'));
select throws_ok($$insert into public.order_items (order_id, declared_name_vi, qty) values (t.id('O1'), 'x', 1)$$, '42501', null, 'R11 công ty con khác không thêm dòng vào đơn Sen Vàng');
select is((select count(*)::int from public.orders), 0, 'R12 Thịnh Vượng không thấy đơn Sen Vàng');
select t.logout();

-- ---------------- CSKH: trạng thái có kiểm soát, báo giá ----------------
select t.login(t.id('cs'));
select is((select count(*)::int from public.notifications where kind = 'order.status'), 1, 'R13 CSKH nhận thông báo khách gửi đơn');
select throws_ok($$select public.set_order_status(t.id('O1'), 'dang_len_don')$$, '22023', null, 'R14 lùi trạng thái phải ghi lý do');
select lives_ok($$select public.set_order_status(t.id('O1'), 'dang_len_don', 'Khách cần sửa lại số lượng')$$, 'R15 lùi trạng thái khi có lý do');
select is((select note from public.order_status_history where order_id = t.id('O1') order by changed_at desc, id desc limit 1), 'Khách cần sửa lại số lượng', 'R16 lý do được lưu lịch sử');
select lives_ok($$select public.submit_order(t.id('O1'))$$, 'R17 CSKH gửi lại đơn thay khách');
select lives_ok($$select public.build_statement(t.id('O1'), 'du_tinh')$$, 'R18 lập phiếu dự tính');
insert into v values ('total', (select total_vnd::text from public.order_statements where order_id = t.id('O1') and status = 'active'));
insert into v values ('deposit', (select deposit_vnd::text from public.order_statements where order_id = t.id('O1') and status = 'active'));
select lives_ok($$insert into public.order_messages (order_id, body, internal) values (t.id('O1'), 'Khách này hay đổi mẫu, kiểm kỹ', true)$$, 'R19 CSKH ghi chú nội bộ trên đơn');
select lives_ok($$insert into public.order_messages (order_id, body) values (t.id('O1'), 'Đã gửi báo giá, anh/chị xác nhận giúp em')$$, 'R20 CSKH nhắn khách');
select t.logout();

-- ---------------- Khách: xác nhận, nạp ví, cọc ----------------
select t.login(t.id('sv'));
select ok((select count(*) from public.notifications where kind = 'order.quote') >= 1, 'R21 khách nhận thông báo có phiếu tính tiền');
select is((select count(*)::int from public.order_messages), 1, 'R22 khách không thấy ghi chú nội bộ');
select lives_ok($$insert into public.order_messages (order_id, body, internal) values (t.id('O1'), 'Em xác nhận ạ', true)$$, 'R23 khách nhắn trên đơn');
select is((select internal from public.order_messages where author_side = 'customer'), false, 'R24 tin khách luôn công khai');
select throws_ok($$select public.pay_order(t.id('O1'), 1000, 'coc')$$, '22023', null, 'R25 chưa xác nhận phiếu thì chưa thanh toán');
select lives_ok($$select public.confirm_statement((select id from public.order_statements where order_id = t.id('O1') and status = 'active'))$$, 'R26 khách xác nhận phiếu');
select is((select status from public.orders where id = t.id('O1')), 'cho_coc', 'R27 tự chuyển Chờ đặt cọc');
select throws_ok($$select public.pay_order(t.id('O1'), 1000, 'coc')$$, '23514', null, 'R28 ví không đủ tiền thì chặn');
select lives_ok($$select public.create_topup(t.id('LC'), t.id('SV'), 900000000, current_date, 'nt_vcb', 'FT26311001', 'Sen Vang', null)$$, 'R29 khách tạo yêu cầu nạp ví');
select throws_ok($$select public.create_topup(t.id('LC'), t.id('SV'), 900000000, current_date, 'nt_vcb', 'FT26311001', null, null)$$, '23505', null, 'R30 trùng mã giao dịch bị chặn');
select throws_ok($$select public.create_topup(t.id('LC'), t.id('TV'), 1000000, current_date, null, null, null, null)$$, '42501', null, 'R31 không nạp ví công ty con khác');
select is((select balance_vnd from public.wallet_balances where entity_id = t.id('SV')), 0::bigint, 'R32 chờ duyệt: ví chưa cộng');
select throws_ok($$select public.review_topup((select id from public.wallet_topups limit 1), true)$$, '42501', null, 'R33 khách không tự duyệt nạp ví');
select t.logout();

select t.login(t.id('sv2'));
select throws_ok($$select public.pay_order(t.id('O1'), 1000, 'coc')$$, '42501', null, 'R34 thành viên không có quyền thanh toán (theo ma trận quyền)');
select t.logout();

select t.login(t.id('acc'));
select ok((select count(*) from public.notifications where kind = 'wallet.topup') >= 1, 'R35 kế toán nhận thông báo yêu cầu nạp');
select lives_ok($$select public.review_topup((select id from public.wallet_topups where bank_ref = 'FT26311001'), true)$$, 'R36 kế toán duyệt nạp');
select throws_ok($$update public.wallet_ledger set amount_vnd = 1$$, '42501', null, 'R37 sổ ví không sửa được');
select t.logout();

select t.login(t.id('sv'));
select is((select balance_vnd from public.wallet_balances where entity_id = t.id('SV')), 900000000::bigint, 'R38 ví được cộng sau duyệt');
select lives_ok(format('select public.pay_order(%L, %s, %L)', t.id('O1'), (select x from v where k = 'deposit'), 'coc'), 'R39 khách đặt cọc từ ví');
select is((select status from public.orders where id = t.id('O1')), 'dang_mua', 'R40 tự chuyển Đang mua hàng sau khi cọc đủ');
select throws_ok(format('select public.pay_order(%L, %s, %L)', t.id('O1'), (select x from v where k = 'total'), 'thanh_toan'), '23514', null, 'R41 không trả vượt số còn lại');
select is((select payment_state from public.order_progress(array[t.id('O1')])), 'da_coc', 'R42 tiến độ thanh toán: đã cọc');
select is((select (public.attachment_scope('order', t.id('O1'), 'internal'))->>'visibility'), 'customer', 'R43 file khách tải lên luôn hiển thị cho khách');
select t.logout();

select t.login(t.id('tv'));
select throws_ok($$select public.attachment_scope('order', t.id('O1'))$$, '42501', null, 'R44 công ty con khác không gắn file vào đơn Sen Vàng');
select is((select count(*)::int from public.wallet_ledger), 0, 'R45 không thấy sổ ví công ty con khác');
select t.logout();

-- ---------------- Kho: kiện đồng bộ trạng thái (đủ kiện mới chuyển) ----------------
select t.login(t.id('wh'));
insert into public.packages (id, order_id, seq_no, gw_kg) values (t.id('P1'), t.id('O1'), 1, 10), (t.id('P2'), t.id('O1'), 2, 12);
update public.packages set status = 've_kho', warehouse_id = (select id from public.warehouses where code = 'QC'), row_version = 1 where id = t.id('P1');
select is((select status from public.orders where id = t.id('O1')), 'dang_mua', 'R46 mới 1/2 kiện về kho: chưa chuyển trạng thái');
update public.packages set status = 've_kho', warehouse_id = (select id from public.warehouses where code = 'QC'), row_version = 1 where id = t.id('P2');
select is((select status from public.orders where id = t.id('O1')), 've_kho_qc', 'R47 đủ kiện về Quảng Châu: tự chuyển');
select t.logout();

select t.login(t.id('acc'));
select lives_ok($$select public.reverse_wallet_entry((select id from public.wallet_ledger where kind = 'coc'), 'Trừ nhầm đơn, đảo lại')$$, 'R48 đảo bút toán cọc có lý do');
select t.logout();

select * from finish();
rollback;
