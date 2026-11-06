-- =====================================================================
-- NAMCHI ERP – Làm lại luồng đơn hàng (07/11/2026)
--   1. Trung tâm cấu hình: danh mục dùng chung + bộ trạng thái đơn cấu hình được
--   2. Đơn hàng: thêm trường, khách sửa được khi còn nháp, đổi trạng thái qua RPC
--      có lý do, tự đồng bộ trạng thái theo dữ liệu (thanh toán, kiện, giao, HĐ)
--   3. Ví khách hàng: nạp tiền có ảnh chứng từ, kế toán duyệt, đặt cọc/thanh toán
--      đơn trừ ví (khách tự bấm được), bút toán đảo, không sửa/xóa
--   4. Trao đổi trên đơn (khách ↔ Nam Trung, ghi chú nội bộ) + thông báo
--   5. File: chỉ Edge Function (service role) ghi bảng attachments sau khi đẩy
--      lên Google Drive → người dùng không gắn được file id tùy ý
--   6. Tiến độ đơn: thanh toán, khai báo, kiện, giao hàng, hóa đơn xuất đủ/thiếu
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Đọc cài đặt nội bộ (không kiểm tra vai trò; KHÔNG cấp cho client)
-- ---------------------------------------------------------------------
create or replace function app.setting(p_key text, p_default jsonb default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select s.value_json from public.app_settings s
                   where s.key = p_key and s.valid_from <= now() and (s.valid_to is null or s.valid_to > now())
                   order by s.valid_from desc limit 1), p_default);
$$;
revoke all on function app.setting(text, jsonb) from public, anon, authenticated;

insert into public.app_settings (key, value_json, note) values
  ('order.auto_status_enabled',              'true',   'Tự chuyển trạng thái đơn theo dữ liệu (thanh toán, kiện, giao hàng, hóa đơn)'),
  ('order.payment_requires_confirmed_quote', 'true',   'Chỉ cho cọc/thanh toán khi khách đã xác nhận phiếu tính tiền'),
  ('order.complete_requires_invoice',        'true',   'Đơn chỉ Hoàn tất khi đã phát hành HĐ bán đủ số lượng'),
  ('order.require_attachment_on_submit',     'false',  'Bắt buộc có ảnh/file khi khách gửi đơn'),
  ('wallet.customer_can_pay',                'true',   'Khách tự bấm đặt cọc/thanh toán đơn từ ví'),
  ('wallet.min_topup_vnd',                   '100000', 'Số tiền nạp ví tối thiểu'),
  ('notify.poll_seconds',                    '30',     'Chu kỳ làm mới thông báo trên giao diện (giây)')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 1. Quyền mới
-- ---------------------------------------------------------------------
insert into public.permissions (code, module, description) values
  ('wallet.pay',       'finance', 'Thanh toán/đặt cọc đơn từ ví khách (thao tác thay khách)'),
  ('order.pay_own',    'finance', 'Khách tự đặt cọc/thanh toán đơn từ ví công ty mình'),
  ('wallet.topup_own', 'finance', 'Khách tạo yêu cầu nạp ví kèm ảnh chuyển khoản'),
  ('order.message',    'order',   'Trao đổi, nhắn tin trên đơn hàng')
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

