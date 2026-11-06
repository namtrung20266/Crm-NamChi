# NAMCHI – Hệ thống hóa quy trình, luồng dữ liệu và chỗ cần sửa

Tài liệu này là "bản đồ" để sau này sửa hệ thống không phải đọc lại toàn bộ code. Bản đồ code tự sinh nằm ở `docs/graph/` (mở `graph.html` bằng trình duyệt; tạo lại bằng `graphify update .`).

## 1. Kiến trúc

```mermaid
flowchart LR
  U[Trình duyệt: nhân viên / khách] -->|HTTPS| P[GitHub Pages\ntrang tĩnh web/out]
  U -->|supabase-js + phiên đăng nhập| S[(Supabase Postgres\nRLS + hàm DB)]
  U -->|mời / link mật khẩu| F[Edge Function user-admin\ngiữ khóa service role]
  F --> S
  G[GitHub repo main] -->|Actions: deploy-pages| P
  G -->|Actions: db-tests 75 test| T[Postgres test]
  S -->|Actions: db-backup 01:00| D[(Google Drive\nbản backup mã hóa)]
```

- Không có máy chủ ứng dụng: mọi quyền và tính toán tiền nằm trong **database** (RLS + hàm `security definer`), nên trang tĩnh vẫn an toàn.
- Khóa trong trang web là khóa **công khai** (publishable). Khóa bí mật (service role) chỉ tồn tại trong Edge Function.

## 2. Ai thấy gì (RLS)

| Phạm vi | Ai | Hàm quyết định |
| --- | --- | --- |
| Mọi khách | Admin, Quản lý, Kế toán, XNK, Kho | `app.staff_can_see_customer()` + quyền `customer.read_all` |
| Khách được phân công | CSKH | bảng `staff_customer_assignments` còn hiệu lực |
| Một khách | Tài khoản Lanchi cấp tổng | `customer_users.entity_id = null` |
| Một công ty con | Tài khoản Sen Vàng, Thịnh Vượng… | `app.can_see_entity()` |

Giá vốn/lợi nhuận (`order_costs`, `order_profit`) chỉ đọc được với quyền `finance.profit.read` (Admin, Kế toán). Giao dịch tiền cấp Lanchi (`bank_receipts`) công ty con không xem được.

## 3. Luồng đơn hàng (Giai đoạn 2 – đang chạy)

```mermaid
stateDiagram-v2
  [*] --> dang_len_don: Khách/CSKH tạo đơn
  dang_len_don --> cho_coc: Lập phiếu dự tính
  cho_coc --> dang_mua: Nhận cọc L1
  dang_mua --> cho_shop_giao
  cho_shop_giao --> shop_da_phat
  shop_da_phat --> ve_kho_qc
  ve_kho_qc --> ve_bang_tuong
  ve_bang_tuong --> tren_xe: GĐ3 – list xe
  tren_xe --> ve_kho_vn
  ve_kho_vn --> dang_giao
  dang_giao --> da_giao
  da_giao --> hoan_tat: Quyết toán + thu đủ L2
```

Mọi lần đổi trạng thái tự ghi `order_status_history`. Khách không sửa đơn sau khi gửi (trigger `tg_orders_customer_guard`).

## 4. Luồng tiền

```mermaid
flowchart TB
  O[Đơn hàng\n tệ × tỷ giá ghim] --> B[build_statement\nDự tính → Tạm tính → Quyết toán]
  R[(fee_rules\nbiểu phí có hiệu lực)] --> B
  B --> L[order_statement_lines\nkhách thấy]
  B --> C[order_costs\nnội bộ, giá vốn]
  K[bank_receipts\n1 giao dịch ngân hàng] --> A[receipt_allocations\nL1 / L2 vào n đơn]
  A --> V[order_finance\nphải thu – đã trả – còn lại]
  L --> V
  C --> P[order_profit]
  SP[supplier_payments\ntỷ giá thực tế] --> P
```

Quy tắc cứng (trong DB, không vượt qua được từ giao diện):

1. Mức phí lấy theo **ngày tạo đơn** → đổi biểu phí không làm sai đơn cũ.
2. Phân bổ tiền **không vượt** số tiền giao dịch, **không chéo khách**, chỉ ghi thêm; sai thì ghi dòng âm (đảo).
3. Dòng phiếu và giá vốn chỉ ghi thêm; lập lại phiếu = bản mới, bản cũ `superseded`.
4. Tiền VND là số nguyên đồng (`bigint`).

