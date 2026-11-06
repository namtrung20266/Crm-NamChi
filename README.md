# NAMCHI ERP – CRM & Import Management (Nam Trung × Lanchi)

Tài liệu thiết kế gốc: "NAMCHI ERP – Bộ tài liệu thiết kế" (SRS, ERD, Workflow, Security, mục 8 Giai đoạn 1).

## Trạng thái

| Giai đoạn | Nội dung | Trạng thái |
| --- | --- | --- |
| 1 | Tài khoản, khách hàng, công ty con, phân quyền, cài đặt, nhật ký | Đang chạy |
| 2 | Đơn hàng, biểu phí, phiếu tính tiền 3 bản, tiền vào, phân bổ L1/L2, thanh toán NCC, công nợ, lợi nhuận | Đang chạy |
| 3 | Kiện & cân đo, dòng khai báo, thư viện HS, list bốc, list xe, chốt + xuất file khai báo/invoice/packing | Xong |
| 4 | Kho VN kiểm đếm 2 tầng, phiếu giao nhiều đợt | Xong |
| 5 | HĐ đầu vào theo Mã HH, HĐ bán L1/L2, tồn HĐ, file MISA, khiếu nại, credit note | Xong |

Trang web: https://namtrung20266.github.io/Crm-NamChi/ (GitHub Pages, tự build từ thư mục `web/`).
Bản đồ quy trình: `docs/FLOWS.md`. Bản đồ code: `docs/graph/graph.html`.

## Cấu trúc

```
supabase/migrations/   SQL tạo database, chạy theo thứ tự tên file
  ..0100_foundation        schema app/audit, trigger cột chuẩn, chặn xóa vật lý
  ..0200_core_tables       14 bảng Giai đoạn 1
  ..0300_audit             nhật ký chỉ ghi thêm
  ..0400_security_rls      hàm phân quyền, RLS, RPC set_setting/get_setting/my_permissions/set_user_active
  ..0500_seed_reference    vai trò, quyền, ma trận quyền, cài đặt ban đầu, đơn vị nhập khẩu
web/                   ứng dụng Next.js (đăng nhập, khung giao diện, menu theo quyền)
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

## Chạy ứng dụng web

```bash
cd web
npm ci
# tạo web/.env.local với NEXT_PUBLIC_SUPABASE_URL và NEXT_PUBLIC_SUPABASE_ANON_KEY (khóa publishable)
npm run dev
```

Triển khai: đẩy lên `main`, workflow `deploy-pages` tự build và đưa lên GitHub Pages.
