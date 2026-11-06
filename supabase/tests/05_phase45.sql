-- Test Giai đoạn 4–5: kho VN, giao hàng, hóa đơn, khiếu nại, credit note
begin;
create extension if not exists pgtap;
select plan(16);
create schema t;
create function t.login(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p)::text, true); execute 'set local role authenticated'; end $$;
create function t.logout() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create function t.affected(p_sql text) returns int language plpgsql as $f$ declare n int; begin execute p_sql; get diagnostics n = row_count; return n; end $f$;
grant usage on schema t to authenticated; grant execute on all functions in schema t to authenticated;
create temp table ids (k text primary key, v uuid default gen_random_uuid());
grant select on ids to authenticated;
insert into ids (k) select unnest(array['whvn','acc','acc2','adm','sv','tv','LC','SV','TV','O1','I1','P1','P2','PL','T1','G1','PI','SI','C1','CN']);
create function t.id(p text) returns uuid language sql stable as $$ select v from ids where k = p $$;
grant execute on function t.id(text) to authenticated;
insert into auth.users (id, email) select v, k || '@t.local' from ids where k in ('whvn','acc','acc2','adm','sv','tv');
insert into public.profiles (user_id, full_name, user_type) values (t.id('whvn'),'whvn','staff'),(t.id('acc'),'acc','staff'),(t.id('acc2'),'acc2','staff'),(t.id('adm'),'adm','staff'),(t.id('sv'),'sv','customer'),(t.id('tv'),'tv','customer');
insert into public.user_roles (user_id, role_id) select t.id(u), r.id from (values ('whvn','warehouse_vn'),('acc','accountant'),('acc2','accountant'),('adm','admin'),('sv','cust_member'),('tv','cust_member')) x(u,c) join public.roles r on r.code = x.c;
insert into public.customers (id, code, name) values (t.id('LC'),'LC','Lanchi');
insert into public.customer_entities (id, customer_id, code, legal_name) values (t.id('SV'),t.id('LC'),'SV','Sen Vàng'),(t.id('TV'),t.id('LC'),'TV','Thịnh Vượng');
insert into public.customer_users values (t.id('sv'),t.id('LC'),t.id('SV')),(t.id('tv'),t.id('LC'),t.id('TV'));
-- dựng sẵn đơn → kiện → dòng đã xác nhận → list bốc → xe (bằng quyền chủ DB)
insert into public.orders (id, customer_id, entity_id, goods_cny, fx_rate, status) values (t.id('O1'), t.id('LC'), t.id('SV'), 1000, 3650, 'tren_xe');
insert into public.packages (id, order_id, seq_no, gw_kg) values (t.id('P1'), t.id('O1'), 1, 10), (t.id('P2'), t.id('O1'), 2, 10);
insert into public.order_items (id, order_id, declared_name_vi, hs_code, qty, unit_price_cny, status, compliance_need, compliance_status)
values (t.id('I1'), t.id('O1'), 'Bao lì xì', '48172000', 100, 1, 'da_xac_nhan', 'hop_quy', 'dang_lam');
insert into public.trips (id) values (t.id('T1'));
insert into public.picking_lists (id, trip_id) values (t.id('PL'), t.id('T1'));
insert into public.picking_list_items (picking_list_id, order_item_id, qty) values (t.id('PL'), t.id('I1'), 100);
insert into public.picking_list_packages (picking_list_id, package_id) values (t.id('PL'), t.id('P1')), (t.id('PL'), t.id('P2'));

select t.login(t.id('whvn'));
select is((public.receive_trip(t.id('T1'), 1)) ->> 'ok', 'false', 'V1 đếm lệch (1/2) → yêu cầu kiểm từng kiện');
select is((public.receive_trip(t.id('T1'), 2)) ->> 'ok', 'true', 'V2 đếm đủ 2/2 → xe về đủ');
select is((select status from public.orders where id = t.id('O1')), 've_kho_vn', 'V3 đơn tự chuyển "Đã về kho VN"');
insert into public.goods_issues (id, order_id) values (t.id('G1'), t.id('O1'));
select lives_ok($$insert into public.goods_issue_lines (goods_issue_id, order_item_id, qty) values (t.id('G1'), t.id('I1'), 60)$$, 'V4 lập phiếu giao 60');
select throws_ok($$insert into public.goods_issue_lines (goods_issue_id, order_item_id, qty) values ((select id from public.goods_issues where id = t.id('G1')), t.id('I1'), 50)$$, '23514', null, 'V5 không giao vượt số đã về (60 + 50 > 100)');
select t.logout();

