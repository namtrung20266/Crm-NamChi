-- NAMCHI ERP – làm lại luồng đơn hàng (07/11/2026), phần 3/3. Đã áp lên Supabase bằng connector (bản rút gọn chú thích).
alter table public.order_items
add column brand text,
add column product_link text check (product_link is null or product_link ~* '^https?://'),
add column packing text, -- quy cách đóng gói (VD: 12 chiếc/hộp, 10 hộp/thùng)
add column item_note text;
create or replace function app.tg_order_items_customer_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_rank integer;
begin
if auth.uid() is null or app.is_staff() then return new; end if;
select d.rank into v_rank from public.orders o join public.order_status_defs d on d.code = o.status where o.id = new.order_id;
if v_rank is null or v_rank >= 100 then
raise exception 'Hàng đã lên xe/hoàn tất, khách không sửa dòng khai báo. Nhắn CSKH trên đơn.' using errcode = '42501';
end if;
if tg_op = 'UPDATE' then
if old.status = 'da_xac_nhan' then
raise exception 'Dòng đã được XNK xác nhận, nhắn CSKH để điều chỉnh' using errcode = '42501';
end if;
new.order_id := old.order_id; new.line_no := old.line_no;
end if;
new.status := 'nhap'; new.confirmed_by := null; new.confirmed_at := null; new.catalog_id := null;
return new;
end $$;
create trigger order_items_customer_guard before insert or update on public.order_items
for each row execute function app.tg_order_items_customer_guard();
create policy order_items_insert_customer on public.order_items for insert to authenticated
with check (not app.is_staff() and app.has_perm('order.create_own')
and exists (select 1 from public.orders o where o.id = order_id and app.can_see_entity(o.customer_id, o.entity_id)));
create policy order_items_update_customer on public.order_items for update to authenticated
using (not app.is_staff() and app.has_perm('order.create_own') and status = 'nhap' and app.can_see_entity(customer_id, entity_id))
with check (not app.is_staff() and app.can_see_entity(customer_id, entity_id));
create or replace function public.add_order_items(p_order_id uuid, p_rows jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare x jsonb; n integer := 0;
begin
if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'Không có dòng nào' using errcode = '22023'; end if;
if jsonb_array_length(p_rows) > 300 then raise exception 'Tối đa 300 dòng mỗi lần' using errcode = '22023'; end if;
perform 1 from public.orders where id = p_order_id for update;
for x in select * from jsonb_array_elements(p_rows) loop
insert into public.order_items (order_id, declared_name_vi, declared_name_en, name_cn, model, brand, hs_code, uom, qty, unit_price_cny,
origin, manufacturer, material, usage, spec, packing, product_link, item_note)
values (p_order_id, nullif(trim(x->>'declared_name_vi'), ''), nullif(trim(x->>'declared_name_en'), ''), nullif(trim(x->>'name_cn'), ''),
nullif(trim(x->>'model'), ''), nullif(trim(x->>'brand'), ''), nullif(regexp_replace(coalesce(x->>'hs_code', ''), '\D', '', 'g'), ''),
coalesce(nullif(trim(x->>'uom'), ''), 'Chiếc'), (x->>'qty')::numeric, coalesce(nullif(x->>'unit_price_cny', '')::numeric, 0),
coalesce(nullif(trim(x->>'origin'), ''), 'CN'), nullif(trim(x->>'manufacturer'), ''), nullif(trim(x->>'material'), ''),
nullif(trim(x->>'usage'), ''), nullif(trim(x->>'spec'), ''), nullif(trim(x->>'packing'), ''),
nullif(trim(x->>'product_link'), ''), nullif(trim(x->>'item_note'), ''));
n := n + 1;
end loop;
return n;
end $$;
create or replace function public.order_progress(p_ids uuid[])
returns table (
order_id uuid, status text, status_rank integer, days_in_status integer, sla_overdue boolean,
total_vnd bigint, deposit_vnd bigint, paid_vnd bigint, remaining_vnd bigint, statement_kind text, statement_status text, payment_state text,
wallet_balance_vnd bigint,
items_total integer, items_confirmed integer, items_with_image integer, items_missing_hs integer,
pkg_total integer, pkg_cn integer, pkg_on_trip integer, pkg_vn integer, pkg_delivered integer, pkg_issue integer,
qty_total numeric, qty_delivered numeric, delivery_state text,
qty_invoiced numeric, qty_invoice_draft numeric, invoice_state text,
messages_count integer, last_message_at timestamptz, attachments_count integer, unread_count integer
) language sql stable security definer set search_path = '' as $$
select o.id, o.status, d.rank,
(current_date - (o.status_changed_at at time zone 'Asia/Ho_Chi_Minh')::date)::integer,
(d.sla_days is not null and o.status_changed_at < now() - make_interval(days => d.sla_days)),
coalesce(st.total_vnd, 0), coalesce(st.deposit_vnd, 0), pay.paid, coalesce(st.total_vnd, 0) - pay.paid - pay.credit, st.kind, st.status,
case when st.id is null then 'chua_bao_gia'
when st.status = 'active' then 'cho_xac_nhan'
when pay.paid <= 0 then 'cho_coc'
when pay.paid + pay.credit > st.total_vnd then 'tra_thua'
when pay.paid + pay.credit >= st.total_vnd then 'da_tt_du'
when pay.paid >= st.deposit_vnd then 'da_coc'
else 'coc_thieu' end,
app.wallet_balance(o.customer_id, o.entity_id),
it.n, it.confirmed, it.with_image, it.missing_hs,
pk.n, pk.cn, pk.trip, pk.vn, pk.deliv, pk.issue,
it.qty, it.delivered,
case when it.n = 0 then 'chua_co_dong' when it.delivered <= 0 then 'chua_giao' when it.full_deliv = it.n then 'da_giao_du' else 'giao_mot_phan' end,
it.invoiced, it.inv_draft,
case when it.n = 0 then 'chua_co_dong' when it.invoiced <= 0 and it.inv_draft <= 0 then 'chua_xuat'
when it.full_inv = it.n then 'da_xuat_du' when it.invoiced <= 0 then 'dang_lap' else 'xuat_mot_phan' end,
msg.n, msg.last_at, att.n, nt.n
from public.orders o
join public.order_status_defs d on d.code = o.status
left join lateral (select * from public.order_statements s where s.order_id = o.id and s.status <> 'superseded' order by s.version desc limit 1) st on true
cross join lateral (select app.order_paid_vnd(o.id) as paid, app.order_credit_vnd(o.id) as credit) pay
cross join lateral (
select count(*)::int n, count(*) filter (where i.status = 'da_xac_nhan')::int confirmed,
count(*) filter (where exists (select 1 from public.attachments a where a.entity_type = 'order_item' and a.entity_ref_id = i.id and a.deleted_at is null))::int with_image,
count(*) filter (where i.hs_code is null)::int missing_hs,
coalesce(sum(i.qty), 0) qty, coalesce(sum(least(dl.q, i.qty)), 0) delivered,
count(*) filter (where dl.q >= i.qty)::int full_deliv,
coalesce(sum(least(iv.issued, i.qty)), 0) invoiced, coalesce(sum(iv.draft), 0) inv_draft,
count(*) filter (where iv.issued >= i.qty)::int full_inv
from public.order_items i
left join lateral (select coalesce(sum(gl.qty), 0) q from public.goods_issue_lines gl join public.goods_issues g on g.id = gl.goods_issue_id
where gl.order_item_id = i.id and g.status = 'da_giao' and g.deleted_at is null) dl on true
left join lateral (select coalesce(sum(sl.qty) filter (where si.status = 'da_phat_hanh'), 0) issued,
coalesce(sum(sl.qty) filter (where si.status in ('nhap','da_xuat_file')), 0) draft
from public.sales_invoice_lines sl join public.sales_invoices si on si.id = sl.sales_invoice_id
where sl.order_item_id = i.id and si.deleted_at is null) iv on true
where i.order_id = o.id and i.deleted_at is null) it
cross join lateral (
select count(*)::int n,
count(*) filter (where p.status = 've_kho' and w.country = 'CN')::int cn,
count(*) filter (where p.status = 'tren_xe')::int trip,
count(*) filter (where p.status = 've_vn' or (p.status = 've_kho' and w.country = 'VN'))::int vn,
count(*) filter (where p.status = 'da_giao')::int deliv,
count(*) filter (where p.status in ('thieu','hong','sai_hang'))::int issue
from public.packages p left join public.warehouses w on w.id = p.warehouse_id
where p.order_id = o.id and p.deleted_at is null) pk
cross join lateral (
select count(*)::int n, max(m.created_at) last_at from public.order_messages m
where m.order_id = o.id and (app.is_staff() or not m.internal)) msg
cross join lateral (
select count(*)::int n from public.attachments a where a.entity_type = 'order' and a.entity_ref_id = o.id and a.deleted_at is null
and (app.is_staff() or a.visibility = 'customer')) att
cross join lateral (
select count(*)::int n from public.notifications x where x.order_id = o.id and x.user_id = auth.uid() and x.read_at is null) nt
where o.id = any(p_ids) and o.deleted_at is null and app.can_see_entity(o.customer_id, o.entity_id);
$$;
create or replace function public.order_invoice_detail(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o public.orders; v_staff boolean := app.is_staff() and app.has_perm('finance.read');
begin
select * into o from public.orders where id = p_order_id and deleted_at is null;
if not found or not app.can_see_entity(o.customer_id, o.entity_id) then raise exception 'Không tìm thấy đơn' using errcode = '42501'; end if;
return jsonb_build_object(
'lines', coalesce((select jsonb_agg(jsonb_build_object(
'item_id', i.id, 'line_no', i.line_no, 'name', i.declared_name_vi, 'model', i.model, 'uom', i.uom, 'qty', i.qty,
'delivered_qty', dl.q,
'purchased_qty', case when v_staff then pv.q end,
'hh_code', case when v_staff then pv.hh end,
'issued_qty', iv.issued, 'draft_qty', iv.draft,
'missing_qty', greatest(i.qty - iv.issued, 0),
'compliance_ok', i.compliance_status in ('khong_can','dat')) order by i.line_no)
from public.order_items i
left join lateral (select coalesce(sum(gl.qty), 0) q from public.goods_issue_lines gl join public.goods_issues g on g.id = gl.goods_issue_id
where gl.order_item_id = i.id and g.status = 'da_giao' and g.deleted_at is null) dl on true
left join lateral (select coalesce(sum(l.qty), 0) q, max(l.hh_code) hh from public.purchase_invoice_lines l join public.purchase_invoices p on p.id = l.purchase_invoice_id
where l.order_item_id = i.id and p.deleted_at is null) pv on true
left join lateral (select coalesce(sum(sl.qty) filter (where si.status = 'da_phat_hanh'), 0) issued,
coalesce(sum(sl.qty) filter (where si.status in ('nhap','da_xuat_file')), 0) draft
from public.sales_invoice_lines sl join public.sales_invoices si on si.id = sl.sales_invoice_id
where sl.order_item_id = i.id and si.deleted_at is null) iv on true
where i.order_id = o.id and i.deleted_at is null), '[]'::jsonb),
'invoices', coalesce((select jsonb_agg(jsonb_build_object(
'id', si.id, 'draft_code', si.draft_code, 'invoice_no', si.invoice_no, 'invoice_date', si.invoice_date, 'status', si.status,
'batch_label', si.batch_label, 'qty', x.qty, 'amount_vnd', x.amt, 'vat_vnd', x.vat) order by si.created_at)
from public.sales_invoices si
join lateral (select sum(sl.qty) qty, sum(sl.amount_vnd) amt, sum(sl.vat_vnd) vat from public.sales_invoice_lines sl
join public.order_items i on i.id = sl.order_item_id where sl.sales_invoice_id = si.id and i.order_id = o.id) x on x.qty is not null
where si.deleted_at is null and si.status <> 'huy' and (v_staff or si.status = 'da_phat_hanh')), '[]'::jsonb));
end $$;
create or replace function public.preview_order_fees(p_customer_id uuid, p_goods_cny numeric, p_fx numeric, p_invoice_type text,
p_goods_group text, p_weight_kg numeric default 0, p_vat_rate numeric default 8)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare ft public.fee_types; r public.fee_rules; v_goods bigint; v_fx numeric; v_lines jsonb := '[]'; v_sub bigint; v_amt bigint; v_dep numeric;
begin
if not app.can_see_customer(p_customer_id) then raise exception 'Không có quyền' using errcode = '42501'; end if;
v_fx := case when app.is_staff() and p_fx > 0 then p_fx else coalesce((app.setting('finance.default_fx_rate'))::text::numeric, 3650) end;
v_goods := round(coalesce(p_goods_cny, 0) * v_fx)::bigint;
v_sub := v_goods;
for ft in select * from public.fee_types where is_active and deleted_at is null and calc_method <> 'actual' order by sort_order loop
r := app.pick_rule(ft.id, p_customer_id, coalesce(p_invoice_type, 'HDPT'), nullif(p_goods_group, ''), now());
continue when r.id is null;
v_amt := case ft.calc_method when 'per_kg' then round(coalesce(p_weight_kg, 0) * r.sell_rate)::bigint
else round(v_goods * r.sell_rate / 100)::bigint end;
continue when v_amt = 0 and ft.calc_method <> 'per_kg';
v_lines := v_lines || jsonb_build_object('label', ft.name, 'method', ft.calc_method, 'rate', r.sell_rate, 'amount_vnd', v_amt);
v_sub := v_sub + v_amt;
end loop;
v_dep := coalesce((app.setting('finance.deposit_rate_percent'))::text::numeric, 80);
return jsonb_build_object('fx_rate', v_fx, 'goods_vnd', v_goods, 'lines', v_lines, 'subtotal_vnd', v_sub,
'vat_vnd', round(v_sub * coalesce(p_vat_rate, 8) / 100), 'total_vnd', v_sub + round(v_sub * coalesce(p_vat_rate, 8) / 100),
'deposit_vnd', round(v_goods * v_dep / 100), 'deposit_rate', v_dep);
end $$;
create or replace view public.order_finance with (security_invoker = true) as
select o.id as order_id, o.code, o.customer_id, o.entity_id, o.status, o.created_at,
s.id as statement_id, s.kind as statement_kind, s.status as statement_status, s.version,
coalesce(s.total_vnd, 0) as total_vnd, coalesce(s.deposit_vnd, 0) as deposit_vnd,
app.order_paid_vnd(o.id) as paid_vnd,
coalesce(s.total_vnd, 0) - app.order_paid_vnd(o.id) - app.order_credit_vnd(o.id) as remaining_vnd,
app.order_credit_vnd(o.id) as credit_vnd
from public.orders o
left join lateral (
select * from public.order_statements st where st.order_id = o.id and st.status <> 'superseded' order by st.version desc limit 1
) s on true
where o.deleted_at is null;
create trigger lookup_values_std before insert or update on public.lookup_values for each row execute function app.tg_standard_columns();
create trigger lookup_values_no_delete before delete on public.lookup_values for each row execute function app.tg_block_hard_delete();
create trigger wallet_topups_std before insert or update on public.wallet_topups for each row execute function app.tg_standard_columns();
create trigger wallet_topups_no_delete before delete on public.wallet_topups for each row execute function app.tg_block_hard_delete();
do $$
declare t text;
begin
foreach t in array array['lookup_values','order_status_defs','wallet_topups','wallet_ledger','order_messages'] loop
execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function audit.tg_log_change()', t, t);
end loop;
end $$;
revoke all on public.lookup_values, public.order_status_defs, public.notifications, public.wallet_topups, public.wallet_ledger,
public.wallet_balances, public.order_messages from anon, authenticated;
grant select on public.lookup_values, public.order_status_defs, public.notifications, public.wallet_topups, public.wallet_ledger,
public.wallet_balances, public.order_messages to authenticated;
grant insert, update on public.lookup_values to authenticated;
grant insert, update (label, customer_label, tone, sla_days, notify_customer, is_active, description, owner_role) on public.order_status_defs to authenticated;
grant insert (code, label, customer_label, tone, rank, phase, owner_role, sla_days, notify_customer, description) on public.order_status_defs to authenticated;
grant insert (order_id, body, internal) on public.order_messages to authenticated;
grant usage on sequence public.wallet_topup_seq to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
alter table public.lookup_values enable row level security;
alter table public.order_status_defs enable row level security;
alter table public.notifications enable row level security;
alter table public.wallet_topups enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.order_messages enable row level security;
create policy lookup_select on public.lookup_values for select to authenticated using (deleted_at is null and app.is_active_user());
create policy lookup_insert on public.lookup_values for insert to authenticated with check (app.has_perm('settings.manage'));
create policy lookup_update on public.lookup_values for update to authenticated using (app.has_perm('settings.manage')) with check (app.has_perm('settings.manage'));
create policy status_defs_select on public.order_status_defs for select to authenticated using (app.is_active_user());
create policy status_defs_insert on public.order_status_defs for insert to authenticated with check (app.has_perm('settings.manage'));
create policy status_defs_update on public.order_status_defs for update to authenticated using (app.has_perm('settings.manage')) with check (app.has_perm('settings.manage'));
create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy topups_select on public.wallet_topups for select to authenticated using (
deleted_at is null and ((app.is_staff() and app.has_perm('finance.read') and app.staff_can_see_customer(customer_id))
or (not app.is_staff() and app.can_see_entity(customer_id, entity_id))));
create policy ledger_select on public.wallet_ledger for select to authenticated using (
(app.is_staff() and app.has_perm('finance.read') and app.staff_can_see_customer(customer_id))
or (not app.is_staff() and app.can_see_entity(customer_id, entity_id)));
create policy messages_select on public.order_messages for select to authenticated using (
(app.is_staff() and app.staff_can_see_customer(customer_id))
or (not app.is_staff() and not internal and app.can_see_entity(customer_id, entity_id)));
create policy messages_insert on public.order_messages for insert to authenticated with check (
app.has_perm('order.message') and (
(app.is_staff() and app.staff_can_see_customer(customer_id))
or (not app.is_staff() and not internal and app.can_see_entity(customer_id, entity_id))));
create policy orders_update_customer_draft on public.orders for update to authenticated
using (not app.is_staff() and app.has_perm('order.create_own') and status = 'dang_len_don' and app.can_see_entity(customer_id, entity_id))
with check (not app.is_staff() and app.can_see_entity(customer_id, entity_id));
revoke all on function public.set_order_status(uuid, text, text), public.submit_order(uuid), public.create_topup(uuid, uuid, bigint, date, text, text, text, text),
public.review_topup(uuid, boolean, text, bigint), public.cancel_topup(uuid), public.pay_order(uuid, bigint, text, text),
public.reverse_wallet_entry(bigint, text), public.refund_order_to_wallet(uuid, bigint, text), public.mark_notifications_read(bigint[]),
public.attachment_scope(text, uuid, text), public.remove_attachment(uuid), public.add_order_items(uuid, jsonb),
public.order_progress(uuid[]), public.order_invoice_detail(uuid), public.preview_order_fees(uuid, numeric, numeric, text, text, numeric, numeric)
from public, anon;
grant execute on function public.set_order_status(uuid, text, text), public.submit_order(uuid), public.create_topup(uuid, uuid, bigint, date, text, text, text, text),
public.review_topup(uuid, boolean, text, bigint), public.cancel_topup(uuid), public.pay_order(uuid, bigint, text, text),
public.reverse_wallet_entry(bigint, text), public.refund_order_to_wallet(uuid, bigint, text), public.mark_notifications_read(bigint[]),
public.attachment_scope(text, uuid, text), public.remove_attachment(uuid), public.add_order_items(uuid, jsonb),
public.order_progress(uuid[]), public.order_invoice_detail(uuid), public.preview_order_fees(uuid, numeric, numeric, text, text, numeric, numeric)
to authenticated;
revoke all on function app.order_staff_users(uuid), app.order_customer_users(uuid), app.order_customer_users_by_entity(uuid, uuid),
app.perm_users(text), app.notify(uuid[], text, text, text, text, uuid), app.notify_status_change(uuid, text, text),
app.wallet_balance(uuid, uuid), app.order_paid_vnd(uuid), app.order_credit_vnd(uuid), app.sync_order_status(uuid), app.status_rank(text)
from public, anon;
grant execute on function app.order_paid_vnd(uuid), app.order_credit_vnd(uuid), app.wallet_balance(uuid, uuid) to authenticated;
do $$ begin
if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
alter publication supabase_realtime add table public.notifications, public.order_messages;
end if;
end $$;