-- ---------------------------------------------------------------------
-- 2. Danh mục dùng chung (Configuration Center → Master Data)
-- ---------------------------------------------------------------------
create table public.lookup_values (
  id          uuid primary key default gen_random_uuid(),
  category    text not null check (category ~ '^[a-z_]{2,40}$'),
  code        text not null check (code ~ '^[a-z0-9_]{1,40}$'),
  label       text not null check (length(trim(label)) > 0),
  sort_order  integer not null default 100,
  is_active   boolean not null default true,
  meta        jsonb not null default '{}',
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

-- ---------------------------------------------------------------------
-- 3. Bộ trạng thái đơn (Configuration Center → Workflow)
--    Mã và thứ tự trạng thái hệ thống cố định vì logic đồng bộ dựa vào chúng;
--    tên hiển thị, màu, thông báo khách, SLA đổi được.
-- ---------------------------------------------------------------------
create table public.order_status_defs (
  code            text primary key check (code ~ '^[a-z_]{2,30}$'),
  label           text not null,
  customer_label  text,                       -- tên khách thấy (trống = dùng label)
  tone            text not null default 'neutral' check (tone in ('neutral','brand','warn','ok','danger','info')),
  rank            integer not null unique,    -- thứ tự trong luồng
  phase           text not null check (phase in ('tiep_nhan','mua_hang','van_chuyen','viet_nam','ket_thuc','ngoai_le')),
  owner_role      text,                       -- bộ phận chịu trách nhiệm ở bước này
  sla_days        integer check (sla_days is null or sla_days > 0),
  notify_customer boolean not null default true,
  is_system       boolean not null default false,
  is_active       boolean not null default true,
  description     text,
  updated_at timestamptz not null default now(), updated_by uuid
);

insert into public.order_status_defs (code, label, customer_label, tone, rank, phase, owner_role, sla_days, notify_customer, is_system, description) values
  ('dang_len_don',  'Khách đang lên đơn',      'Đang lên đơn',            'neutral', 10,  'tiep_nhan',  'cust',         null, false, true, 'Nháp: khách sửa tự do, Nam Trung chưa xử lý'),
  ('cho_bao_gia',   'Chờ báo giá',             'Chờ Nam Trung báo giá',   'warn',    20,  'tiep_nhan',  'cs',           1,    true,  true, 'Khách đã gửi đơn; CSKH lập phiếu tính tiền'),
  ('cho_coc',       'Chờ đặt cọc',             'Chờ đặt cọc',             'warn',    30,  'tiep_nhan',  'cust',         2,    true,  true, 'Khách đã xác nhận báo giá; chờ cọc từ ví'),
  ('dang_mua',      'Đang mua hàng',           'Đang mua hàng',           'info',    40,  'mua_hang',   'cs',           2,    true,  true, 'Đã nhận cọc; CSKH đặt hàng, kế toán trả NCC'),
  ('cho_shop_giao', 'Chờ shop giao hàng',      'Chờ shop giao hàng',      'info',    50,  'mua_hang',   'cs',           7,    true,  true, 'Đã thanh toán NCC, chờ shop phát hàng'),
  ('shop_da_phat',  'Shop đã phát hàng',       'Shop đã phát hàng',       'info',    60,  'mua_hang',   'warehouse_cn', 4,    true,  true, 'Đang vận chuyển nội địa TQ'),
  ('ve_kho_qc',     'Về kho Quảng Châu',       'Về kho Quảng Châu',       'brand',   70,  'van_chuyen', 'warehouse_cn', 3,    true,  true, 'Tất cả kiện đã nhập kho Quảng Châu'),
  ('ve_bang_tuong', 'Về Bằng Tường',           'Về Bằng Tường',           'brand',   80,  'van_chuyen', 'warehouse_cn', 3,    true,  true, 'Tất cả kiện đã ở Bằng Tường/cửa khẩu'),
  ('cho_check_tem', 'Chờ check tem/mác',       'Chờ check tem/mác',       'warn',    90,  'van_chuyen', 'xnk',          2,    true,  true, 'Kiểm tem, nhãn mác trước khi lên xe'),
  ('tren_xe',       'Đang về Việt Nam',        'Đang về Việt Nam',        'brand',   100, 'van_chuyen', 'xnk',          3,    true,  true, 'Tất cả kiện đã lên xe, đang thông quan'),
  ('ve_kho_vn',     'Đã nhận hàng tại VN',     'Đã nhận hàng tại VN',     'ok',      110, 'viet_nam',   'warehouse_vn', 2,    true,  true, 'Tất cả kiện đã về kho Việt Nam'),
  ('dang_giao',     'Đang giao hàng',          'Đang giao hàng',          'ok',      120, 'viet_nam',   'warehouse_vn', 2,    true,  true, 'Đã giao một phần'),
  ('da_giao',       'Đã giao đủ',              'Đã giao đủ',              'ok',      130, 'viet_nam',   'cs',           5,    true,  true, 'Giao đủ số lượng; chờ quyết toán và hóa đơn'),
  ('hoan_tat',      'Hoàn tất',                'Hoàn tất',                'ok',      140, 'ket_thuc',   null,           null, true,  true, 'Đã giao đủ, thanh toán đủ, xuất HĐ đủ'),
  ('tam_giu',       'Tạm giữ',                 'Tạm giữ',                 'danger',  900, 'ngoai_le',   'cs',           null, true,  true, 'Dừng xử lý, ghi rõ lý do'),
  ('huy',           'Đã hủy',                  'Đã hủy',                  'neutral', 999, 'ngoai_le',   null,           null, true,  true, 'Hủy đơn, không xử lý tiếp');

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

-- ---------------------------------------------------------------------
-- 4. Đơn hàng: trường mới, trạng thái theo bảng cấu hình
-- ---------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders drop constraint if exists orders_delay_reason_check;
alter table public.orders add constraint orders_status_fk foreign key (status) references public.order_status_defs(code);

alter table public.orders
  add column customer_ref        text,       -- mã PO / mã đơn nội bộ của khách
  add column source_channel      text,       -- lookup order_source
  add column supplier_link       text check (supplier_link is null or supplier_link ~* '^https?://'),
  add column supplier_contact    text,
  add column require_label_check boolean not null default false,  -- cần check tem/mác
  add column require_inspection  boolean not null default false,  -- cần kiểm định/hợp quy
  add column delivery_address    text,
  add column deposit_rate        numeric(5,2) check (deposit_rate is null or deposit_rate between 0 and 100), -- trống = theo cài đặt
  add column submitted_at        timestamptz,
  add column status_changed_at   timestamptz not null default now();

alter table public.order_status_history
  add column source text not null default 'manual' check (source in ('manual','auto','customer'));

create index orders_cs_owner_idx on public.orders(cs_owner_id) where deleted_at is null;

-- Khách: tạo nháp hoặc gửi luôn; sửa được khi còn nháp; mọi trường nội bộ do Nam Trung giữ
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
      -- giữ nguyên mọi trường khách không được đổi
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
    -- người tạo là CSKH → tự nhận phụ trách; còn lại lấy CSKH đang được phân công khách
    new.cs_owner_id := coalesce(
      (select auth.uid() where exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = auth.uid() and r.code = 'cs')),
      (select a.staff_user_id from public.staff_customer_assignments a where a.customer_id = new.customer_id
         and a.valid_from <= current_date and (a.valid_to is null or a.valid_to >= current_date) order by a.valid_from desc limit 1));
  end if;
  return new;