Công thức (hàm `public.build_statement`):

| Khoản | Cách tính |
| --- | --- |
| Tiền hàng | `goods_cny × fx_rate` |
| Thuế xuất HĐ TQ | `china_tax_cny × fx_rate` |
| `percent_goods` (mua hàng, TNDN) | `% × tiền hàng` |
| `percent_goods_after_tax` (handle) | `% × (tiền hàng + thuế TQ)` |
| `per_kg` (cước) | `đ/kg × weight_kg` |
| `actual` (kiểm định, ship, thuế NK) | nhập tay ở trang đơn |
| VAT | `vat_rate × cộng` (tạm; GĐ5 lấy theo dòng hóa đơn) |
| Cọc L1 đề xuất | `finance.deposit_rate_percent × tiền hàng` |

## 5. Sửa ở đâu khi cần

| Muốn đổi | Sửa ở |
| --- | --- |
| Mức phí, phí mới theo khách/loại HĐ/nhóm hàng | Màn **Biểu phí** (không cần code) |
| Tỷ lệ cọc, tỷ giá mặc định, hệ số khối | Màn **Cài đặt** |
| Quyền của một vai trò | Màn **Phân quyền** |
| Thêm loại phí có cách tính mới | `fee_types.calc_method` + nhánh trong `build_statement` (migration mới) |
| Thêm trạng thái đơn | check constraint `orders.status` + `web/src/lib/status.ts` |
| Thêm màn hình | `web/src/app/(app)/<ten>/page.tsx` + `web/src/components/nav.ts` |

Quy trình sửa an toàn: tạo migration mới trong `supabase/migrations` → viết test trong `supabase/tests` → `scripts/local/run_tests.sh` xanh → đẩy lên `main` (Pages tự build) → áp migration lên Supabase.

## 6. Kho, hải quan, hóa đơn, khiếu nại (Giai đoạn 3–5 – đã có)

```mermaid
flowchart LR
  K[Kho TQ nhận kiện\nD×R×C/6000] --> D[Dòng khai báo\nCSKH lập → XNK xác nhận]
  D --> LB[List bốc\nkhông vượt SL, 1 kiện 1 list]
  LB --> LX[List xe → Chốt\nsnapshot + mã băm]
  LX --> F[File khai báo APT · Invoice · Packing list]
  LX --> VN[Kho VN: đếm tổng\nlệch → chạm từng kiện]
  VN --> GH[Phiếu giao nhiều đợt\nkhông vượt số đã về]
  HV[HĐ đầu vào theo Mã HH] --> HB[HĐ bán L1/L2\nkhông vượt HĐ vào, chờ hợp quy]
  HB --> MISA[File import MISA]
  KN[Khiếu nại] --> CN[Credit note\nngười khác duyệt, trên ngưỡng cần Admin]
  CN --> CNO[Giảm công nợ đơn]
```

| Màn hình | Ai dùng | Quy tắc cứng trong DB |
| --- | --- | --- |
| Đơn hàng → Kiện hàng | Kho TQ | Cân tính phí = MAX(kg, D×R×C/hệ số ghim lúc tạo kiện); tự cộng lên đơn |
| Đơn hàng → Dòng khai báo, Bàn khai báo | CSKH lập, XNK xác nhận | Xác nhận cần HS 8 số; sửa dòng đã xác nhận tự về nháp |
| List bốc / List xe | CSKH, XNK | `tg_picking_item_guard`, `tg_picking_package_guard`, `lock_trip` |
| Kho VN – nhận xe | Kho VN | `receive_trip` (tầng nhanh), `finish_trip_receipt` (có lệch, bắt buộc ghi chú) |
| Giao hàng | Kho VN | `tg_goods_issue_line_guard`: giao ≤ đã về VN |
| Hóa đơn | Kế toán | `tg_sales_line_guard`: HĐ bán ≤ HĐ vào, chỉ dòng hồ sơ Đạt/Không cần; phát hành phải có số + ngày |
| Khiếu nại | Khách, CSKH | Khách không sửa khiếu nại, chỉ nhắn; tin nội bộ ẩn với khách; credit note duyệt qua `approve_credit_note` |

## 7. Việc tiếp theo

- Upload ảnh kiện/chứng từ lên Google Drive (bảng `attachments` đã có).
- Mẫu file chứng từ theo đúng form Nam Trung/APT khi có bộ mẫu.
- Telegram thông báo, dashboard theo vai trò.
