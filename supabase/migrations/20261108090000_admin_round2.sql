-- NAMCHI ERP – vòng chỉnh sửa 08/11/2026: ghi chú đơn, ảnh đơn, mã vận đơn kiện, bill trả NCC, CSKH theo công ty con, khung chat tổng
alter table public.packages add column if not exists tracking_no text;
create index if not exists packages_tracking_idx on public.packages(tracking_no) where tracking_no is not null;
alter table public.staff_customer_assignments add column if not exists entity_id uuid references public.customer_entities(id);
comment on column public.staff_customer_assignments.entity_id is 'Trống = phụ trách cả khách tổng (Quản lý CSKH); có = CSKH phụ trách công ty con';

-- CSKH nhận thông báo: người phụ trách đơn + CSKH của công ty con + quản lý CSKH của khách tổng
create or replace function app.order_staff_users(p_order_id uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
with o as (select * from public.orders where id = p_order_id),
u as (
select o.cs_owner_id as uid from o where o.cs_owner_id is not null
union select a.staff_user_id from o join public.staff_customer_assignments a on a.customer_id = o.customer_id
and (a.entity_id is null or a.entity_id = o.entity_id)
and a.valid_from <= current_date and (a.valid_to is null or a.valid_to >= current_date)
)
select case when exists (select 1 from u)
then (select array_agg(distinct uid) from u)
else (select array_agg(distinct ur.user_id) from public.user_roles ur join public.roles r on r.id = ur.role_id where r.code in ('admin','manager'))
end;
$$;

create or replace function app.tg_orders_customer_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
if coalesce(current_setting('app.sys', true), '') = 'on' then return new; end if;
if auth.uid() is not null and not app.is_staff() then
if tg_op = 'INSERT' then
if new.status not in ('dang_len_don', 'cho_bao_gia') then new.status := 'dang_len_don'; end if;
if new.status = 'cho_bao_gia' then new.submitted_at := now(); end if;
new.internal_note := null; new.cs_owner_id := null; new.china_tax_cny := 0; new.weight_kg := 0;
new.cbm := 0; new.packages := 0; new.deposit_rate := null; new.expected_week := null; new.delay_reason := null;
new.fx_rate := coalesce((app.setting('finance.default_fx_rate'))::text::numeric, 3650);
else
if old.status <> 'dang_len_don' then
raise exception 'Đơn đã gửi Nam Trung, không sửa trực tiếp. Nhắn CSKH trên đơn để điều chỉnh.' using errcode = '42501';
end if;
if new.status is distinct from old.status then
raise exception 'Dùng nút “Gửi đơn cho Nam Trung” để gửi đơn' using errcode = '42501';
end if;
new.customer_id := old.customer_id; new.entity_id := old.entity_id; new.status := old.status;
new.fx_rate := old.fx_rate; new.china_tax_cny := old.china_tax_cny; new.weight_kg := old.weight_kg; new.cbm := old.cbm;
new.packages := old.packages; new.vat_rate := old.vat_rate; new.internal_note := old.internal_note; new.cs_owner_id := old.cs_owner_id;
new.deposit_rate := old.deposit_rate; new.expected_week := old.expected_week; new.delay_reason := old.delay_reason;
new.code := old.code; new.submitted_at := old.submitted_at;
end if;
end if;
if new.delay_reason is not null and not exists (select 1 from public.lookup_values where category = 'delay_reason' and code = new.delay_reason) then
raise exception 'Lý do chậm không có trong danh mục' using errcode = '23514';
end if;
if tg_op = 'INSERT' and new.cs_owner_id is null then
new.cs_owner_id := coalesce(
(select auth.uid() where app.is_staff() and exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = auth.uid() and r.code = 'cs')),
(select a.staff_user_id from public.staff_customer_assignments a where a.customer_id = new.customer_id and a.entity_id = new.entity_id
and a.valid_from <= current_date and (a.valid_to is null or a.valid_to >= current_date) order by a.valid_from desc limit 1),
(select a.staff_user_id from public.staff_customer_assignments a where a.customer_id = new.customer_id and a.entity_id is null
and a.valid_from <= current_date and (a.valid_to is null or a.valid_to >= current_date) order by a.valid_from desc limit 1));
end if;
return new;
end $$;

-- Ghi chú đơn: khách ghi chú bất cứ lúc nào (cột note), nhân viên ghi chú nội bộ (internal_note)
create or replace function public.set_order_note(p_order_id uuid, p_kind text, p_text text)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
select * into o from public.orders where id = p_order_id and deleted_at is null for update;
if not found then raise exception 'Không tìm thấy đơn' using errcode = '42501'; end if;
if p_kind = 'internal' then
if not (app.is_staff() and app.has_perm('order.write') and app.staff_can_see_customer(o.customer_id)) then
raise exception 'Không có quyền ghi chú nội bộ' using errcode = '42501'; end if;
elsif p_kind = 'customer' then
if not app.can_see_entity(o.customer_id, o.entity_id) or not (app.is_staff() or app.has_perm('order.create_own')) then
raise exception 'Không có quyền ghi chú đơn này' using errcode = '42501'; end if;
else raise exception 'Loại ghi chú không hợp lệ' using errcode = '22023';
end if;
perform set_config('app.sys', 'on', true);
if p_kind = 'internal' then update public.orders set internal_note = nullif(trim(p_text), ''), row_version = row_version where id = o.id;
else update public.orders set note = nullif(trim(p_text), ''), row_version = row_version where id = o.id; end if;
perform set_config('app.sys', '', true);
end $$;

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
elsif p_entity_type = 'supplier_payment' then
select o.customer_id, o.entity_id, o.code || '-TTNCC', o.id into v_c, v_e, v_label, v_order
from public.supplier_payments sp join public.orders o on o.id = sp.order_id where sp.id = p_ref_id;
v_ok := app.is_staff() and app.has_perm('finance.read') and app.staff_can_see_customer(v_c);
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