end $$;

-- Không ai đổi trạng thái bằng UPDATE trực tiếp: phải qua set_order_status / đồng bộ tự động
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

-- Thực hiện đổi trạng thái (nội bộ): bật cờ, ghi lý do/nguồn, tắt cờ
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

-- ---------------------------------------------------------------------
-- 5. Thông báo trong hệ thống
-- ---------------------------------------------------------------------
create table public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(user_id),
  kind       text not null check (kind ~ '^[a-z_.]{2,40}$'),
  title      text not null,
  body       text,
  link       text,
  order_id   uuid references public.orders(id),
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);
create index notifications_unread_idx on public.notifications(user_id) where read_at is null;

-- Người nhận: CSKH phụ trách + CSKH được phân công khách (nếu trống → Admin/Quản lý)
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

-- ---------------------------------------------------------------------
-- 6. Ví khách hàng (theo công ty con nhận hóa đơn)
-- ---------------------------------------------------------------------
create sequence public.wallet_topup_seq;
create table public.wallet_topups (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique default ('NAP' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMM') || '-' || lpad(nextval('public.wallet_topup_seq')::text, 4, '0')),
  customer_id    uuid not null,
  entity_id      uuid not null,
  amount_vnd     bigint not null check (amount_vnd > 0),
  transfer_date  date not null default current_date,
  account_code   text,                          -- lookup topup_account (tài khoản Nam Trung nhận)
  bank_ref       text,                          -- mã giao dịch ngân hàng
  payer_name     text,
  note           text,
  status         text not null default 'cho_duyet' check (status in ('cho_duyet','da_duyet','tu_choi','huy')),
  reviewed_by    uuid, reviewed_at timestamptz, review_note text,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(),
  updated_by uuid, deleted_at timestamptz, row_version integer not null default 1,
  foreign key (customer_id, entity_id) references public.customer_entities(customer_id, id)
);
create index wallet_topups_scope_idx on public.wallet_topups(customer_id, entity_id, created_at desc);
create unique index wallet_topups_bank_ref_uq on public.wallet_topups(coalesce(account_code, ''), bank_ref)
  where bank_ref is not null and status = 'da_duyet';

create table public.wallet_ledger (
  id           bigint generated always as identity primary key,
  customer_id  uuid not null,
  entity_id    uuid not null,
  amount_vnd   bigint not null check (amount_vnd <> 0),   -- + vào ví, - ra khỏi ví
  kind         text not null check (kind in ('nap','coc','thanh_toan','hoan_don','dieu_chinh','dao')),
  order_id     uuid references public.orders(id),
  topup_id     uuid references public.wallet_topups(id),
  reverses_id  bigint unique references public.wallet_ledger(id),
  note         text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
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

-- Đã thu của đơn = phân bổ tiền vào (luồng cũ) + trừ ví (luồng mới)
create or replace function app.order_paid_vnd(p_order_id uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select (coalesce((select sum(amount_vnd) from public.receipt_allocations where order_id = p_order_id), 0)
        - coalesce((select sum(amount_vnd) from public.wallet_ledger where order_id = p_order_id), 0))::bigint;
$$;

-- Giảm trừ đã duyệt (bồi thường, xử lý chênh) làm giảm số còn phải thu
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

-- Tạo yêu cầu nạp (khách) hoặc ghi nhận tiền vào (kế toán → duyệt luôn)
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

-- Đặt cọc / thanh toán đơn từ ví. Khách tự bấm hoặc nhân viên bấm thay.
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

-- Đảo một bút toán ví (thanh toán nhầm, nạp nhầm). Không sửa/xóa, chỉ ghi dòng ngược dấu.
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

-- Hoàn tiền thừa của đơn về ví (sau quyết toán)
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

-- ---------------------------------------------------------------------
-- 7. Chuyển trạng thái thủ công (có kiểm soát) và khách gửi đơn
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 8. Đồng bộ trạng thái theo dữ liệu (chỉ tiến, không lùi; bỏ qua đơn tạm giữ/hủy/hoàn tất)
-- ---------------------------------------------------------------------
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

  -- a) báo giá đã xác nhận → chờ cọc
  select * into st from public.order_statements where order_id = o.id and status <> 'superseded' order by version desc limit 1;
  if st.id is not null and st.status = 'confirmed' and app.status_rank(v_tgt) < app.status_rank('cho_coc') then
    v_tgt := 'cho_coc'; v_reason := 'Khách đã xác nhận báo giá';
  end if;

  -- b) đã cọc đủ → đang mua hàng
  v_paid := app.order_paid_vnd(o.id);
  if st.id is not null and v_paid > 0 then
    v_dep := greatest(least(st.deposit_vnd, st.total_vnd), 1);
    if v_paid >= v_dep and app.status_rank(v_tgt) < app.status_rank('dang_mua') then
      v_tgt := 'dang_mua'; v_reason := 'Đã nhận cọc ' || to_char(v_paid, 'FM999G999G999G999') || ' đ';
    end if;
  end if;

  -- c) đã trả NCC đủ tiền hàng → chờ shop giao
  select coalesce(sum(amount_cny), 0) into v_sp from public.supplier_payments where order_id = o.id and deleted_at is null;
  if o.goods_cny > 0 and v_sp >= o.goods_cny and app.status_rank(v_tgt) < app.status_rank('cho_shop_giao') then
    v_tgt := 'cho_shop_giao'; v_reason := 'Đã thanh toán đủ nhà cung cấp';
  end if;

  -- d) kiện: trạng thái của kiện chậm nhất quyết định (đủ kiện mới chuyển)
  select count(*), min(case p.status
           when 'du_kien'  then 0
           when 've_kho'   then case when w.code in ('BT','AP') then 2 when w.country = 'VN' then 4 else 1 end
           when 'tren_xe'  then 3
           when 'da_giao'  then 5
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

  -- e) giao hàng theo dòng hàng (phiếu xuất đã giao)
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

  -- f) hoàn tất: giao đủ + thu đủ + (HĐ bán đã phát hành đủ)
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

