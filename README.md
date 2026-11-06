# NAMCHI ERP – CRM & Import Management (Nam Trung × Lanchi)

Tài liệu thiết kế gốc: "NAMCHI ERP – Bộ tài liệu thiết kế" (SRS, ERD, Workflow, Security, mục 8 Giai đoạn 1).

## Trạng thái

| Giai đoạn 1 – Bước | Nội dung | Trạng thái |
| --- | --- | --- |
| 1 | Repo, CI test database, quét lộ khóa, backup hằng ngày | Xong |
| 2 | Migration 14 bảng + RLS 3 mức phạm vi + 45 test bảo mật | Xong, 45/45 đạt |
| 3 | Khung giao diện Next.js + đăng nhập | Chưa |
| 4 | 9 màn hình Giai đoạn 1 | Chưa |
| 5 | Nghiệm thu với tài khoản Lanchi + 2 công ty con | Chưa |

## Cấu trúc

```
supabase/migrations/   SQL tạo database, chạy theo thứ tự tên file
  ..0100_foundation        schema app/audit, trigger cột chuẩn, chặn xóa vật lý
  ..0200_core_tables       14 bảng Giai đoạn 1
  ..0300_audit             nhật ký chỉ ghi thêm
  ..0400_security_rls      hàm phân quyền, RLS, RPC set_setting/get_setting/my_permissions/set_user_active
  ..0500_seed_reference    vai trò, quyền, ma trận quyền, cài đặt ban đầu, đơn vị nhập khẩu
supabase/tests/        test pgTAP (đóng vai từng tài khoản)
scripts/local/         chạy test trên Postgres thường, không cần Supabase
.github/workflows/     db-tests (mỗi PR), db-backup (01:00 hằng ngày)
```

## Chạy test trên máy

```bash
sudo apt-get install -y postgresql-16 postgresql-16-pgtap
sudo service postgresql start
sudo bash scripts/local/run_tests.sh
```

## Đưa lên Supabase

Cách 1 – Supabase CLI: `supabase link --project-ref <ref>` rồi `supabase db push`.
Cách 2 – Claude áp migration qua Supabase connector (không cần gửi mật khẩu hay khóa).
KHÔNG chạy `scripts/local/supabase_stub.sql` trên Supabase thật.

## Quy tắc bảo mật

- Không commit `.env`. Khóa `SUPABASE_SERVICE_ROLE_KEY`, token Google Drive chỉ nằm trên VPS và GitHub Secrets.
- Không gửi mật khẩu, khóa bí mật qua chat, email, Zalo.
- Mọi bảng mới phải bật RLS trong chính migration tạo bảng và có test pgTAP xem chéo.
- Mọi thay đổi database qua file migration trong Git; không sửa tay trên production.

## Gói Supabase Free – điều kiện bắt buộc

- Backup: workflow `db-backup` chạy hằng ngày, mã hóa, đẩy lên Google Drive, giữ 30 ngày. Thử khôi phục mỗi tháng.
- File (ảnh, Excel, PDF) lưu Google Drive của tài khoản hệ thống, không lưu Supabase Storage.
- Theo dõi dung lượng database; khi gần giới hạn gói Free hoặc khi bắt đầu ghi nhận tiền thật thì cân nhắc lên gói Pro.
