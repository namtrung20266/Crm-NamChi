# Graph Report - namchi-erp  (2026-11-06)

## Corpus Check
- 68 files · ~30,950 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 3 file(s) not represented in the graph (top: .example 1, (none) 1, .css 1)

## Summary
- 465 nodes · 1289 edges · 27 communities (17 shown, 10 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- useSession
- 20261106065013_core_tables.sql
- pages.yml
- 20261106113457_phase2_orders_finance.sql
- supabase.ts
- package.json
- steps
- compilerOptions
- don-hang/chi-tiet/page.tsx
- steps
- session.tsx
- audit.logs
- app/layout.tsx
- dependencies
- NAMCHI ERP – CRM & Import Management (Nam Trung × Lanchi)
- eslint.config.mjs
- scripts
- user-admin/index.ts
- run_tests.sh
- 20261106111739_bootstrap_secrets.sql
- postcss.config.mjs

## God Nodes (most connected - your core abstractions)
1. `useSession()` - 39 edges
2. `q()` - 37 edges
3. `Card()` - 35 edges
4. `PageHeader()` - 33 edges
5. `Empty()` - 33 edges
6. `Skeleton()` - 31 edges
7. `Badge()` - 27 edges
8. `Form()` - 25 edges
9. `Field()` - 24 edges
10. `supabase` - 24 edges

## Surprising Connections (you probably didn't know these)
- `public.profiles` --references--> `auth.users`  [EXTRACTED]
  supabase/migrations/20261106065013_core_tables.sql → scripts/local/supabase_stub.sql
- `public.provision_user()` --reads_from--> `auth.users`  [EXTRACTED]
  supabase/migrations/20261106103721_provisioning.sql → scripts/local/supabase_stub.sql
- `t.id()` --writes_to--> `auth.users`  [EXTRACTED]
  supabase/tests/01_phase1_security.sql → scripts/local/supabase_stub.sql
- `t.id()` --writes_to--> `auth.users`  [EXTRACTED]
  supabase/tests/03_phase2_finance.sql → scripts/local/supabase_stub.sql
- `app.is_active_user()` --reads_from--> `public.profiles`  [EXTRACTED]
  supabase/migrations/20261106065104_security_rls.sql → supabase/migrations/20261106065013_core_tables.sql

## Import Cycles
- None detected.

## Communities (27 total, 10 thin omitted)

### Community 0 - "useSession"
Cohesion: 0.12
Nodes (77): react, @tanstack/react-query, FeesPage(), FT, METHOD, Rule, LABEL, ROLE (+69 more)

### Community 1 - "20261106065013_core_tables.sql"
Cohesion: 0.06
Nodes (50): auth.users, app_settings_immutable, app_settings_one_open_per_key, app.tg_app_settings_immutable(), app.tg_customer_user_is_customer(), app.tg_user_role_type_match(), attachments_customer_idx, attachments_ref_idx (+42 more)

### Community 2 - "pages.yml"
Cohesion: 0.05
Nodes (39): defaults, env, runs-on, steps, concurrency, cancel-in-progress, group, run (+31 more)

### Community 3 - "20261106113457_phase2_orders_finance.sql"
Cohesion: 0.08
Nodes (24): app.pick_rule(), app.tg_allocation_guard(), app.tg_order_status_history(), app.tg_orders_customer_guard(), fee_rules_immutable, order_costs_append_only, orders_customer_guard, orders_status_history (+16 more)

### Community 4 - "supabase.ts"
Cohesion: 0.15
Nodes (16): next, nextConfig, Confirm(), ConfirmPage(), SetPasswordPage(), LoginForm(), LoginPage(), NOTICES (+8 more)

### Community 5 - "package.json"
Cohesion: 0.13
Nodes (20): eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/node, @types/react, @types/react-dom, typescript (+12 more)

### Community 6 - "steps"
Cohesion: 0.11
Nodes (19): GITHUB_TOKEN, jobs, pgtap, secrets-scan, name, on, pull_request, push (+11 more)

### Community 7 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 8 - "don-hang/chi-tiet/page.tsx"
Cohesion: 0.20
Nodes (14): Line, Stmt, GOODS_GROUPS, num(), opt(), readOrder(), btn, Fin (+6 more)

### Community 9 - "steps"
Cohesion: 0.12
Nodes (15): runs-on, steps, DB_URL, PASS, RCLONE_CONF_B64, jobs, backup, name (+7 more)

### Community 10 - "session.tsx"
Cohesion: 0.26
Nodes (10): AppLayout(), AppShell(), Icon(), ShellSkeleton(), NAV, NavItem, AuthGate(), Ctx (+2 more)

### Community 11 - "audit.logs"
Cohesion: 0.24
Nodes (9): audit.logs, audit_logs_actor_idx, audit_logs_at_idx, audit_logs_table_row_idx, audit.tg_log_change(), logs_no_truncate, logs_no_update, public.audit_log_view (+1 more)

### Community 12 - "app/layout.tsx"
Cohesion: 0.20
Nodes (9): @fontsource/be-vietnam-pro, @fontsource/jetbrains-mono, @fontsource/be-vietnam-pro@^5.1.0, @fontsource/jetbrains-mono@^5.1.1, CSP, metadata, RootLayout(), viewport (+1 more)

### Community 13 - "dependencies"
Cohesion: 0.17
Nodes (12): react-dom, @supabase/ssr, @supabase/supabase-js, zod, dependencies, next@15.5.29, react@19.1.0, react-dom@19.1.0 (+4 more)

### Community 14 - "NAMCHI ERP – CRM & Import Management (Nam Trung × Lanchi)"
Cohesion: 0.22
Nodes (8): Chạy test trên máy, Chạy ứng dụng web, Cấu trúc, Gói Supabase Free – điều kiện bắt buộc, NAMCHI ERP – CRM & Import Management (Nam Trung × Lanchi), Quy tắc bảo mật, Trạng thái, Đưa lên Supabase

### Community 15 - "eslint.config.mjs"
Cohesion: 0.22
Nodes (6): @eslint/eslintrc, compat, __dirname, eslintConfig, __filename, @eslint/eslintrc@^3

### Community 16 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, build, dev, lint, start

## Knowledge Gaps
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `supabase.ts` to `useSession`, `package.json`, `don-hang/chi-tiet/page.tsx`, `session.tsx`, `app/layout.tsx`, `dependencies`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Should `useSession` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._
- **Why does `@tanstack/react-query` connect `useSession` to `package.json`, `don-hang/chi-tiet/page.tsx`, `session.tsx`, `app/layout.tsx`, `dependencies`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Should `20261106065013_core_tables.sql` be split into smaller, more focused modules?**
  _Cohesion score 0.06398390342052314 - nodes in this community are weakly interconnected._
- **Why does `react` connect `useSession` to `supabase.ts`, `package.json`, `don-hang/chi-tiet/page.tsx`, `session.tsx`, `app/layout.tsx`, `dependencies`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Should `pages.yml` be split into smaller, more focused modules?**
  _Cohesion score 0.05128205128205128 - nodes in this community are weakly interconnected._
- **Should `20261106113457_phase2_orders_finance.sql` be split into smaller, more focused modules?**
  _Cohesion score 0.07827260458839407 - nodes in this community are weakly interconnected._