-- Trigger gọi đồng bộ
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

-- Nhận xe: không ép trạng thái đơn nữa (đơn tách nhiều xe sẽ bị sai); để đồng bộ theo kiện quyết định
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

-- Khách xác nhận phiếu → thông báo CSKH; lập phiếu mới → thông báo khách
create or replace function app.tg_statement_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = new.order_id;
  if tg_op = 'INSERT' then
    perform app.notify(app.order_customer_users(o.id), 'order.quote', 'Đơn ' || o.code || ': có phiếu tính tiền mới, vui lòng kiểm tra và xác nhận',
                       to_char(new.total_vnd, 'FM999G999G999G999') || ' đ', '/don-hang/chi-tiet/?id=' || o.id, o.id);
  elsif new.status = 'confirmed' and old.status <> 'confirmed' then
    perform app.notify(app.order_staff_users(o.id), 'order.quote', 'Đơn ' || o.code || ': khách đã xác nhận phiếu tính tiền', null, '/don-hang/chi-tiet/?id=' || o.id, o.id);
  end if;
  return null;
end $$;
create trigger order_statements_notify after update of status on public.order_statements for each row execute function app.tg_statement_notify();
-- (INSERT phiếu có total = 0 lúc chèn; thông báo phát từ build_statement sau khi tính xong)

