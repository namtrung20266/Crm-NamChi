-- NAMCHI ERP – làm lại luồng đơn hàng (07/11/2026), phần 2/3. Đã áp lên Supabase bằng connector (bản rút gọn chú thích).
create or replace function public.set_order_status(p_order_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders; cur public.order_status_defs; tgt public.order_status_defs;
begin
select * into o from public.orders where id = p_order_id and deleted_at is null for update;
if not found or not (app.has_perm('order.write') and app.staff_can_see_customer(o.customer_id)) then
raise exception 'Không có quyền đổi trạng thái đơn này' using errcode = '42501';
end if;
select * into tgt from public.order_status_defs where code = p_status and is_active;
if not found then raise exception 'Trạng thái không hợp lệ' using errcode = '22023'; end if;
if p_status = o.status then return; end if;
select * into cur from public.order_status_defs where code = o.status;
if (tgt.rank < cur.rank or p_status in ('huy', 'tam_giu') or o.status in ('huy', 'tam_giu', 'hoan_tat'))
and coalesce(length(trim(p_note)), 0) < 5 then
raise exception 'Lùi trạng thái, tạm giữ, hủy hoặc mở lại đơn: ghi rõ lý do (tối thiểu 5 ký tự)' using errcode = '22023';
end if;
if p_status = 'huy' and app.order_paid_vnd(o.id) > 0 then
raise exception 'Đơn đã nhận % đ. Hoàn tiền về ví trước khi hủy.', app.order_paid_vnd(o.id) using errcode = '23514';
end if;
perform app.apply_order_status(o.id, p_status, nullif(trim(p_note), ''), 'manual');
end $$;
create or replace function public.submit_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
select * into o from public.orders where id = p_order_id and deleted_at is null for update;
if not found or not app.can_see_entity(o.customer_id, o.entity_id)
or not (app.has_perm('order.create_own') or (app.has_perm('order.write') and app.staff_can_see_customer(o.customer_id))) then
raise exception 'Không có quyền gửi đơn này' using errcode = '42501';
end if;
if o.status <> 'dang_len_don' then raise exception 'Đơn đã được gửi' using errcode = '22023'; end if;
if o.goods_cny <= 0 then raise exception 'Nhập tổng tiền hàng trước khi gửi' using errcode = '22023'; end if;
if coalesce((app.setting('order.require_attachment_on_submit'))::text::boolean, false)
and not exists (select 1 from public.attachments a where a.entity_type = 'order' and a.entity_ref_id = o.id and a.deleted_at is null) then
raise exception 'Đính kèm ảnh hoặc file đơn trước khi gửi' using errcode = '22023';
end if;
perform set_config('app.sys', 'on', true);
update public.orders set submitted_at = now(), row_version = row_version where id = o.id;
perform set_config('app.sys', '', true);
perform app.apply_order_status(o.id, 'cho_bao_gia', 'Khách gửi đơn', case when app.is_staff() then 'manual' else 'customer' end);
end $$;
create or replace function app.sync_order_status(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
o public.orders; st public.order_statements;
v_tgt text; v_reason text; v_paid bigint; v_dep bigint;
v_pkg_n integer; v_pkg_min integer; v_items integer; v_full_deliv integer; v_any_deliv integer; v_full_inv integer;
v_sp numeric;
r_cur integer; r_tgt integer;
begin
if p_order_id is null or not coalesce((app.setting('order.auto_status_enabled'))::text::boolean, true) then return; end if;
select * into o from public.orders where id = p_order_id and deleted_at is null;
if not found or o.status in ('huy', 'tam_giu', 'hoan_tat', 'dang_len_don') then return; end if;
v_tgt := o.status;
select * into st from public.order_statements where order_id = o.id and status <> 'superseded' order by version desc limit 1;
if st.id is not null and st.status = 'confirmed' and app.status_rank(v_tgt) < app.status_rank('cho_coc') then
v_tgt := 'cho_coc'; v_reason := 'Khách đã xác nhận báo giá';
end if;
v_paid := app.order_paid_vnd(o.id);
if st.id is not null and v_paid > 0 then
v_dep := greatest(least(st.deposit_vnd, st.total_vnd), 1);
if v_paid >= v_dep and app.status_rank(v_tgt) < app.status_rank('dang_mua') then
v_tgt := 'dang_mua'; v_reason := 'Đã nhận cọc ' || to_char(v_paid, 'FM999G999G999G999') || ' đ';
end if;
end if;
select coalesce(sum(amount_cny), 0) into v_sp from public.supplier_payments where order_id = o.id and deleted_at is null;
if o.goods_cny > 0 and v_sp >= o.goods_cny and app.status_rank(v_tgt) < app.status_rank('cho_shop_giao') then
v_tgt := 'cho_shop_giao'; v_reason := 'Đã thanh toán đủ nhà cung cấp';
end if;
select count(*), min(case p.status
when 'du_kien' then 0
when 've_kho' then case when w.code in ('BT','AP') then 2 when w.country = 'VN' then 4 else 1 end
when 'tren_xe' then 3
when 'da_giao' then 5
else 4 end)
into v_pkg_n, v_pkg_min
from public.packages p left join public.warehouses w on w.id = p.warehouse_id
where p.order_id = o.id and p.deleted_at is null;
if v_pkg_n > 0 and v_pkg_min > 0 then
if app.status_rank(v_tgt) < app.status_rank(case v_pkg_min when 1 then 've_kho_qc' when 2 then 've_bang_tuong' when 3 then 'tren_xe' else 've_kho_vn' end) then
v_tgt := case v_pkg_min when 1 then 've_kho_qc' when 2 then 've_bang_tuong' when 3 then 'tren_xe' else 've_kho_vn' end;
v_reason := 'Đủ ' || v_pkg_n || ' kiện: ' || (select label from public.order_status_defs where code = v_tgt);
end if;
end if;
select count(*),
count(*) filter (where d.qty_out >= i.qty),
count(*) filter (where d.qty_out > 0)
into v_items, v_full_deliv, v_any_deliv
from public.order_items i
left join lateral (select coalesce(sum(gl.qty), 0) qty_out from public.goods_issue_lines gl join public.goods_issues g on g.id = gl.goods_issue_id
where gl.order_item_id = i.id and g.status = 'da_giao' and g.deleted_at is null) d on true
where i.order_id = o.id and i.deleted_at is null;
if v_items > 0 and v_full_deliv = v_items and app.status_rank(v_tgt) < app.status_rank('da_giao') then
v_tgt := 'da_giao'; v_reason := 'Đã giao đủ ' || v_items || ' dòng hàng';
elsif v_any_deliv > 0 and app.status_rank(v_tgt) < app.status_rank('dang_giao') then
v_tgt := 'dang_giao'; v_reason := 'Đã giao ' || v_any_deliv || '/' || v_items || ' dòng hàng';
end if;
if v_tgt = 'da_giao' and st.id is not null and st.kind = 'quyet_toan' and v_paid + app.order_credit_vnd(o.id) >= st.total_vnd then
select count(*) filter (where coalesce(s.sold, 0) >= i.qty) into v_full_inv
from public.order_items i
left join lateral (select sum(sl.qty) sold from public.sales_invoice_lines sl join public.sales_invoices si on si.id = sl.sales_invoice_id
where sl.order_item_id = i.id and si.status = 'da_phat_hanh' and si.deleted_at is null) s on true
where i.order_id = o.id and i.deleted_at is null;
if not coalesce((app.setting('order.complete_requires_invoice'))::text::boolean, true) or v_full_inv = v_items then
v_tgt := 'hoan_tat'; v_reason := 'Giao đủ, thu đủ theo quyết toán, đã xuất HĐ đủ';
end if;
end if;
if v_tgt <> o.status and app.status_rank(v_tgt) > app.status_rank(o.status) then
perform app.apply_order_status(o.id, v_tgt, 'Tự động: ' || coalesce(v_reason, ''), 'auto');
end if;
end $$;
create or replace function app.status_rank(p_code text)
returns integer language sql stable security definer set search_path = '' as $$
select rank from public.order_status_defs where code = p_code;
$$;
create or replace function app.tg_sync_order()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_order uuid;
begin
if tg_table_name in ('order_statements','wallet_ledger','receipt_allocations','supplier_payments','packages','goods_issues') then
v_order := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
perform app.sync_order_status(v_order);
elsif tg_table_name = 'goods_issue_lines' then
perform app.sync_order_status((select order_id from public.goods_issues where id = new.goods_issue_id));
elsif tg_table_name = 'sales_invoices' then
perform app.sync_order_status(x.order_id) from (select distinct i.order_id from public.sales_invoice_lines l
join public.order_items i on i.id = l.order_item_id where l.sales_invoice_id = new.id) x;
end if;
return null;
end $$;
create trigger order_statements_sync after insert or update of status on public.order_statements for each row execute function app.tg_sync_order();
create trigger wallet_ledger_sync after insert on public.wallet_ledger for each row when (new.order_id is not null) execute function app.tg_sync_order();
create trigger receipt_allocations_sync after insert on public.receipt_allocations for each row execute function app.tg_sync_order();
create trigger supplier_payments_sync after insert or update on public.supplier_payments for each row execute function app.tg_sync_order();
create trigger packages_sync after insert or update of status, warehouse_id, deleted_at on public.packages for each row execute function app.tg_sync_order();
create trigger goods_issues_sync after update of status on public.goods_issues for each row execute function app.tg_sync_order();
create trigger goods_issue_lines_sync after insert on public.goods_issue_lines for each row execute function app.tg_sync_order();
create trigger sales_invoices_sync after update of status on public.sales_invoices for each row execute function app.tg_sync_order();
create or replace function public.receive_trip(p_trip_id uuid, p_counted integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_expected integer; v_vn uuid; v_n integer;
begin
if not app.has_perm('warehouse.write') then raise exception 'Không có quyền kho' using errcode = '42501'; end if;
select count(*) into v_expected from public.picking_lists pl join public.picking_list_packages x on x.picking_list_id = pl.id
where pl.trip_id = p_trip_id and pl.status <> 'huy';
if v_expected = 0 then raise exception 'Xe chưa có kiện nào trên list bốc' using errcode = '22023'; end if;
if p_counted <> v_expected then
return jsonb_build_object('ok', false, 'expected', v_expected, 'counted', p_counted, 'message', 'Lệch số kiện: cần kiểm từng kiện theo đơn');
end if;
select id into v_vn from public.warehouses where code = 'VN';
update public.packages p set status = 've_vn', warehouse_id = v_vn, row_version = p.row_version
where p.id in (select x.package_id from public.picking_lists pl join public.picking_list_packages x on x.picking_list_id = pl.id
where pl.trip_id = p_trip_id and pl.status <> 'huy')
and p.status not in ('da_giao');
get diagnostics v_n = row_count;
perform set_config('app.sys', 'on', true);
update public.orders o set vn_received_at = coalesce(o.vn_received_at, current_date), row_version = o.row_version
where o.id in (select distinct p.order_id from public.picking_lists pl join public.picking_list_packages x on x.picking_list_id = pl.id
join public.packages p on p.id = x.package_id where pl.trip_id = p_trip_id and pl.status <> 'huy');
perform set_config('app.sys', '', true);
update public.trips set status = 've_vn', actual_date = coalesce(actual_date, current_date), row_version = row_version where id = p_trip_id;
return jsonb_build_object('ok', true, 'expected', v_expected, 'counted', p_counted, 'updated', v_n);
end $$;
create or replace function public.finish_trip_receipt(p_trip_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
if not app.has_perm('warehouse.write') then raise exception 'Không có quyền kho' using errcode = '42501'; end if;
if coalesce(length(trim(p_note)), 0) < 5 then raise exception 'Ghi rõ tình trạng lệch (thiếu/hỏng)' using errcode = '22023'; end if;
perform set_config('app.change_reason', p_note, true);
update public.trips set status = 've_vn', actual_date = coalesce(actual_date, current_date),
note = concat_ws(' | ', note, 'Nhận lệch: ' || p_note), row_version = row_version where id = p_trip_id;
perform set_config('app.sys', 'on', true);
update public.orders o set vn_received_at = coalesce(o.vn_received_at, current_date), row_version = o.row_version
where o.id in (select distinct p.order_id from public.picking_lists pl join public.picking_list_packages x on x.picking_list_id = pl.id
join public.packages p on p.id = x.package_id where pl.trip_id = p_trip_id and pl.status <> 'huy' and p.status in ('ve_vn','da_giao'));
perform set_config('app.sys', '', true);
perform app.sync_order_status(x.order_id) from (select distinct p.order_id from public.picking_lists pl
join public.picking_list_packages pk on pk.picking_list_id = pl.id join public.packages p on p.id = pk.package_id where pl.trip_id = p_trip_id) x;
end $$;
create or replace function app.tg_statement_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
select * into o from public.orders where id = new.order_id;
if new.status = 'confirmed' and old.status <> 'confirmed' then
perform app.notify(app.order_staff_users(o.id), 'order.quote', 'Đơn ' || o.code || ': khách đã xác nhận phiếu tính tiền', null, '/don-hang/chi-tiet/?id=' || o.id, o.id);
end if;
return null;
end $$;
create trigger order_statements_notify after update of status on public.order_statements for each row execute function app.tg_statement_notify();
create table public.order_messages (
id bigint generated always as identity primary key,
order_id uuid not null references public.orders(id),
customer_id uuid not null,
entity_id uuid not null,
body text not null check (length(trim(body)) between 1 and 4000),
internal boolean not null default false, -- ghi chú nội bộ: khách không thấy
author_side text not null check (author_side in ('staff','customer')),
author_name text,
created_by uuid default auth.uid(),
created_at timestamptz not null default now()
);
create index order_messages_order_idx on public.order_messages(order_id, created_at);
create trigger order_messages_append_only before update or delete on public.order_messages for each row execute function app.tg_append_only();
create or replace function app.tg_order_message_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
select * into o from public.orders where id = new.order_id;
new.customer_id := o.customer_id; new.entity_id := o.entity_id;
new.created_by := auth.uid(); new.created_at := now();
new.author_side := case when app.is_staff() then 'staff' else 'customer' end;
if new.author_side = 'customer' then new.internal := false; end if;
select full_name into new.author_name from public.profiles where user_id = auth.uid();
return new;
end $$;
create trigger order_messages_defaults before insert on public.order_messages for each row execute function app.tg_order_message_defaults();
create or replace function app.tg_order_message_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o public.orders; v_title text;
begin
select * into o from public.orders where id = new.order_id;
v_title := 'Đơn ' || o.code || ': ' || coalesce(new.author_name, '') || case when new.internal then ' (nội bộ)' else '' end;
perform app.notify(app.order_staff_users(o.id), 'order.message', v_title, new.body, '/don-hang/chi-tiet/?id=' || o.id || '&tab=trao-doi', o.id);
if not new.internal and new.author_side = 'staff' then
perform app.notify(app.order_customer_users(o.id), 'order.message', 'Đơn ' || o.code || ': Nam Trung nhắn', new.body,
'/don-hang/chi-tiet/?id=' || o.id || '&tab=trao-doi', o.id);
end if;
return null;
end $$;
create trigger order_messages_notify after insert on public.order_messages for each row execute function app.tg_order_message_notify();
alter table public.attachments
add column category text,
add column note text,
add column thumb_url text;
alter table public.attachments drop constraint if exists attachments_mime_type_check;
alter table public.attachments add constraint attachments_mime_type_check check (mime_type in (
'image/jpeg','image/png','image/webp','image/heic','image/gif',
'application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel',
'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword','text/csv','application/zip',
'application/x-zip-compressed','video/mp4'));
alter table public.attachments drop constraint if exists attachments_size_bytes_check;
alter table public.attachments add constraint attachments_size_bytes_check check (size_bytes > 0 and size_bytes <= 50 * 1024 * 1024);
revoke insert on public.attachments from authenticated;
drop policy if exists attachments_insert on public.attachments;
create or replace function public.attachment_scope(p_entity_type text, p_ref_id uuid, p_visibility text default 'customer')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_c uuid; v_e uuid; v_label text; v_ok boolean := false; v_vis text; v_code text; v_order uuid;
begin
if not app.has_perm('attachment.upload') then raise exception 'Không có quyền tải file' using errcode = '42501'; end if;
if p_entity_type = 'order' then
select customer_id, entity_id, code, id into v_c, v_e, v_label, v_order from public.orders where id = p_ref_id and deleted_at is null;
v_ok := (app.is_staff() and app.staff_can_see_customer(v_c)) or (not app.is_staff() and app.can_see_entity(v_c, v_e));
elsif p_entity_type = 'order_item' then
select i.customer_id, i.entity_id, o.code || '-L' || i.line_no, o.id into v_c, v_e, v_label, v_order
from public.order_items i join public.orders o on o.id = i.order_id where i.id = p_ref_id and i.deleted_at is null;
v_ok := (app.is_staff() and app.staff_can_see_customer(v_c)) or (not app.is_staff() and app.can_see_entity(v_c, v_e));
elsif p_entity_type = 'order_message' then
raise exception 'File trong tin nhắn gắn theo đơn (order)' using errcode = '22023';
elsif p_entity_type = 'wallet_topup' then
select customer_id, entity_id, code into v_c, v_e, v_label from public.wallet_topups where id = p_ref_id and deleted_at is null;
v_ok := (app.is_staff() and app.has_perm('finance.read') and app.staff_can_see_customer(v_c)) or (not app.is_staff() and app.can_see_entity(v_c, v_e));
elsif p_entity_type = 'package' then
select p.customer_id, p.entity_id, o.code || '-K' || p.seq_no, o.id into v_c, v_e, v_label, v_order
from public.packages p join public.orders o on o.id = p.order_id where p.id = p_ref_id;
v_ok := app.is_staff() and app.staff_can_see_customer(v_c);
elsif p_entity_type = 'claim' then
select customer_id, entity_id, code, order_id into v_c, v_e, v_label, v_order from public.claims where id = p_ref_id;
v_ok := (app.is_staff() and app.staff_can_see_customer(v_c)) or (not app.is_staff() and app.can_see_entity(v_c, v_e));
else
raise exception 'Loại đối tượng không hỗ trợ đính kèm' using errcode = '22023';
end if;
if v_c is null or not v_ok then raise exception 'Không có quyền đính kèm vào đối tượng này' using errcode = '42501'; end if;
v_vis := case when not app.is_staff() then 'customer' when p_visibility = 'internal' then 'internal' else 'customer' end;
select code into v_code from public.customers where id = v_c;
return jsonb_build_object('customer_id', v_c, 'entity_id', v_e, 'visibility', v_vis, 'label', v_label, 'order_id', v_order,
'folder', v_code || '/' || p_entity_type || '/' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM'),
'max_bytes', coalesce((app.setting('file.max_size_bytes'))::text::bigint, 20971520),
'user_id', auth.uid());
end $$;
create or replace function public.remove_attachment(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.attachments;
begin
select * into a from public.attachments where id = p_id and deleted_at is null for update;
if not found then raise exception 'Không tìm thấy file' using errcode = '42501'; end if;
if not ((app.is_staff() and app.has_perm('attachment.upload') and (a.customer_id is null or app.staff_can_see_customer(a.customer_id)))
or (a.created_by = auth.uid() and a.created_at > now() - interval '24 hours')) then
raise exception 'Chỉ người tải lên (trong 24 giờ) hoặc nhân viên phụ trách được gỡ file' using errcode = '42501';
end if;
update public.attachments set deleted_at = now(), row_version = row_version where id = a.id;
end $$;
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
if not app.has_perm('finance.statement.write') then
raise exception 'Không có quyền lập phiếu tính tiền' using errcode = '42501';
end if;
if p_kind not in ('du_tinh', 'tam_tinh', 'quyet_toan') then
raise exception 'Loại phiếu không hợp lệ' using errcode = '22023';
end if;
select * into o from public.orders where id = p_order_id and deleted_at is null for update;
if not found or not app.staff_can_see_customer(o.customer_id) then
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
