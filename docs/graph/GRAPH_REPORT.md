# Graph Report - namchi-erp  (2026-11-06)

## Corpus Check
- 90 files · ~127,242 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 3 file(s) not represented in the graph (top: .example 1, (none) 1, .css 1)

## Summary
- 1179 nodes · 2600 edges · 127 communities (113 shown, 14 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 16 edges (avg confidence: 0.95)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- useSession
- Communities (111 total, 13 thin omitted)
- 20261106120543_phase3_warehouse_customs.sql
- pages.yml
- 20261106113457_phase2_orders_finance.sql
- 20261106065013_core_tables.sql
- package.json
- public.profiles
- steps
- compilerOptions
- steps
- public.customer_users
- login/page.tsx
- audit.logs
- ids
- app-shell.tsx
- app/layout.tsx
- dependencies
- NAMCHI – Hệ thống hóa quy trình, luồng dữ liệu và chỗ cần sửa
- NAMCHI ERP – CRM & Import Management (Nam Trung × Lanchi)
- eslint.config.mjs
- user-admin.ts
- Graph Report - namchi-erp  (2026-11-06)
- manifest.json
- docs/FLOWS.md
- docs/graph/graph.html
- docs/graph/GRAPH_REPORT.md
- docs/graph/manifest.json
- .github/workflows/db-backup.yml
- .github/workflows/db-tests.yml
- .github/workflows/pages.yml
- README.md
- scripts/local/run_tests.sh
- scripts/local/supabase_stub.sql
- supabase/functions/bootstrap-admin/index.ts
- supabase/functions/user-admin/index.ts
- supabase/migrations/20261106064938_foundation.sql
- supabase/migrations/20261106065013_core_tables.sql
- supabase/migrations/20261106065027_audit.sql
- supabase/migrations/20261106065104_security_rls.sql
- supabase/migrations/20261106065121_seed_reference.sql
- supabase/migrations/20261106081807_advisor_fixes.sql
- supabase/migrations/20261106103721_provisioning.sql
- supabase/migrations/20261106111453_enable_pg_net.sql
- supabase/migrations/20261106111739_bootstrap_secrets.sql
- supabase/migrations/20261106111758_grant_service_role.sql
- supabase/migrations/20261106113457_phase2_orders_finance.sql
- supabase/migrations/20261106120543_phase3_warehouse_customs.sql
- supabase/tests/01_phase1_security.sql
- supabase/tests/02_provisioning.sql
- supabase/tests/03_phase2_finance.sql
- supabase/tests/04_phase3_warehouse_customs.sql
- web/eslint.config.mjs
- web/next.config.ts
- web/next-env.d.ts
- web/package.json
- web/package-lock.json
- web/postcss.config.mjs
- web/public/file.svg
- web/public/globe.svg
- web/public/next.svg
- web/public/vercel.svg
- web/public/window.svg
- web/src/app/(app)/bieu-phi/page.tsx
- web/src/app/(app)/cai-dat/page.tsx
- web/src/app/(app)/cong-no/page.tsx
- web/src/app/(app)/cong-ty/page.tsx
- web/src/app/(app)/don-hang/chi-tiet/page.tsx
- web/src/app/(app)/don-hang/moi/page.tsx
- web/src/app/(app)/don-hang/page.tsx
- web/src/app/(app)/ho-so/page.tsx
- web/src/app/(app)/khach-hang/chi-tiet/page.tsx
- web/src/app/(app)/khach-hang/moi/page.tsx
- web/src/app/(app)/khach-hang/page.tsx
- web/src/app/(app)/khai-bao/page.tsx
- web/src/app/(app)/layout.tsx
- web/src/app/(app)/list-boc/chi-tiet/page.tsx
- web/src/app/(app)/list-boc/page.tsx
- web/src/app/(app)/list-xe/chi-tiet/page.tsx
- web/src/app/(app)/list-xe/page.tsx
- web/src/app/(app)/nhan-vien/page.tsx
- web/src/app/(app)/nhat-ky/page.tsx
- web/src/app/(app)/page.tsx
- web/src/app/(app)/phan-quyen/page.tsx
- web/src/app/(app)/tai-khoan/page.tsx
- web/src/app/(app)/tien-vao/page.tsx
- web/src/app/auth/confirm/page.tsx
- web/src/app/dat-mat-khau/page.tsx
- web/src/app/layout.tsx
- web/src/app/login/page.tsx
- web/src/app/providers.tsx
- web/src/components/accounts-panel.tsx
- web/src/components/app-shell.tsx
- web/src/components/auth-frame.tsx
- web/src/components/customer-form.tsx
- web/src/components/nav.ts
- web/src/components/order-fields.tsx
- web/src/components/order-items.tsx
- web/src/components/order-packages.tsx
- web/src/components/ui/form.tsx
- web/src/components/ui/index.tsx
- web/src/lib/csv.ts
- web/src/lib/data.ts
- web/src/lib/env.ts
- web/src/lib/errors.ts
- web/src/lib/format.ts
- web/src/lib/orders.ts
- web/src/lib/session.tsx
- web/src/lib/status.ts
- web/src/lib/supabase.ts
- web/src/lib/user-admin.ts
- web/tsconfig.json
- 02_provisioning.sql
- 04_phase3_warehouse_customs.sql
- scripts
- user-admin/index.ts
- run_tests.sh
- app.tg_orders_customer_guard
- 20261106111739_bootstrap_secrets.sql
- next.config.ts
- postcss.config.mjs

## God Nodes (most connected - your core abstractions)
1. `Communities (111 total, 13 thin omitted)` - 99 edges
2. `useSession()` - 68 edges
3. `q()` - 64 edges
4. `Card()` - 63 edges
5. `Skeleton()` - 60 edges
6. `Empty()` - 57 edges
7. `PageHeader()` - 55 edges
8. `Badge()` - 53 edges
9. `viError()` - 45 edges
10. `Form()` - 42 edges

## Surprising Connections (you probably didn't know these)
- `Suggested Questions` --references--> `useSession()`  [INFERRED]
  docs/graph/GRAPH_REPORT.md → web/src/lib/session.tsx
- `God Nodes (most connected - your core abstractions)` --references--> `Form()`  [INFERRED]
  docs/graph/GRAPH_REPORT.md → web/src/components/ui/form.tsx
- `Surprising Connections (you probably didn't know these)` --references--> `Form()`  [INFERRED]
  docs/graph/GRAPH_REPORT.md → web/src/components/ui/form.tsx
- `God Nodes (most connected - your core abstractions)` --references--> `PageHeader()`  [INFERRED]
  docs/graph/GRAPH_REPORT.md → web/src/components/ui/index.tsx
- `Surprising Connections (you probably didn't know these)` --references--> `PageHeader()`  [INFERRED]
  docs/graph/GRAPH_REPORT.md → web/src/components/ui/index.tsx

## Import Cycles
- None detected.

## Communities (127 total, 14 thin omitted)

### Community 0 - "useSession"
Cohesion: 0.07
Nodes (142): God Nodes (most connected - your core abstractions), Surprising Connections (you probably didn't know these), next, react, @tanstack/react-query, FeesPage(), FT, METHOD (+134 more)

### Community 1 - "Communities (111 total, 13 thin omitted)"
Cohesion: 0.02
Nodes (99): Communities (111 total, 13 thin omitted), Community 0 - "useSession", Community 10 - "login/page.tsx", Community 11 - "audit.logs", Community 12 - "app-shell.tsx", Community 13 - "app/layout.tsx", Community 14 - "dependencies", Community 15 - "public.lock_trip" (+91 more)

### Community 2 - "20261106120543_phase3_warehouse_customs.sql"
Cohesion: 0.05
Nodes (59): public.orders, app.tg_order_items_defaults(), app.tg_package_event(), app.tg_packages_defaults(), app.tg_packages_rollup(), app.tg_picking_item_guard(), app.tg_picking_package_guard(), app.tg_snapshot_immutable() (+51 more)

### Community 3 - "pages.yml"
Cohesion: 0.05
Nodes (40): defaults, env, runs-on, steps, concurrency, cancel-in-progress, group, run (+32 more)

### Community 4 - "20261106113457_phase2_orders_finance.sql"
Cohesion: 0.09
Nodes (23): app.pick_rule(), app.tg_allocation_guard(), app.tg_order_status_history(), fee_rules_immutable, order_costs_append_only, orders_customer_guard, orders_status_history, public.bank_receipts (+15 more)

### Community 5 - "20261106065013_core_tables.sql"
Cohesion: 0.19
Nodes (20): app_settings_immutable, app_settings_one_open_per_key, app.tg_app_settings_immutable(), app.tg_customer_user_is_customer(), attachments_customer_idx, attachments_ref_idx, customer_contacts_customer_idx, customer_entities_customer_idx (+12 more)

### Community 6 - "package.json"
Cohesion: 0.13
Nodes (20): eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/node, @types/react, @types/react-dom, typescript (+12 more)

### Community 7 - "public.profiles"
Cohesion: 0.20
Nodes (17): auth.users, app.tg_user_role_type_match(), public.permissions, public.profiles, public.role_permissions, public.roles, public.user_roles, user_roles_role_idx (+9 more)

### Community 8 - "steps"
Cohesion: 0.11
Nodes (19): GITHUB_TOKEN, jobs, pgtap, secrets-scan, name, on, pull_request, push (+11 more)

### Community 9 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 10 - "steps"
Cohesion: 0.12
Nodes (15): runs-on, steps, DB_URL, PASS, RCLONE_CONF_B64, jobs, backup, name (+7 more)

### Community 11 - "public.customer_users"
Cohesion: 0.15
Nodes (8): customer_users_customer_idx, public.customer_users, app.current_customer_id(), app.current_entity_id(), app.is_active_user(), app.is_staff(), app.staff_can_see_customer(), public.set_setting()

### Community 12 - "login/page.tsx"
Cohesion: 0.24
Nodes (10): Confirm(), ConfirmPage(), SetPasswordPage(), LoginForm(), LoginPage(), NOTICES, AuthFrame(), Mark() (+2 more)

### Community 13 - "audit.logs"
Cohesion: 0.24
Nodes (9): audit.logs, audit_logs_actor_idx, audit_logs_at_idx, audit_logs_table_row_idx, audit.tg_log_change(), logs_no_truncate, logs_no_update, public.audit_log_view (+1 more)

### Community 14 - "ids"
Cohesion: 0.15
Nodes (3): t.affected(), t.affected(), t.affected()

### Community 15 - "app-shell.tsx"
Cohesion: 0.26
Nodes (9): AppLayout(), AppShell(), Icon(), ShellSkeleton(), NAV, NavItem, AuthGate(), Ctx (+1 more)

### Community 16 - "app/layout.tsx"
Cohesion: 0.20
Nodes (9): @fontsource/be-vietnam-pro, @fontsource/jetbrains-mono, @fontsource/be-vietnam-pro@^5.1.0, @fontsource/jetbrains-mono@^5.1.1, CSP, metadata, RootLayout(), viewport (+1 more)

### Community 17 - "dependencies"
Cohesion: 0.17
Nodes (12): react-dom, @supabase/ssr, @supabase/supabase-js, zod, dependencies, next@15.5.29, react@19.1.0, react-dom@19.1.0 (+4 more)

### Community 18 - "NAMCHI – Hệ thống hóa quy trình, luồng dữ liệu và chỗ cần sửa"
Cohesion: 0.22
Nodes (8): 1. Kiến trúc, 2. Ai thấy gì (RLS), 3. Luồng đơn hàng (Giai đoạn 2 – đang chạy), 4. Luồng tiền, 5. Sửa ở đâu khi cần, 6. Kho, hải quan, hóa đơn, khiếu nại (Giai đoạn 3–5 – đã có), 7. Việc tiếp theo, NAMCHI – Hệ thống hóa quy trình, luồng dữ liệu và chỗ cần sửa

### Community 19 - "NAMCHI ERP – CRM & Import Management (Nam Trung × Lanchi)"
Cohesion: 0.22
Nodes (8): Chạy test trên máy, Chạy ứng dụng web, Cấu trúc, Gói Supabase Free – điều kiện bắt buộc, NAMCHI ERP – CRM & Import Management (Nam Trung × Lanchi), Quy tắc bảo mật, Trạng thái, Đưa lên Supabase

### Community 20 - "eslint.config.mjs"
Cohesion: 0.22
Nodes (6): @eslint/eslintrc, compat, __dirname, eslintConfig, __filename, @eslint/eslintrc@^3

### Community 21 - "user-admin.ts"
Cohesion: 0.36
Nodes (7): BASE_PATH, SUPABASE_ANON_KEY, SUPABASE_URL, call(), inviteUser(), resetLink(), Result

### Community 22 - "Graph Report - namchi-erp  (2026-11-06)"
Cohesion: 0.25
Nodes (7): Community Hubs (Navigation), Corpus Check, Graph Report - namchi-erp  (2026-11-06), Import Cycles, Knowledge Gaps, Suggested Questions, Summary

### Community 23 - "manifest.json"
Cohesion: 0.33
Nodes (5): docs/graph/graph.json, ast_hash, mtime, seen, semantic_hash

### Community 24 - "docs/FLOWS.md"
Cohesion: 0.40
Nodes (5): docs/FLOWS.md, ast_hash, mtime, seen, semantic_hash

### Community 25 - "docs/graph/graph.html"
Cohesion: 0.40
Nodes (5): docs/graph/graph.html, ast_hash, mtime, seen, semantic_hash

### Community 26 - "docs/graph/GRAPH_REPORT.md"
Cohesion: 0.40
Nodes (5): docs/graph/GRAPH_REPORT.md, ast_hash, mtime, seen, semantic_hash

### Community 27 - "docs/graph/manifest.json"
Cohesion: 0.40
Nodes (4): ast_hash, mtime, seen, semantic_hash

### Community 28 - ".github/workflows/db-backup.yml"
Cohesion: 0.40
Nodes (5): .github/workflows/db-backup.yml, ast_hash, mtime, seen, semantic_hash

### Community 29 - ".github/workflows/db-tests.yml"
Cohesion: 0.40
Nodes (5): .github/workflows/db-tests.yml, ast_hash, mtime, seen, semantic_hash

### Community 30 - ".github/workflows/pages.yml"
Cohesion: 0.40
Nodes (5): .github/workflows/pages.yml, ast_hash, mtime, seen, semantic_hash

### Community 31 - "README.md"
Cohesion: 0.40
Nodes (5): README.md, ast_hash, mtime, seen, semantic_hash

### Community 32 - "scripts/local/run_tests.sh"
Cohesion: 0.40
Nodes (5): scripts/local/run_tests.sh, ast_hash, mtime, seen, semantic_hash

### Community 33 - "scripts/local/supabase_stub.sql"
Cohesion: 0.40
Nodes (5): scripts/local/supabase_stub.sql, ast_hash, mtime, seen, semantic_hash

### Community 34 - "supabase/functions/bootstrap-admin/index.ts"
Cohesion: 0.40
Nodes (5): supabase/functions/bootstrap-admin/index.ts, ast_hash, mtime, seen, semantic_hash

### Community 35 - "supabase/functions/user-admin/index.ts"
Cohesion: 0.40
Nodes (5): supabase/functions/user-admin/index.ts, ast_hash, mtime, seen, semantic_hash

### Community 36 - "supabase/migrations/20261106064938_foundation.sql"
Cohesion: 0.40
Nodes (5): supabase/migrations/20261106064938_foundation.sql, ast_hash, mtime, seen, semantic_hash

### Community 37 - "supabase/migrations/20261106065013_core_tables.sql"
Cohesion: 0.40
Nodes (5): supabase/migrations/20261106065013_core_tables.sql, ast_hash, mtime, seen, semantic_hash

### Community 38 - "supabase/migrations/20261106065027_audit.sql"
Cohesion: 0.40
Nodes (5): supabase/migrations/20261106065027_audit.sql, ast_hash, mtime, seen, semantic_hash

### Community 39 - "supabase/migrations/20261106065104_security_rls.sql"
Cohesion: 0.40
Nodes (5): supabase/migrations/20261106065104_security_rls.sql, ast_hash, mtime, seen, semantic_hash

### Community 40 - "supabase/migrations/20261106065121_seed_reference.sql"
Cohesion: 0.40
Nodes (5): supabase/migrations/20261106065121_seed_reference.sql, ast_hash, mtime, seen, semantic_hash

### Community 41 - "supabase/migrations/20261106081807_advisor_fixes.sql"
Cohesion: 0.40
Nodes (5): supabase/migrations/20261106081807_advisor_fixes.sql, ast_hash, mtime, seen, semantic_hash

### Community 42 - "supabase/migrations/20261106103721_provisioning.sql"
Cohesion: 0.40
Nodes (5): supabase/migrations/20261106103721_provisioning.sql, ast_hash, mtime, seen, semantic_hash

### Community 43 - "supabase/migrations/20261106111453_enable_pg_net.sql"
Cohesion: 0.40
Nodes (5): supabase/migrations/20261106111453_enable_pg_net.sql, ast_hash, mtime, seen, semantic_hash

### Community 44 - "supabase/migrations/20261106111739_bootstrap_secrets.sql"
Cohesion: 0.40
Nodes (5): supabase/migrations/20261106111739_bootstrap_secrets.sql, ast_hash, mtime, seen, semantic_hash

### Community 45 - "supabase/migrations/20261106111758_grant_service_role.sql"
Cohesion: 0.40
Nodes (5): supabase/migrations/20261106111758_grant_service_role.sql, ast_hash, mtime, seen, semantic_hash

### Community 46 - "supabase/migrations/20261106113457_phase2_orders_finance.sql"
Cohesion: 0.40
Nodes (5): supabase/migrations/20261106113457_phase2_orders_finance.sql, ast_hash, mtime, seen, semantic_hash

### Community 47 - "supabase/migrations/20261106120543_phase3_warehouse_customs.sql"
Cohesion: 0.40
Nodes (5): supabase/migrations/20261106120543_phase3_warehouse_customs.sql, ast_hash, mtime, seen, semantic_hash

### Community 48 - "supabase/tests/01_phase1_security.sql"
Cohesion: 0.40
Nodes (5): supabase/tests/01_phase1_security.sql, ast_hash, mtime, seen, semantic_hash

### Community 49 - "supabase/tests/02_provisioning.sql"
Cohesion: 0.40
Nodes (5): supabase/tests/02_provisioning.sql, ast_hash, mtime, seen, semantic_hash

### Community 50 - "supabase/tests/03_phase2_finance.sql"
Cohesion: 0.40
Nodes (5): supabase/tests/03_phase2_finance.sql, ast_hash, mtime, seen, semantic_hash

### Community 51 - "supabase/tests/04_phase3_warehouse_customs.sql"
Cohesion: 0.40
Nodes (5): supabase/tests/04_phase3_warehouse_customs.sql, ast_hash, mtime, seen, semantic_hash

### Community 52 - "web/eslint.config.mjs"
Cohesion: 0.40
Nodes (5): web/eslint.config.mjs, ast_hash, mtime, seen, semantic_hash

### Community 53 - "web/next.config.ts"
Cohesion: 0.40
Nodes (5): web/next.config.ts, ast_hash, mtime, seen, semantic_hash

### Community 54 - "web/next-env.d.ts"
Cohesion: 0.40
Nodes (5): web/next-env.d.ts, ast_hash, mtime, seen, semantic_hash

### Community 55 - "web/package.json"
Cohesion: 0.40
Nodes (5): web/package.json, ast_hash, mtime, seen, semantic_hash

### Community 56 - "web/package-lock.json"
Cohesion: 0.40
Nodes (5): web/package-lock.json, ast_hash, mtime, seen, semantic_hash

### Community 57 - "web/postcss.config.mjs"
Cohesion: 0.40
Nodes (5): web/postcss.config.mjs, ast_hash, mtime, seen, semantic_hash

### Community 58 - "web/public/file.svg"
Cohesion: 0.40
Nodes (5): web/public/file.svg, ast_hash, mtime, seen, semantic_hash

### Community 59 - "web/public/globe.svg"
Cohesion: 0.40
Nodes (5): web/public/globe.svg, ast_hash, mtime, seen, semantic_hash

### Community 60 - "web/public/next.svg"
Cohesion: 0.40
Nodes (5): web/public/next.svg, ast_hash, mtime, seen, semantic_hash

### Community 61 - "web/public/vercel.svg"
Cohesion: 0.40
Nodes (5): web/public/vercel.svg, ast_hash, mtime, seen, semantic_hash

### Community 62 - "web/public/window.svg"
Cohesion: 0.40
Nodes (5): web/public/window.svg, ast_hash, mtime, seen, semantic_hash

### Community 63 - "web/src/app/(app)/bieu-phi/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/(app)/bieu-phi/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 64 - "web/src/app/(app)/cai-dat/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/(app)/cai-dat/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 65 - "web/src/app/(app)/cong-no/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/(app)/cong-no/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 66 - "web/src/app/(app)/cong-ty/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/(app)/cong-ty/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 67 - "web/src/app/(app)/don-hang/chi-tiet/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/(app)/don-hang/chi-tiet/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 68 - "web/src/app/(app)/don-hang/moi/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/(app)/don-hang/moi/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 69 - "web/src/app/(app)/don-hang/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/(app)/don-hang/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 70 - "web/src/app/(app)/ho-so/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/(app)/ho-so/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 71 - "web/src/app/(app)/khach-hang/chi-tiet/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/(app)/khach-hang/chi-tiet/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 72 - "web/src/app/(app)/khach-hang/moi/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/(app)/khach-hang/moi/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 73 - "web/src/app/(app)/khach-hang/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/(app)/khach-hang/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 74 - "web/src/app/(app)/khai-bao/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/(app)/khai-bao/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 75 - "web/src/app/(app)/layout.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/(app)/layout.tsx, ast_hash, mtime, seen, semantic_hash

### Community 76 - "web/src/app/(app)/list-boc/chi-tiet/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/(app)/list-boc/chi-tiet/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 77 - "web/src/app/(app)/list-boc/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/(app)/list-boc/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 78 - "web/src/app/(app)/list-xe/chi-tiet/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/(app)/list-xe/chi-tiet/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 79 - "web/src/app/(app)/list-xe/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/(app)/list-xe/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 80 - "web/src/app/(app)/nhan-vien/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/(app)/nhan-vien/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 81 - "web/src/app/(app)/nhat-ky/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/(app)/nhat-ky/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 82 - "web/src/app/(app)/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/(app)/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 83 - "web/src/app/(app)/phan-quyen/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/(app)/phan-quyen/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 84 - "web/src/app/(app)/tai-khoan/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/(app)/tai-khoan/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 85 - "web/src/app/(app)/tien-vao/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/(app)/tien-vao/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 86 - "web/src/app/auth/confirm/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/auth/confirm/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 87 - "web/src/app/dat-mat-khau/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/dat-mat-khau/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 88 - "web/src/app/layout.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/layout.tsx, ast_hash, mtime, seen, semantic_hash

### Community 89 - "web/src/app/login/page.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/login/page.tsx, ast_hash, mtime, seen, semantic_hash

### Community 90 - "web/src/app/providers.tsx"
Cohesion: 0.40
Nodes (5): web/src/app/providers.tsx, ast_hash, mtime, seen, semantic_hash

### Community 91 - "web/src/components/accounts-panel.tsx"
Cohesion: 0.40
Nodes (5): web/src/components/accounts-panel.tsx, ast_hash, mtime, seen, semantic_hash

### Community 92 - "web/src/components/app-shell.tsx"
Cohesion: 0.40
Nodes (5): web/src/components/app-shell.tsx, ast_hash, mtime, seen, semantic_hash

### Community 93 - "web/src/components/auth-frame.tsx"
Cohesion: 0.40
Nodes (5): web/src/components/auth-frame.tsx, ast_hash, mtime, seen, semantic_hash

### Community 94 - "web/src/components/customer-form.tsx"
Cohesion: 0.40
Nodes (5): web/src/components/customer-form.tsx, ast_hash, mtime, seen, semantic_hash

### Community 95 - "web/src/components/nav.ts"
Cohesion: 0.40
Nodes (5): web/src/components/nav.ts, ast_hash, mtime, seen, semantic_hash

### Community 96 - "web/src/components/order-fields.tsx"
Cohesion: 0.40
Nodes (5): web/src/components/order-fields.tsx, ast_hash, mtime, seen, semantic_hash

### Community 97 - "web/src/components/order-items.tsx"
Cohesion: 0.40
Nodes (5): web/src/components/order-items.tsx, ast_hash, mtime, seen, semantic_hash

### Community 98 - "web/src/components/order-packages.tsx"
Cohesion: 0.40
Nodes (5): web/src/components/order-packages.tsx, ast_hash, mtime, seen, semantic_hash

### Community 99 - "web/src/components/ui/form.tsx"
Cohesion: 0.40
Nodes (5): web/src/components/ui/form.tsx, ast_hash, mtime, seen, semantic_hash

### Community 100 - "web/src/components/ui/index.tsx"
Cohesion: 0.40
Nodes (5): web/src/components/ui/index.tsx, ast_hash, mtime, seen, semantic_hash

### Community 101 - "web/src/lib/csv.ts"
Cohesion: 0.40
Nodes (5): web/src/lib/csv.ts, ast_hash, mtime, seen, semantic_hash

### Community 102 - "web/src/lib/data.ts"
Cohesion: 0.40
Nodes (5): web/src/lib/data.ts, ast_hash, mtime, seen, semantic_hash

### Community 103 - "web/src/lib/env.ts"
Cohesion: 0.40
Nodes (5): web/src/lib/env.ts, ast_hash, mtime, seen, semantic_hash

### Community 104 - "web/src/lib/errors.ts"
Cohesion: 0.40
Nodes (5): web/src/lib/errors.ts, ast_hash, mtime, seen, semantic_hash

### Community 105 - "web/src/lib/format.ts"
Cohesion: 0.40
Nodes (5): web/src/lib/format.ts, ast_hash, mtime, seen, semantic_hash

### Community 106 - "web/src/lib/orders.ts"
Cohesion: 0.40
Nodes (5): web/src/lib/orders.ts, ast_hash, mtime, seen, semantic_hash

### Community 107 - "web/src/lib/session.tsx"
Cohesion: 0.40
Nodes (5): web/src/lib/session.tsx, ast_hash, mtime, seen, semantic_hash

### Community 108 - "web/src/lib/status.ts"
Cohesion: 0.40
Nodes (5): web/src/lib/status.ts, ast_hash, mtime, seen, semantic_hash

### Community 109 - "web/src/lib/supabase.ts"
Cohesion: 0.40
Nodes (5): web/src/lib/supabase.ts, ast_hash, mtime, seen, semantic_hash

### Community 110 - "web/src/lib/user-admin.ts"
Cohesion: 0.40
Nodes (5): web/src/lib/user-admin.ts, ast_hash, mtime, seen, semantic_hash

### Community 111 - "web/tsconfig.json"
Cohesion: 0.40
Nodes (5): web/tsconfig.json, ast_hash, mtime, seen, semantic_hash

### Community 114 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, build, dev, lint, start

## Knowledge Gaps
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Communities (111 total, 13 thin omitted)` connect `Communities (111 total, 13 thin omitted)` to `Graph Report - namchi-erp  (2026-11-06)`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `useSession()` (e.g. with `God Nodes (most connected - your core abstractions)` and `Suggested Questions`) actually correct?**
  _`useSession()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Should `useSession` be split into smaller, more focused modules?**
  _Cohesion score 0.07440630211028693 - nodes in this community are weakly interconnected._
- **Why does `Graph Report - namchi-erp  (2026-11-06)` connect `Graph Report - namchi-erp  (2026-11-06)` to `useSession`, `Communities (111 total, 13 thin omitted)`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `Card()` (e.g. with `God Nodes (most connected - your core abstractions)` and `Surprising Connections (you probably didn't know these)`) actually correct?**
  _`Card()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Should `Communities (111 total, 13 thin omitted)` be split into smaller, more focused modules?**
  _Cohesion score 0.020202020202020204 - nodes in this community are weakly interconnected._
- **Why does `God Nodes (most connected - your core abstractions)` connect `useSession` to `Graph Report - namchi-erp  (2026-11-06)`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._