-- ---------------------------------------------------------------------
-- 9. Trao đổi trên đơn hàng
-- ---------------------------------------------------------------------
create table public.order_messages (
  id           bigint generated always as identity primary key,
  order_id     uuid not null references public.orders(id),
  customer_id  uuid not null,
  entity_id    uuid not null,
  body         text not null check (length(trim(body)) between 1 and 4000),
  internal     boolean not null default false,   -- ghi chú nội bộ: khách không thấy
  author_side  text not null check (author_side in ('staff','customer')),
  author_name  text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
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

-- ---------------------------------------------------------------------
-- 10. File đính kèm: chỉ Edge Function ghi; người dùng hỏi quyền qua attachment_scope
-- ---------------------------------------------------------------------
alter table public.attachments
  add column category text,
  add column note     text,
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

-- Kiểm tra quyền gắn file vào một đối tượng; trả về phạm vi khách + thư mục lưu
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

-- Gỡ file (mềm): người tải lên trong 24h hoặc nhân viên có quyền
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

-- ---------------------------------------------------------------------
-- 11. Phiếu tính tiền: cọc theo tỷ lệ riêng của đơn (nếu có) + báo khách
-- ---------------------------------------------------------------------
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

  -- giữ lại các khoản phát sinh nhập tay của phiếu trước
  if v_prev is not null then
    insert into public.order_statement_lines (statement_id, order_id, customer_id, entity_id, fee_type_id, label, amount_vnd, source, visible_to_customer, sort_order)
    select v_stmt, order_id, customer_id, entity_id, fee_type_id, label, amount_vnd, 'manual', visible_to_customer, sort_order
    from public.order_statement_lines where statement_id = v_prev and source = 'manual';
    insert into public.order_costs (statement_id, order_id, fee_type_id, label, amount_vnd, source)
    select v_stmt, order_id, fee_type_id, label, amount_vnd, 'manual' from public.order_costs where statement_id = v_prev and source = 'manual';
    select v_sub + coalesce(sum(amount_vnd), 0) into v_sub from public.order_statement_lines where statement_id = v_stmt and source = 'manual';
  end if;

  -- khoản phát sinh mới truyền vào: [{label, amount_vnd, cost_vnd, fee_type_id, visible}]
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


-- ---------------------------------------------------------------------
-- 12. Dòng khai báo: thêm thông tin sản phẩm; khách tự nhập được dòng nháp
-- ---------------------------------------------------------------------
alter table public.order_items
  add column brand        text,
  add column product_link text check (product_link is null or product_link ~* '^https?://'),
  add column packing      text,      -- quy cách đóng gói (VD: 12 chiếc/hộp, 10 hộp/thùng)
  add column item_note    text;

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

-- Thêm nhiều dòng một lần (dán từ Excel) – 1 transaction, tự đánh số dòng
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

-- ---------------------------------------------------------------------
-- 13. Tiến độ đơn (1 lần gọi cho cả danh sách) – thanh toán, khai báo, kiện, giao, hóa đơn
-- ---------------------------------------------------------------------
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
  where o.id = any(p_ids) and o.deleted_at is null and app.can_see_entity(o.customer_id, o.entity_id)
    and (not app.is_staff() or app.has_perm('finance.read') or true);
$$;

-- Hóa đơn theo dòng hàng của 1 đơn: xuất đủ/thiếu bao nhiêu
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

-- Ước tính phí khi tạo đơn (giá bán theo biểu phí hiện hành; không lộ giá vốn)
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

-- order_finance: đã thu gồm cả trừ ví
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

-- ---------------------------------------------------------------------
-- 14. Trigger chuẩn, nhật ký, quyền bảng, RLS
-- ---------------------------------------------------------------------
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

alter table public.lookup_values     enable row level security;
alter table public.order_status_defs enable row level security;
alter table public.notifications     enable row level security;
alter table public.wallet_topups     enable row level security;
alter table public.wallet_ledger     enable row level security;
alter table public.order_messages    enable row level security;

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

-- Khách sửa đơn nháp của mình (trigger giữ nguyên các trường nội bộ)
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

-- hàm nội bộ: không mở cho client
revoke all on function app.order_staff_users(uuid), app.order_customer_users(uuid), app.order_customer_users_by_entity(uuid, uuid),
  app.perm_users(text), app.notify(uuid[], text, text, text, text, uuid), app.notify_status_change(uuid, text, text),
  app.wallet_balance(uuid, uuid), app.order_paid_vnd(uuid), app.order_credit_vnd(uuid), app.sync_order_status(uuid), app.status_rank(text)
  from public, anon;
-- view chạy quyền người gọi cần gọi được 2 hàm tính toán này (bản thân hàm không lộ dữ liệu ngoài phạm vi RLS view)
grant execute on function app.order_paid_vnd(uuid), app.order_credit_vnd(uuid), app.wallet_balance(uuid, uuid) to authenticated;

-- Realtime cho thông báo và tin nhắn (nếu publication có sẵn trên Supabase)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications, public.order_messages;
  end if;
end $$;