create or replace function public.admin_orders(p_filter jsonb default '{}')
returns setof jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id, 'code', o.code, 'customer_ref', o.customer_ref, 'customer_code', c.code, 'entity_code', e.code, 'entity_name', e.legal_name,
    'entity_id', o.entity_id, 'customer_id', o.customer_id,
    'goods_desc', o.goods_desc, 'goods_group', o.goods_group, 'supplier_name', o.supplier_name, 'source_channel', o.source_channel,
    'china_invoice_type', o.china_invoice_type, 'goods_cny', o.goods_cny, 'goods_qty', o.goods_qty, 'fx_rate', o.fx_rate,
    'weight_kg', o.weight_kg, 'cbm', o.cbm, 'packages', o.packages, 'order_week', o.order_week, 'expected_week', o.expected_week,
    'status', o.status, 'status_changed_at', o.status_changed_at, 'created_at', o.created_at, 'submitted_at', o.submitted_at,
    'cs_owner_id', o.cs_owner_id, 'cs_name', pr.full_name, 'require_label_check', o.require_label_check, 'require_inspection', o.require_inspection,
    'delay_reason', o.delay_reason, 'note', o.note, 'internal_note', o.internal_note,
'thumb_id', (select a.id from public.attachments a where a.deleted_at is null and a.mime_type like 'image/%'
and ((a.entity_type = 'order' and a.entity_ref_id = o.id) or (a.entity_type = 'order_item' and a.entity_ref_id in (select i.id from public.order_items i where i.order_id = o.id)))
order by (a.entity_type = 'order') desc, a.created_at limit 1),
'images_count', (select count(*) from public.attachments a where a.deleted_at is null and a.mime_type like 'image/%'
and ((a.entity_type = 'order' and a.entity_ref_id = o.id) or (a.entity_type = 'order_item' and a.entity_ref_id in (select i.id from public.order_items i where i.order_id = o.id))))
  ) || to_jsonb(pg) - 'order_id' - 'status' - 'status_rank'
    || case when app.has_perm('finance.profit.read') then jsonb_build_object('profit_vnd', (pc ->> 'profit_vnd')::bigint, 'cost_missing', (pc ->> 'missing')::int) else '{}'::jsonb end
  from public.orders o
  join public.customers c on c.id = o.customer_id
  join public.customer_entities e on e.id = o.entity_id
  left join public.profiles pr on pr.user_id = o.cs_owner_id
  cross join lateral (select * from public.order_progress(array[o.id])) pg
  left join lateral (select app.order_profit_calc(o.id) pc where app.has_perm('finance.profit.read')) px on true
  where o.deleted_at is null and app.is_staff() and app.staff_can_see_customer(o.customer_id)
    and (nullif(p_filter ->> 'customer_id', '') is null or o.customer_id = (p_filter ->> 'customer_id')::uuid)
    and (nullif(p_filter ->> 'entity_id', '') is null or o.entity_id = (p_filter ->> 'entity_id')::uuid)
    and (nullif(p_filter ->> 'cs_owner_id', '') is null or o.cs_owner_id = (p_filter ->> 'cs_owner_id')::uuid)
    and (nullif(p_filter ->> 'from', '') is null or (o.created_at at time zone 'Asia/Ho_Chi_Minh')::date >= (p_filter ->> 'from')::date)
    and (nullif(p_filter ->> 'to', '') is null or (o.created_at at time zone 'Asia/Ho_Chi_Minh')::date <= (p_filter ->> 'to')::date)
  order by o.created_at desc
  limit least(coalesce((p_filter ->> 'limit')::int, 500), 2000);
$$;

-- Khung chat tổng: tin nhắn mới nhất trên mọi đơn người dùng được xem
create or replace function public.recent_messages(p_limit integer default 50)
returns table (id bigint, order_id uuid, order_code text, entity_name text, body text, internal boolean, author_side text, author_name text, created_at timestamptz, mine boolean)
language sql stable security definer set search_path = '' as $$
select m.id, m.order_id, o.code, e.legal_name, m.body, m.internal, m.author_side, m.author_name, m.created_at, m.created_by = auth.uid()
from public.order_messages m join public.orders o on o.id = m.order_id join public.customer_entities e on e.id = o.entity_id
where (app.is_staff() and app.staff_can_see_customer(m.customer_id)) or (not app.is_staff() and not m.internal and app.can_see_entity(m.customer_id, m.entity_id))
order by m.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke all on function public.set_order_note(uuid, text, text), public.recent_messages(integer) from public, anon;
grant execute on function public.set_order_note(uuid, text, text), public.recent_messages(integer) to authenticated;
