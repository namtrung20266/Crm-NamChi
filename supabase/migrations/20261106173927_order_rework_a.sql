-- NAMCHI ERP – làm lại luồng đơn hàng (07/11/2026), phần 1/3. Đã áp lên Supabase bằng connector (bản rút gọn chú thích).
create or replace function app.setting(p_key text, p_default jsonb default null)
returns jsonb language sql stable security definer set search_path = '' as $$
select coalesce((select s.value_json from public.app_settings s
where s.key = p_key and s.valid_from <= now() and (s.valid_to is null or s.valid_to > now())
order by s.valid_from desc limit 1), p_default);
$$;
revoke all on function app.setting(text, jsonb) from public, anon, authenticated;
insert into public.app_settings (key, value_json, note) values
('order.auto_status_enabled', 'true', 'Tự chuyển trạng thái đơn theo dữ liệu (thanh toán, kiện, giao hàng, hóa đơn)'),
('order.payment_requires_confirmed_quote', 'true', 'Chỉ cho cọc/thanh toán khi khách đã xác nhận phiếu tính tiền'),
('order.complete_requires_invoice', 'true', 'Đơn chỉ Hoàn tất khi đã phát hành HĐ bán đủ số lượng'),
('order.require_attachment_on_submit', 'false', 'Bắt buộc có ảnh/file khi khách gửi đơn'),
('wallet.customer_can_pay', 'true', 'Khách tự bấm đặt cọc/thanh toán đơn từ ví'),
('wallet.min_topup_vnd', '100000', 'Số tiền nạp ví tối thiểu'),
('notify.poll_seconds', '30', 'Chu kỳ làm mới thông báo trên giao diện (giây)')
on conflict do nothing;
insert into public.permissions (code, module, description) values
('wallet.pay', 'finance', 'Thanh toán/đặt cọc đơn từ ví khách (thao tác thay khách)'),
('order.pay_own', 'finance', 'Khách tự đặt cọc/thanh toán đơn từ ví công ty mình'),
('wallet.topup_own', 'finance', 'Khách tạo yêu cầu nạp ví kèm ảnh chuyển khoản'),
('order.message', 'order', 'Trao đổi, nhắn tin trên đơn hàng')
on conflict (code) do nothing;
with m(role_code, perm_code) as (values
('admin','wallet.pay'), ('accountant','wallet.pay'), ('cs','wallet.pay'),
('cust_admin','order.pay_own'),
('cust_admin','wallet.topup_own'), ('cust_member','wallet.topup_own'),
('admin','order.message'), ('manager','order.message'), ('cs','order.message'), ('accountant','order.message'),
('xnk','order.message'), ('warehouse_cn','order.message'), ('warehouse_vn','order.message'),
('cust_admin','order.message'), ('cust_member','order.message')
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from m join public.roles r on r.code = m.role_code join public.permissions p on p.code = m.perm_code
on conflict do nothing;
create table public.lookup_values (
id uuid primary key default gen_random_uuid(),
category text not null check (category ~ '^[a-z_]{2,40}$'),
code text not null check (code ~ '^[a-z0-9_]{1,40}$'),
label text not null check (length(trim(label)) > 0),
sort_order integer not null default 100,
is_active boolean not null default true,
meta jsonb not null default '{}',
created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
updated_by uuid, deleted_at timestamptz, row_version integer not null default 1,
unique (category, code)
);
comment on table public.lookup_values is 'Danh mục dùng chung cấu hình được: nhóm hàng, nguồn đơn, ĐVT, lý do chậm, tài khoản nhận tiền, loại file, câu trả lời nhanh…';
insert into public.lookup_values (category, code, label, sort_order, meta) values
('goods_group','chung','Hàng chung',10,'{}'), ('goods_group','giay_dep','Giày dép',20,'{}'), ('goods_group','tet','Hàng Tết',30,'{}'),
('goods_group','gau_bong','Gấu bông',40,'{}'), ('goods_group','thoi_trang','Thời trang',50,'{}'), ('goods_group','gia_dung','Gia dụng',60,'{}'),
('goods_group','do_choi','Đồ chơi',70,'{}'), ('goods_group','dien_tu','Điện – điện tử',80,'{}'),
('order_source','zalo','Zalo',10,'{}'), ('order_source','excel','File Excel',20,'{}'), ('order_source','1688','1688',30,'{}'),
('order_source','taobao','Taobao/Tmall',40,'{}'), ('order_source','ncc_truc_tiep','NCC trực tiếp',50,'{}'), ('order_source','khac','Khác',90,'{}'),
('uom','chiec','Chiếc',10,'{}'), ('uom','cai','Cái',20,'{}'), ('uom','bo','Bộ',30,'{}'), ('uom','doi','Đôi',40,'{}'),
('uom','hop','Hộp',50,'{}'), ('uom','kg','Kg',60,'{}'), ('uom','met','Mét',70,'{}'), ('uom','cuon','Cuộn',80,'{}'), ('uom','tui','Túi',90,'{}'),
('delay_reason','dung_lich','Đúng lịch',10,'{}'), ('delay_reason','san_xuat_7','Sản xuất 7 ngày',20,'{}'),
('delay_reason','san_xuat_15','Sản xuất 15 ngày',30,'{}'), ('delay_reason','san_xuat_tren_15','Sản xuất trên 15 ngày',40,'{}'),
('delay_reason','khac','Khác',90,'{}'),
('origin','cn','Trung Quốc (CN)',10,'{"iso":"CN"}'), ('origin','vn','Việt Nam (VN)',20,'{"iso":"VN"}'),
('attachment_category','anh_san_pham','Ảnh sản phẩm',10,'{}'), ('attachment_category','file_don','File đơn (Excel/PDF)',20,'{}'),
('attachment_category','bao_gia_ncc','Báo giá / hóa đơn NCC',30,'{}'), ('attachment_category','tem_mac','Tem, nhãn mác',40,'{}'),
('attachment_category','chung_tu_ck','Chứng từ chuyển khoản',50,'{}'), ('attachment_category','anh_kho','Ảnh kho / kiện',60,'{}'),
('attachment_category','ho_so_hq','Hồ sơ hải quan',70,'{}'), ('attachment_category','khac','Khác',90,'{}'),
('topup_account','nt_vcb','Nam Trung – Vietcombank',10,'{"bank":"Vietcombank","account_no":"(cập nhật)","holder":"CONG TY TNHH DV VA TM QUOC TE NAM TRUNG"}'),
('quick_reply','da_nhan_don','Nam Trung đã nhận đơn, đang làm việc với nhà cung cấp.',10,'{}'),
('quick_reply','gui_bao_gia','Nam Trung đã gửi phiếu báo giá, anh/chị kiểm tra và bấm Xác nhận giúp em.',20,'{}'),
('quick_reply','nhac_coc','Đơn đang chờ đặt cọc, anh/chị nạp ví hoặc bấm Đặt cọc trên đơn giúp em.',30,'{}'),
('quick_reply','bo_sung_anh','Anh/chị bổ sung giúp em ảnh sản phẩm và tem mác để làm khai báo.',40,'{}');
create table public.order_status_defs (
code text primary key check (code ~ '^[a-z_]{2,30}$'),
label text not null,
customer_label text, -- tên khách thấy (trống = dùng label)
tone text not null default 'neutral' check (tone in ('neutral','brand','warn','ok','danger','info')),
rank integer not null unique, -- thứ tự trong luồng
phase text not null check (phase in ('tiep_nhan','mua_hang','van_chuyen','viet_nam','ket_thuc','ngoai_le')),
owner_role text, -- bộ phận chịu trách nhiệm ở bước này
sla_days integer check (sla_days is null or sla_days > 0),
notify_customer boolean not null default true,
is_system boolean not null default false,
is_active boolean not null default true,
description text,
updated_at timestamptz not null default now(), updated_by uuid
);
insert into public.order_status_defs (code, label, customer_label, tone, rank, phase, owner_role, sla_days, notify_customer, is_system, description) values
('dang_len_don', 'Khách đang lên đơn', 'Đang lên đơn', 'neutral', 10, 'tiep_nhan', 'cust', null, false, true, 'Nháp: khách sửa tự do, Nam Trung chưa xử lý'),
('cho_bao_gia', 'Chờ báo giá', 'Chờ Nam Trung báo giá', 'warn', 20, 'tiep_nhan', 'cs', 1, true, true, 'Khách đã gửi đơn; CSKH lập phiếu tính tiền'),
('cho_coc', 'Chờ đặt cọc', 'Chờ đặt cọc', 'warn', 30, 'tiep_nhan', 'cust', 2, true, true, 'Khách đã xác nhận báo giá; chờ cọc từ ví'),
('dang_mua', 'Đang mua hàng', 'Đang mua hàng', 'info', 40, 'mua_hang', 'cs', 2, true, true, 'Đã nhận cọc; CSKH đặt hàng, kế toán trả NCC'),
('cho_shop_giao', 'Chờ shop giao hàng', 'Chờ shop giao hàng', 'info', 50, 'mua_hang', 'cs', 7, true, true, 'Đã thanh toán NCC, chờ shop phát hàng'),
('shop_da_phat', 'Shop đã phát hàng', 'Shop đã phát hàng', 'info', 60, 'mua_hang', 'warehouse_cn', 4, true, true, 'Đang vận chuyển nội địa TQ'),
('ve_kho_qc', 'Về kho Quảng Châu', 'Về kho Quảng Châu', 'brand', 70, 'van_chuyen', 'warehouse_cn', 3, true, true, 'Tất cả kiện đã nhập kho Quảng Châu'),
('ve_bang_tuong', 'Về Bằng Tường', 'Về Bằng Tường', 'brand', 80, 'van_chuyen', 'warehouse_cn', 3, true, true, 'Tất cả kiện đã ở Bằng Tường/cửa khẩu'),
('cho_check_tem', 'Chờ check tem/mác', 'Chờ check tem/mác', 'warn', 90, 'van_chuyen', 'xnk', 2, true, true, 'Kiểm tem, nhãn mác trước khi lên xe'),
('tren_xe', 'Đang về Việt Nam', 'Đang về Việt Nam', 'brand', 100, 'van_chuyen', 'xnk', 3, true, true, 'Tất cả kiện đã lên xe, đang thông quan'),
('ve_kho_vn', 'Đã nhận hàng tại VN', 'Đã nhận hàng tại VN', 'ok', 110, 'viet_nam', 'warehouse_vn', 2, true, true, 'Tất cả kiện đã về kho Việt Nam'),
('dang_giao', 'Đang giao hàng', 'Đang giao hàng', 'ok', 120, 'viet_nam', 'warehouse_vn', 2, true, true, 'Đã giao một phần'),
('da_giao', 'Đã giao đủ', 'Đã giao đủ', 'ok', 130, 'viet_nam', 'cs', 5, true, true, 'Giao đủ số lượng; chờ quyết toán và hóa đơn'),
('hoan_tat', 'Hoàn tất', 'Hoàn tất', 'ok', 140, 'ket_thuc', null, null, true, true, 'Đã giao đủ, thanh toán đủ, xuất HĐ đủ'),
('tam_giu', 'Tạm giữ', 'Tạm giữ', 'danger', 900, 'ngoai_le', 'cs', null, true, true, 'Dừng xử lý, ghi rõ lý do'),
('huy', 'Đã hủy', 'Đã hủy', 'neutral', 999, 'ngoai_le', null, null, true, true, 'Hủy đơn, không xử lý tiếp');
create or replace function app.tg_status_defs_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
if tg_op = 'DELETE' then raise exception 'Không xóa trạng thái; tắt is_active' using errcode = '42501'; end if;
if tg_op = 'UPDATE' and old.is_system and (new.code <> old.code or new.rank <> old.rank or new.is_system <> old.is_system or new.phase <> old.phase) then
raise exception 'Trạng thái hệ thống chỉ đổi được tên, màu, SLA, thông báo' using errcode = '42501';
end if;
if tg_op = 'UPDATE' and old.is_system and not new.is_active then
raise exception 'Không tắt được trạng thái hệ thống' using errcode = '42501';
end if;
if tg_op = 'INSERT' then new.is_system := false; end if;
new.updated_at := now(); new.updated_by := auth.uid();
return new;
end $$;
create trigger order_status_defs_guard before insert or update or delete on public.order_status_defs
for each row execute function app.tg_status_defs_guard();
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders drop constraint if exists orders_delay_reason_check;
alter table public.orders add constraint orders_status_fk foreign key (status) references public.order_status_defs(code);
alter table public.orders
add column customer_ref text, -- mã PO / mã đơn nội bộ của khách
add column source_channel text, -- lookup order_source
add column supplier_link text check (supplier_link is null or supplier_link ~* '^https?://'),
add column supplier_contact text,
add column require_label_check boolean not null default false, -- cần check tem/mác
add column require_inspection boolean not null default false, -- cần kiểm định/hợp quy
add column delivery_address text,
add column deposit_rate numeric(5,2) check (deposit_rate is null or deposit_rate between 0 and 100), -- trống = theo cài đặt
add column submitted_at timestamptz,
add column status_changed_at timestamptz not null default now();
alter table public.order_status_history
add column source text not null default 'manual' check (source in ('manual','auto','customer'));
create index orders_cs_owner_idx on public.orders(cs_owner_id) where deleted_at is null;
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
if tg_op = 'INSERT' and new.cs_owner_id is null and app.is_staff() then
new.cs_owner_id := coalesce(
(select auth.uid() where exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = auth.uid() and r.code = 'cs')),
(select a.staff_user_id from public.staff_customer_assignments a where a.customer_id = new.customer_id
and a.valid_from <= current_date and (a.valid_to is null or a.valid_to >= current_date) order by a.valid_from desc limit 1));
end if;
return new;
end $$;
create or replace function app.tg_orders_status_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
if new.status is distinct from old.status then
if coalesce(current_setting('app.status_change', true), '') <> 'on' then
raise exception 'Đổi trạng thái đơn bằng nút chuyển trạng thái (cần ghi lý do khi lùi/tạm giữ/hủy)' using errcode = '42501';
end if;
new.status_changed_at := now();
end if;
return new;
end $$;
create trigger orders_status_guard before update on public.orders for each row execute function app.tg_orders_status_guard();
drop trigger if exists orders_status_history on public.orders;
create or replace function app.tg_order_status_history()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
if tg_op = 'INSERT' or new.status is distinct from old.status then
insert into public.order_status_history(order_id, from_status, to_status, changed_by, note, source)
values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status, auth.uid(),
nullif(current_setting('app.status_note', true), ''),
coalesce(nullif(current_setting('app.status_source', true), ''), 'manual'));
if tg_op = 'UPDATE' then perform app.notify_status_change(new.id, old.status, new.status);
elsif new.status <> 'dang_len_don' then
perform app.notify(app.order_staff_users(new.id), 'order.new', 'Đơn mới ' || new.code, new.goods_desc, '/don-hang/chi-tiet/?id=' || new.id, new.id);
end if;
end if;
return new;
end $$;
create trigger orders_status_history after insert or update of status on public.orders
for each row execute function app.tg_order_status_history();
create or replace function app.apply_order_status(p_order_id uuid, p_status text, p_note text, p_source text)
returns void language plpgsql security definer set search_path = '' as $$
begin
perform set_config('app.status_change', 'on', true);
perform set_config('app.sys', 'on', true);
perform set_config('app.status_note', coalesce(p_note, ''), true);
perform set_config('app.status_source', p_source, true);
update public.orders set status = p_status, row_version = row_version where id = p_order_id;
perform set_config('app.status_change', '', true);
perform set_config('app.sys', '', true);
perform set_config('app.status_note', '', true);
perform set_config('app.status_source', '', true);
end $$;
revoke all on function app.apply_order_status(uuid, text, text, text) from public, anon, authenticated;
create table public.notifications (
id bigint generated always as identity primary key,
user_id uuid not null references public.profiles(user_id),
kind text not null check (kind ~ '^[a-z_.]{2,40}$'),
title text not null,
body text,
link text,
order_id uuid references public.orders(id),
created_at timestamptz not null default now(),
read_at timestamptz
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);
create index notifications_unread_idx on public.notifications(user_id) where read_at is null;
create or replace function app.order_staff_users(p_order_id uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
with o as (select * from public.orders where id = p_order_id),
u as (
select o.cs_owner_id as uid from o where o.cs_owner_id is not null
union select a.staff_user_id from o join public.staff_customer_assignments a on a.customer_id = o.customer_id
and a.valid_from <= current_date and (a.valid_to is null or a.valid_to >= current_date)
)
select case when exists (select 1 from u)
then (select array_agg(distinct uid) from u)
else (select array_agg(distinct ur.user_id) from public.user_roles ur join public.roles r on r.id = ur.role_id where r.code in ('admin','manager'))
end;
$$;
create or replace function app.order_customer_users(p_order_id uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
select array_agg(cu.user_id) from public.orders o
join public.customer_users cu on cu.customer_id = o.customer_id and (cu.entity_id is null or cu.entity_id = o.entity_id)
join public.profiles p on p.user_id = cu.user_id and p.is_active
where o.id = p_order_id;
$$;
create or replace function app.perm_users(p_perm text)
returns uuid[] language sql stable security definer set search_path = '' as $$
select array_agg(distinct ur.user_id) from public.user_roles ur
join public.role_permissions rp on rp.role_id = ur.role_id join public.permissions pe on pe.id = rp.permission_id
join public.profiles p on p.user_id = ur.user_id and p.is_active and p.user_type = 'staff'
where pe.code = p_perm;
$$;
create or replace function app.notify(p_users uuid[], p_kind text, p_title text, p_body text, p_link text, p_order uuid)
returns void language sql security definer set search_path = '' as $$
insert into public.notifications (user_id, kind, title, body, link, order_id)
select distinct u, p_kind, p_title, left(p_body, 500), p_link, p_order
from unnest(coalesce(p_users, '{}')) u
join public.profiles p on p.user_id = u and p.is_active
where u is distinct from auth.uid();
$$;
create or replace function app.notify_status_change(p_order_id uuid, p_from text, p_to text)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders; d public.order_status_defs; v_title text; v_link text;
begin
select * into o from public.orders where id = p_order_id;
select * into d from public.order_status_defs where code = p_to;
v_link := '/don-hang/chi-tiet/?id=' || o.id;
v_title := 'Đơn ' || o.code || ': ' || coalesce(d.label, p_to);
perform app.notify(app.order_staff_users(o.id), 'order.status', v_title, nullif(current_setting('app.status_note', true), ''), v_link, o.id);
if d.notify_customer and p_to <> 'dang_len_don' then
perform app.notify(app.order_customer_users(o.id), 'order.status', 'Đơn ' || o.code || ': ' || coalesce(d.customer_label, d.label),
nullif(current_setting('app.status_note', true), ''), v_link, o.id);
end if;
end $$;
create or replace function public.mark_notifications_read(p_ids bigint[] default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
update public.notifications set read_at = now()
where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
get diagnostics n = row_count;
return n;
end $$;
create sequence public.wallet_topup_seq;
create table public.wallet_topups (
id uuid primary key default gen_random_uuid(),
code text not null unique default ('NAP' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMM') || '-' || lpad(nextval('public.wallet_topup_seq')::text, 4, '0')),
customer_id uuid not null,
entity_id uuid not null,
amount_vnd bigint not null check (amount_vnd > 0),
transfer_date date not null default current_date,
account_code text, -- lookup topup_account (tài khoản Nam Trung nhận)
bank_ref text, -- mã giao dịch ngân hàng
payer_name text,
note text,
status text not null default 'cho_duyet' check (status in ('cho_duyet','da_duyet','tu_choi','huy')),
reviewed_by uuid, reviewed_at timestamptz, review_note text,
created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
updated_by uuid, deleted_at timestamptz, row_version integer not null default 1,
foreign key (customer_id, entity_id) references public.customer_entities(customer_id, id)
);
create index wallet_topups_scope_idx on public.wallet_topups(customer_id, entity_id, created_at desc);
create unique index wallet_topups_bank_ref_uq on public.wallet_topups(coalesce(account_code, ''), bank_ref)
where bank_ref is not null and status = 'da_duyet';
create table public.wallet_ledger (
id bigint generated always as identity primary key,
customer_id uuid not null,
entity_id uuid not null,
amount_vnd bigint not null check (amount_vnd <> 0), -- + vào ví, - ra khỏi ví
kind text not null check (kind in ('nap','coc','thanh_toan','hoan_don','dieu_chinh','dao')),
order_id uuid references public.orders(id),
topup_id uuid references public.wallet_topups(id),
reverses_id bigint unique references public.wallet_ledger(id),
note text,
created_by uuid default auth.uid(),
created_at timestamptz not null default now(),
foreign key (customer_id, entity_id) references public.customer_entities(customer_id, id),
check (kind not in ('coc','thanh_toan','hoan_don') or order_id is not null),
check (kind <> 'nap' or topup_id is not null)
);
create index wallet_ledger_scope_idx on public.wallet_ledger(customer_id, entity_id, created_at desc);
create index wallet_ledger_order_idx on public.wallet_ledger(order_id) where order_id is not null;
create trigger wallet_ledger_append_only before update or delete on public.wallet_ledger
for each row execute function app.tg_append_only();
create or replace function app.wallet_balance(p_customer uuid, p_entity uuid)
returns bigint language sql stable security definer set search_path = '' as $$
select coalesce(sum(amount_vnd), 0)::bigint from public.wallet_ledger where customer_id = p_customer and entity_id = p_entity;
$$;
create or replace function app.order_paid_vnd(p_order_id uuid)
returns bigint language sql stable security definer set search_path = '' as $$
select (coalesce((select sum(amount_vnd) from public.receipt_allocations where order_id = p_order_id), 0)
- coalesce((select sum(amount_vnd) from public.wallet_ledger where order_id = p_order_id), 0))::bigint;
$$;
create or replace function app.order_credit_vnd(p_order_id uuid)
returns bigint language sql stable security definer set search_path = '' as $$
select coalesce((select sum(amount_vnd) from public.credit_notes where order_id = p_order_id and status = 'da_duyet'), 0)::bigint;
$$;
create or replace view public.wallet_balances with (security_invoker = true) as
select e.customer_id, e.id as entity_id, e.code as entity_code, e.legal_name,
coalesce(sum(l.amount_vnd), 0)::bigint as balance_vnd,
coalesce(sum(l.amount_vnd) filter (where l.kind = 'nap'), 0)::bigint as topup_vnd,
coalesce(-sum(l.amount_vnd) filter (where l.kind in ('coc','thanh_toan')), 0)::bigint as spent_vnd,
(select count(*) from public.wallet_topups t where t.entity_id = e.id and t.status = 'cho_duyet' and t.deleted_at is null) as pending_topups,
max(l.created_at) as last_movement_at
from public.customer_entities e
left join public.wallet_ledger l on l.entity_id = e.id
where e.deleted_at is null and app.can_see_entity(e.customer_id, e.id)
group by e.customer_id, e.id, e.code, e.legal_name;
create or replace function public.create_topup(p_customer_id uuid, p_entity_id uuid, p_amount bigint, p_transfer_date date,
p_account_code text, p_bank_ref text, p_payer_name text, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_min bigint; v_auto boolean;
begin
if app.is_staff() then
if not (app.has_perm('finance.receipt.write') and app.staff_can_see_customer(p_customer_id)) then
raise exception 'Không có quyền ghi nhận tiền vào' using errcode = '42501';
end if;
v_auto := true;
else
if not (app.has_perm('wallet.topup_own') and app.can_see_entity(p_customer_id, p_entity_id)) then
raise exception 'Không có quyền nạp ví cho công ty này' using errcode = '42501';
end if;
v_auto := false;
end if;
v_min := coalesce((app.setting('wallet.min_topup_vnd'))::text::bigint, 0);
if p_amount is null or p_amount < greatest(v_min, 1) then
raise exception 'Số tiền nạp tối thiểu % đ', v_min using errcode = '22023';
end if;
if p_transfer_date > current_date then raise exception 'Ngày chuyển khoản không được ở tương lai' using errcode = '22023'; end if;
if p_account_code is not null and not exists (select 1 from public.lookup_values where category = 'topup_account' and code = p_account_code and is_active) then
raise exception 'Tài khoản nhận tiền không có trong danh mục' using errcode = '22023';
end if;
if nullif(trim(p_bank_ref), '') is not null and exists (select 1 from public.wallet_topups where bank_ref = trim(p_bank_ref)
and coalesce(account_code, '') = coalesce(p_account_code, '') and status in ('cho_duyet','da_duyet') and deleted_at is null) then
raise exception 'Mã giao dịch % đã được ghi nhận, kiểm tra trùng', trim(p_bank_ref) using errcode = '23505';
end if;
insert into public.wallet_topups (customer_id, entity_id, amount_vnd, transfer_date, account_code, bank_ref, payer_name, note, status, reviewed_by, reviewed_at)
values (p_customer_id, p_entity_id, p_amount, coalesce(p_transfer_date, current_date), p_account_code, nullif(trim(p_bank_ref), ''),
nullif(trim(p_payer_name), ''), nullif(trim(p_note), ''),
case when v_auto then 'da_duyet' else 'cho_duyet' end, case when v_auto then auth.uid() end, case when v_auto then now() end)
returning id into v_id;
if v_auto then
insert into public.wallet_ledger (customer_id, entity_id, amount_vnd, kind, topup_id, note)
values (p_customer_id, p_entity_id, p_amount, 'nap', v_id, 'Kế toán ghi nhận tiền vào');
perform app.notify(app.order_customer_users_by_entity(p_customer_id, p_entity_id), 'wallet.topup', 'Ví đã được cộng ' || to_char(p_amount, 'FM999G999G999G999') || ' đ', p_note, '/vi/', null);
else
perform app.notify(app.perm_users('finance.receipt.write'), 'wallet.topup', 'Yêu cầu nạp ví mới: ' || to_char(p_amount, 'FM999G999G999G999') || ' đ',
'Kiểm tra ảnh chuyển khoản và duyệt', '/vi/', null);
end if;
return v_id;
end $$;
create or replace function app.order_customer_users_by_entity(p_customer uuid, p_entity uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
select array_agg(cu.user_id) from public.customer_users cu join public.profiles p on p.user_id = cu.user_id and p.is_active
where cu.customer_id = p_customer and (cu.entity_id is null or cu.entity_id = p_entity);
$$;
create or replace function public.review_topup(p_topup_id uuid, p_approve boolean, p_note text default null, p_amount bigint default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.wallet_topups;
begin
select * into t from public.wallet_topups where id = p_topup_id for update;
if not found or not app.staff_can_see_customer(t.customer_id) or not app.has_perm('finance.receipt.write') then
raise exception 'Không có quyền duyệt nạp ví' using errcode = '42501';
end if;
if t.status <> 'cho_duyet' then raise exception 'Yêu cầu đã được xử lý' using errcode = '22023'; end if;
if not p_approve and coalesce(length(trim(p_note)), 0) < 3 then raise exception 'Ghi lý do từ chối' using errcode = '22023'; end if;
if p_approve and p_amount is not null and p_amount <> t.amount_vnd then
if p_amount <= 0 then raise exception 'Số tiền không hợp lệ' using errcode = '22023'; end if;
if coalesce(length(trim(p_note)), 0) < 3 then raise exception 'Số tiền thực nhận khác yêu cầu: ghi lý do' using errcode = '22023'; end if;
t.amount_vnd := p_amount;
end if;
update public.wallet_topups set status = case when p_approve then 'da_duyet' else 'tu_choi' end, amount_vnd = t.amount_vnd,
reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(trim(p_note), ''), row_version = row_version
where id = t.id;
if p_approve then
insert into public.wallet_ledger (customer_id, entity_id, amount_vnd, kind, topup_id, note)
values (t.customer_id, t.entity_id, t.amount_vnd, 'nap', t.id, 'Duyệt ' || t.code);
end if;
perform app.notify(app.order_customer_users_by_entity(t.customer_id, t.entity_id), 'wallet.topup',
case when p_approve then 'Đã duyệt nạp ví ' || t.code || ': +' || to_char(t.amount_vnd, 'FM999G999G999G999') || ' đ'
else 'Từ chối nạp ví ' || t.code end, p_note, '/vi/', null);
end $$;
create or replace function public.cancel_topup(p_topup_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.wallet_topups;
begin
select * into t from public.wallet_topups where id = p_topup_id for update;
if not found or not app.can_see_entity(t.customer_id, t.entity_id) then raise exception 'Không tìm thấy yêu cầu' using errcode = '42501'; end if;
if t.status <> 'cho_duyet' then raise exception 'Chỉ hủy được yêu cầu đang chờ duyệt' using errcode = '22023'; end if;
if not app.is_staff() and t.created_by is distinct from auth.uid() then raise exception 'Chỉ người tạo được hủy' using errcode = '42501'; end if;
update public.wallet_topups set status = 'huy', row_version = row_version where id = t.id;
end $$;
create or replace function public.pay_order(p_order_id uuid, p_amount bigint, p_kind text default 'thanh_toan', p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.orders; st public.order_statements; v_paid bigint; v_bal bigint; v_remaining bigint;
begin
if p_kind not in ('coc', 'thanh_toan') then raise exception 'Loại thanh toán không hợp lệ' using errcode = '22023'; end if;
if p_amount is null or p_amount <= 0 then raise exception 'Số tiền phải lớn hơn 0' using errcode = '22023'; end if;
select * into o from public.orders where id = p_order_id and deleted_at is null for update;
if not found then raise exception 'Không tìm thấy đơn' using errcode = '42501'; end if;
if app.is_staff() then
if not (app.has_perm('wallet.pay') and app.staff_can_see_customer(o.customer_id)) then
raise exception 'Không có quyền thanh toán đơn từ ví' using errcode = '42501';
end if;
else
if not (app.has_perm('order.pay_own') and app.can_see_entity(o.customer_id, o.entity_id)) then
raise exception 'Tài khoản không có quyền thanh toán. Liên hệ quản trị tài khoản công ty.' using errcode = '42501';
end if;
if not coalesce((app.setting('wallet.customer_can_pay'))::text::boolean, true) then
raise exception 'Nam Trung đang tạm khóa khách tự thanh toán, liên hệ CSKH' using errcode = '42501';
end if;
end if;
if o.status in ('huy', 'dang_len_don') then raise exception 'Đơn chưa gửi hoặc đã hủy, không thanh toán được' using errcode = '22023'; end if;
select * into st from public.order_statements where order_id = o.id and status <> 'superseded' order by version desc limit 1;
if not found then raise exception 'Đơn chưa có phiếu tính tiền' using errcode = '22023'; end if;
if st.status <> 'confirmed' and coalesce((app.setting('order.payment_requires_confirmed_quote'))::text::boolean, true) then
raise exception 'Cần xác nhận phiếu tính tiền trước khi thanh toán' using errcode = '22023';
end if;
v_paid := app.order_paid_vnd(o.id);
v_remaining := st.total_vnd - v_paid - app.order_credit_vnd(o.id);
if p_amount > v_remaining then
raise exception 'Vượt số còn phải trả của đơn (còn % đ)', v_remaining using errcode = '23514';
end if;
perform pg_advisory_xact_lock(hashtextextended('wallet:' || o.entity_id::text, 0));
v_bal := app.wallet_balance(o.customer_id, o.entity_id);
if p_amount > v_bal then
raise exception 'Số dư ví không đủ (còn % đ). Nạp thêm % đ.', v_bal, p_amount - v_bal using errcode = '23514';
end if;
insert into public.wallet_ledger (customer_id, entity_id, amount_vnd, kind, order_id, note)
values (o.customer_id, o.entity_id, -p_amount, p_kind, o.id, coalesce(nullif(trim(p_note), ''), case p_kind when 'coc' then 'Đặt cọc ' else 'Thanh toán ' end || o.code));
perform app.notify(app.order_staff_users(o.id) || app.perm_users('finance.receipt.write'), 'order.payment',
'Đơn ' || o.code || ': ' || case p_kind when 'coc' then 'đã đặt cọc ' else 'đã thanh toán ' end || to_char(p_amount, 'FM999G999G999G999') || ' đ',
null, '/don-hang/chi-tiet/?id=' || o.id, o.id);
perform app.notify(app.order_customer_users(o.id), 'order.payment',
'Đơn ' || o.code || ': trừ ví ' || to_char(p_amount, 'FM999G999G999G999') || ' đ', null, '/don-hang/chi-tiet/?id=' || o.id, o.id);
return jsonb_build_object('paid_vnd', v_paid + p_amount, 'remaining_vnd', v_remaining - p_amount, 'balance_vnd', v_bal - p_amount);
end $$;
create or replace function public.reverse_wallet_entry(p_entry_id bigint, p_reason text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare e public.wallet_ledger; v_id bigint;
begin
select * into e from public.wallet_ledger where id = p_entry_id;
if not found or not app.staff_can_see_customer(e.customer_id) or not app.has_perm('finance.receipt.write') then
raise exception 'Không có quyền đảo bút toán ví' using errcode = '42501';
end if;
if e.kind = 'dao' then raise exception 'Không đảo một bút toán đảo' using errcode = '22023'; end if;
if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'Ghi rõ lý do đảo (tối thiểu 5 ký tự)' using errcode = '22023'; end if;
perform pg_advisory_xact_lock(hashtextextended('wallet:' || e.entity_id::text, 0));
if e.amount_vnd > 0 and app.wallet_balance(e.customer_id, e.entity_id) < e.amount_vnd then
raise exception 'Số dư ví không đủ để đảo khoản nạp này (đã dùng thanh toán đơn). Đảo các khoản thanh toán trước.' using errcode = '23514';
end if;
insert into public.wallet_ledger (customer_id, entity_id, amount_vnd, kind, order_id, topup_id, reverses_id, note)
values (e.customer_id, e.entity_id, -e.amount_vnd, 'dao', e.order_id, e.topup_id, e.id, 'Đảo #' || e.id || ': ' || trim(p_reason))
returning id into v_id;
return v_id;
end $$;
create or replace function public.refund_order_to_wallet(p_order_id uuid, p_amount bigint, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders; st public.order_statements; v_paid bigint;
begin
select * into o from public.orders where id = p_order_id for update;
if not found or not app.staff_can_see_customer(o.customer_id) or not app.has_perm('finance.receipt.write') then
raise exception 'Không có quyền hoàn tiền' using errcode = '42501';
end if;
if p_amount is null or p_amount <= 0 then raise exception 'Số tiền phải lớn hơn 0' using errcode = '22023'; end if;
if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'Ghi rõ lý do hoàn' using errcode = '22023'; end if;
select * into st from public.order_statements where order_id = o.id and status <> 'superseded' order by version desc limit 1;
v_paid := app.order_paid_vnd(o.id);
if p_amount > v_paid + app.order_credit_vnd(o.id) - coalesce(st.total_vnd, 0) and o.status <> 'huy' then
raise exception 'Chỉ hoàn phần trả thừa (thừa % đ). Đơn hủy thì hoàn tối đa số đã trả.', greatest(v_paid + app.order_credit_vnd(o.id) - coalesce(st.total_vnd, 0), 0) using errcode = '23514';
end if;
if p_amount > v_paid then raise exception 'Vượt số đã trả của đơn' using errcode = '23514'; end if;
insert into public.wallet_ledger (customer_id, entity_id, amount_vnd, kind, order_id, note)
values (o.customer_id, o.entity_id, p_amount, 'hoan_don', o.id, trim(p_reason));
end $$;