select t.login(t.id('acc'));
insert into public.purchase_invoices (id, seller_id, invoice_no, invoice_date) values (t.id('PI'), (select id from public.trade_parties where code = 'APT'), '0001', current_date);
insert into public.purchase_invoice_lines (purchase_invoice_id, order_item_id, hh_code, description, uom, qty, unit_price_vnd, amount_vnd, vat_rate, vat_vnd)
values (t.id('PI'), t.id('I1'), 'HH0001', 'Bao lì xì', 'Chiếc', 80, 4000, 320000, 8, 25600);
insert into public.sales_invoices (id, customer_id, entity_id, batch_label) values (t.id('SI'), t.id('LC'), t.id('SV'), 'L1');
select throws_ok($$insert into public.sales_invoice_lines (sales_invoice_id, order_item_id, description, uom, qty, unit_price_vnd, amount_vnd, vat_rate, vat_vnd) values (t.id('SI'), t.id('I1'), 'x', 'Chiếc', 10, 4500, 45000, 8, 3600)$$, '23514', null, 'H1 dòng đang làm hợp quy → chưa được xuất HĐ');
select t.logout();
update public.order_items set compliance_status = 'dat', row_version = row_version where id = t.id('I1');
select t.login(t.id('acc'));
select lives_ok($$insert into public.sales_invoice_lines (sales_invoice_id, order_item_id, description, uom, qty, unit_price_vnd, amount_vnd, vat_rate, vat_vnd) values (t.id('SI'), t.id('I1'), 'Bao lì xì', 'Chiếc', 50, 4500, 225000, 8, 18000)$$, 'H2 có hợp quy → xuất HĐ L1 50');
select throws_ok($$insert into public.sales_invoice_lines (sales_invoice_id, order_item_id, description, uom, qty, unit_price_vnd, amount_vnd, vat_rate, vat_vnd) values (t.id('SI'), t.id('I1'), 'Bao lì xì', 'Chiếc', 40, 4500, 180000, 8, 14400)$$, '23514', null, 'H3 không xuất vượt HĐ đầu vào (50 + 40 > 80)');
select is((select purchased_qty - sold_qty from public.invoice_stock where order_item_id = t.id('I1')), 30.000::numeric, 'H4 tồn HĐ còn 30');
select throws_ok($$update public.sales_invoices set status = 'da_phat_hanh' where id = t.id('SI')$$, '23514', null, 'H5 phát hành phải có số và ngày HĐ');
select t.logout();

select t.login(t.id('sv'));
select is((select count(*)::int from public.sales_invoices), 0, 'H6 khách chưa thấy HĐ khi chưa phát hành');
select lives_ok($$insert into public.claims (id, order_id, claim_type, description, requested_vnd) values (t.id('C1'), t.id('O1'), 'hong', 'Rách 2 kiện', 200000)$$, 'C1 khách tạo khiếu nại');
select t.logout();
select t.login(t.id('tv'));
select is((select count(*)::int from public.claims), 0, 'C2 Thịnh Vượng không thấy khiếu nại của Sen Vàng');
select t.logout();

select t.login(t.id('acc'));
insert into public.credit_notes (id, order_id, claim_id, kind, amount_vnd, reason) values (t.id('CN'), t.id('O1'), t.id('C1'), 'boi_thuong', 200000, 'Bồi thường 2 kiện rách');
select throws_ok($$select public.approve_credit_note(t.id('CN'))$$, '42501', null, 'C3 người lập không tự duyệt');
select throws_ok($$update public.credit_notes set status = 'da_duyet' where id = t.id('CN')$$, '42501', null, 'C4 không duyệt bằng cách sửa trực tiếp');
select t.logout();
select t.login(t.id('acc2'));
select throws_ok($$select public.approve_credit_note(t.id('CN'))$$, '42501', null, 'C5 vượt ngưỡng 50.000đ → kế toán không duyệt được, cần Admin');
select t.logout();

select * from finish();
rollback;
