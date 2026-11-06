-- =====================================================================
-- NAMCHI ERP – Giai đoạn 1 – 0500: Dữ liệu danh mục (không phải dữ liệu giả)
-- Tài liệu: mục 8.3 và bảng quyết định 06/11
-- =====================================================================

insert into public.roles (code, name, user_type, description) values
  ('admin',        'Admin',             'staff',    'Cấu hình, tài khoản, phân quyền, sửa bút toán (2 lượt)'),
  ('manager',      'Quản lý',           'staff',    'Toàn hệ thống, không sửa bút toán, không xem lợi nhuận'),
  ('cs',           'CSKH',              'staff',    'Chỉ khách được phân công'),
  ('accountant',   'Kế toán',           'staff',    'Toàn bộ tài chính, lợi nhuận'),
  ('xnk',          'XNK',               'staff',    'Khai báo, list xe, chứng từ'),
  ('warehouse_cn', 'Kho Trung Quốc',    'staff',    'Kho Quảng Châu, Bằng Tường; gồm điều vận'),
  ('warehouse_vn', 'Kho Việt Nam',      'staff',    'Kiểm đếm, nhập, xuất, giao hàng'),
  ('cust_admin',   'Quản trị khách',    'customer', 'Quản lý tài khoản trong khách/công ty con của mình'),
  ('cust_member',  'Thành viên khách',  'customer', 'Xem đầy đủ trong phạm vi, tạo đơn, khiếu nại');

insert into public.permissions (code, module, description) values
  ('customer.read_all',       'customer', 'Xem mọi khách hàng'),
  ('customer.read_assigned',  'customer', 'Xem khách được phân công'),
  ('customer.write',          'customer', 'Tạo, sửa khách hàng, công ty con, liên hệ'),
  ('customer_user.invite',    'customer', 'Mời tài khoản khách trong phạm vi của mình'),
  ('user.manage',             'system',   'Quản lý nhân viên, vai trò, phân công CSKH, khóa tài khoản'),
  ('role.manage',             'system',   'Sửa ma trận vai trò × quyền'),
  ('settings.manage',         'system',   'Sửa cài đặt có hiệu lực, đối tác thương mại'),
  ('audit.read',              'system',   'Xem nhật ký hệ thống'),
  ('attachment.upload',       'file',     'Tải file lên'),
  ('finance.profit.read',     'finance',  'Xem giá vốn, lợi nhuận'),
  ('finance.ledger.edit',     'finance',  'Sửa bút toán đã ghi sổ (xác nhận 2 lượt)');

-- Ma trận vai trò × quyền
with m(role_code, perm_code) as (values
  -- Admin: tất cả
  ('admin','customer.read_all'), ('admin','customer.write'), ('admin','customer_user.invite'),
  ('admin','user.manage'), ('admin','role.manage'), ('admin','settings.manage'), ('admin','audit.read'),
  ('admin','attachment.upload'), ('admin','finance.profit.read'), ('admin','finance.ledger.edit'),
  -- Quản lý: không lợi nhuận, không sửa bút toán
  ('manager','customer.read_all'), ('manager','audit.read'), ('manager','attachment.upload'),
  -- CSKH
  ('cs','customer.read_assigned'), ('cs','customer_user.invite'), ('cs','attachment.upload'),
  -- Kế toán
  ('accountant','customer.read_all'), ('accountant','audit.read'), ('accountant','attachment.upload'),
  ('accountant','finance.profit.read'),
  -- XNK, kho
  ('xnk','customer.read_all'), ('xnk','attachment.upload'),
  ('warehouse_cn','customer.read_all'), ('warehouse_cn','attachment.upload'),
  ('warehouse_vn','customer.read_all'), ('warehouse_vn','attachment.upload'),
  -- Khách
  ('cust_admin','customer_user.invite'), ('cust_admin','attachment.upload'),
  ('cust_member','attachment.upload')
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from m
join public.roles r       on r.code = m.role_code
join public.permissions p on p.code = m.perm_code;

-- Cài đặt ban đầu (anh chốt ngày 06/11/2026)
insert into public.app_settings (key, value_json, note) values
  ('shipping.volumetric_divisor', '6000',                 'Kg quy đổi = D×R×C (cm) / 6000'),
  ('finance.writeoff_threshold_vnd', '50000',             'Chênh dưới ngưỡng kế toán tự xử lý; trên ngưỡng Quản lý duyệt'),
  ('file.max_size_bytes', '20971520',                     '20 MB/file'),
  ('file.signed_url_ttl_seconds', '300',                  'Link tải file hết hạn sau 5 phút');

-- Đơn vị đứng tên nhập khẩu
insert into public.trade_parties (code, party_role, legal_name) values
  ('SIMBA',    'importer', 'SIMBAGROUP'),
  ('APT',      'importer', 'ALPHATIC (APT)'),
  ('NAMTRUNG', 'importer', 'Công ty TNHH Dịch vụ và Thương mại Quốc tế Nam Trung');
