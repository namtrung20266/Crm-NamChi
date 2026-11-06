-- =====================================================================
-- NAMCHI ERP – Trang quản trị: giá vốn từng mục, lợi nhuận đơn, dashboard (07/11/2026)
--   Mô hình khách: customers = tập đoàn (VD Lanchi, tài khoản tổng xem tất cả);
--   customer_entities = công ty con vận hành độc lập (mỗi công ty 1 ví, 1 bộ đơn, 1 bộ HĐ).
-- =====================================================================

insert into public.permissions (code, module, description) values
  ('finance.cost.write', 'finance', 'Đặt giá vốn: mức giá vốn biểu phí và giá vốn thực tế từng khoản trên đơn')
on conflict (code) do nothing;
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.code in ('admin', 'accountant') and p.code = 'finance.cost.write'
on conflict do nothing;
-- Admin/kế toán quản lý biểu phí: đảm bảo có quyền
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p where r.code = 'admin' and p.code = 'fee.manage'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 1. Đặt giá vốn cho một mức phí: tạo phiên bản mới (giữ giá bán), đóng bản cũ
-- ---------------------------------------------------------------------
create or replace function public.set_fee_cost(p_rule_id uuid, p_cost_rate numeric, p_valid_from timestamptz default now(), p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.fee_rules; v_id uuid; v_from timestamptz := coalesce(p_valid_from, now());
begin
  if not (app.has_perm('fee.manage') and app.has_perm('finance.cost.write')) then
    raise exception 'Không có quyền đặt giá vốn biểu phí' using errcode = '42501';
  end if;
  select * into r from public.fee_rules where id = p_rule_id for update;
  if not found or r.valid_to is not null then raise exception 'Mức phí đã hết hiệu lực, chọn mức đang áp dụng' using errcode = '22023'; end if;
  if p_cost_rate is null or p_cost_rate < 0 then raise exception 'Giá vốn không hợp lệ' using errcode = '22023'; end if;
  if v_from <= r.valid_from then v_from := greatest(now(), r.valid_from + interval '1 second'); end if;
  update public.fee_rules set valid_to = v_from where id = r.id;
  insert into public.fee_rules (fee_type_id, customer_id, china_invoice_type, goods_group, sell_rate, cost_rate, valid_from, note)
  values (r.fee_type_id, r.customer_id, r.china_invoice_type, r.goods_group, r.sell_rate, p_cost_rate, v_from,
          coalesce(nullif(trim(p_note), ''), 'Đặt giá vốn ' || p_cost_rate))
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 2. Giá vốn thực tế theo từng khoản trên đơn (ghi đè giá vốn tính tự động)
--    Ghi thêm, không sửa; bản mới nhất của mỗi khoản có hiệu lực.
-- ---------------------------------------------------------------------
create table public.order_cost_entries (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders(id),
  cost_key    text not null check (cost_key ~ '^[a-zA-Z0-9_:.\- À-ỹ]{2,120}$'),  -- goods | china_tax | <mã phí> | manual:<nhãn>
  label       text not null,
  amount_vnd  bigint not null check (amount_vnd >= 0),
  note        text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index order_cost_entries_idx on public.order_cost_entries(order_id, cost_key, created_at desc);
create trigger order_cost_entries_append_only before update or delete on public.order_cost_entries
  for each row execute function app.tg_append_only();
create trigger order_cost_entries_audit after insert on public.order_cost_entries
  for each row execute function audit.tg_log_change();

-- Lợi nhuận chi tiết theo khoản: doanh thu (phiếu hiện hành) – giá vốn
--   ưu tiên: giá vốn nhập tay mới nhất > tiền hàng theo thanh toán NCC thực tế (tỷ giá thật) > giá vốn theo biểu phí
create or replace function app.order_profit_calc(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o public.orders; st public.order_statements; v_lines jsonb; v_rev bigint; v_cost bigint; v_missing integer; v_sp_cny numeric; v_sp_vnd bigint;
begin
  select * into o from public.orders where id = p_order_id;
  select * into st from public.order_statements where order_id = p_order_id and status <> 'superseded' order by version desc limit 1;
  if st.id is null then
    return jsonb_build_object('has_statement', false, 'lines', '[]'::jsonb, 'revenue_vnd', 0, 'cost_vnd', 0, 'profit_vnd', 0, 'missing', 0);
  end if;
  select coalesce(sum(amount_cny), 0), coalesce(sum(amount_vnd), 0) into v_sp_cny, v_sp_vnd
    from public.supplier_payments where order_id = p_order_id and deleted_at is null;

  with rev as (
    select case when l.source = 'goods' and l.sort_order = 1 then 'goods'
                when l.source = 'goods' then 'china_tax'
                when l.source = 'rule' then coalesce(ft.code, l.label)
                else 'manual:' || l.label end as k,
           min(case when l.source = 'goods' and l.sort_order = 1 then 'Tiền hàng' else l.label end) as label,
           sum(l.amount_vnd) as revenue, min(l.sort_order) as sort
    from public.order_statement_lines l left join public.fee_types ft on ft.id = l.fee_type_id
    where l.statement_id = st.id group by 1
  ),
  cst as (
    select case when c.source = 'goods' and c.label = 'Tiền hàng' then 'goods'
                when c.source = 'goods' then 'china_tax'
                when c.source = 'rule' then coalesce(ft.code, c.label)
                else 'manual:' || c.label end as k,
           case when count(c.amount_vnd) = count(*) then sum(c.amount_vnd) end as cost_rule
    from public.order_costs c left join public.fee_types ft on ft.id = c.fee_type_id
    where c.statement_id = st.id group by 1
  ),
  ovr as (
    select distinct on (cost_key) cost_key as k, amount_vnd, note, created_at
    from public.order_cost_entries where order_id = p_order_id order by cost_key, created_at desc, id desc
  ),
  keys as (select k from rev union select k from ovr),
  x as (
    select k.k, coalesce(r.label, (select e.label from public.order_cost_entries e where e.order_id = p_order_id and e.cost_key = k.k order by e.id desc limit 1)) label,
           coalesce(r.revenue, 0) revenue, c.cost_rule,
           case when k.k = 'goods' and o.goods_cny > 0 and v_sp_cny >= o.goods_cny then v_sp_vnd end as cost_actual,
           v.amount_vnd as cost_override, v.note as override_note, v.created_at as override_at, coalesce(r.sort, 500) sort
    from keys k left join rev r on r.k = k.k left join cst c on c.k = k.k left join ovr v on v.k = k.k
  )
  select jsonb_agg(jsonb_build_object('key', k, 'label', label, 'revenue_vnd', revenue, 'cost_rule_vnd', cost_rule, 'cost_actual_vnd', cost_actual,
           'cost_override_vnd', cost_override, 'override_note', override_note, 'override_at', override_at,
           'cost_vnd', coalesce(cost_override, cost_actual, cost_rule),
           'source', case when cost_override is not null then 'nhap_tay' when cost_actual is not null then 'thuc_te_ncc' when cost_rule is not null then 'bieu_phi' else 'thieu' end,
           'profit_vnd', revenue - coalesce(cost_override, cost_actual, cost_rule, 0)) order by sort, label),
         coalesce(sum(revenue), 0), coalesce(sum(coalesce(cost_override, cost_actual, cost_rule)), 0),
         count(*) filter (where coalesce(cost_override, cost_actual, cost_rule) is null)
    into v_lines, v_rev, v_cost, v_missing
  from x;

  return jsonb_build_object('has_statement', true, 'statement_kind', st.kind, 'statement_version', st.version,
    'lines', coalesce(v_lines, '[]'::jsonb), 'revenue_vnd', v_rev, 'cost_vnd', v_cost, 'profit_vnd', v_rev - v_cost,
    'margin_pct', case when v_rev > 0 then round((v_rev - v_cost) * 100.0 / v_rev, 2) end,
    'missing', v_missing, 'vat_vnd', st.vat_vnd, 'total_vnd', st.total_vnd,
    'supplier_paid_cny', v_sp_cny, 'supplier_paid_vnd', v_sp_vnd, 'goods_cny', o.goods_cny);
end $$;
revoke all on function app.order_profit_calc(uuid) from public, anon, authenticated;

create or replace function public.order_profit_detail(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o public.orders;
begin
  if not app.has_perm('finance.profit.read') then raise exception 'Không có quyền xem lợi nhuận' using errcode = '42501'; end if;
  select * into o from public.orders where id = p_order_id and deleted_at is null;
  if not found or not app.staff_can_see_customer(o.customer_id) then raise exception 'Không tìm thấy đơn' using errcode = '42501'; end if;
  return app.order_profit_calc(p_order_id);
end $$;

create or replace function public.set_order_cost(p_order_id uuid, p_cost_key text, p_label text, p_amount bigint, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  if not (app.has_perm('finance.cost.write') and app.has_perm('finance.profit.read')) then
    raise exception 'Không có quyền đặt giá vốn' using errcode = '42501';
  end if;
  select * into o from public.orders where id = p_order_id and deleted_at is null;
  if not found or not app.staff_can_see_customer(o.customer_id) then raise exception 'Không tìm thấy đơn' using errcode = '42501'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Giá vốn không hợp lệ' using errcode = '22023'; end if;
  if coalesce(length(trim(p_label)), 0) = 0 or coalesce(length(trim(p_cost_key)), 0) < 2 then raise exception 'Thiếu tên khoản' using errcode = '22023'; end if;
  insert into public.order_cost_entries (order_id, cost_key, label, amount_vnd, note)
  values (o.id, trim(p_cost_key), trim(p_label), p_amount, nullif(trim(p_note), ''));
end $$;

-- order_profit: dùng giá vốn cuối cùng (nhập tay > NCC thực tế > biểu phí)
create or replace view public.order_profit with (security_invoker = true) as
select f.order_id, f.code, f.customer_id, f.entity_id, f.total_vnd,
       (p ->> 'revenue_vnd')::bigint as revenue_ex_vat,
       (p ->> 'cost_vnd')::numeric as cost_vnd,
       (p ->> 'missing')::bigint as missing_cost_lines
from public.order_finance f
cross join lateral (select app.order_profit_calc(f.order_id) p) x
where app.has_perm('finance.profit.read');
grant execute on function app.order_profit_calc(uuid) to authenticated;   -- view gọi; view đã lọc theo quyền

-- ---------------------------------------------------------------------
-- 3. Dashboard quản trị (1 lần gọi). Tiền chỉ trả khi có finance.read; lãi chỉ khi có finance.profit.read
-- ---------------------------------------------------------------------
create or replace function public.admin_dashboard(p_from date default null, p_to date default null,
                                                  p_customer_id uuid default null, p_entity_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_from date := coalesce(p_from, (date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh'))::date);
  v_to date := coalesce(p_to, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_money boolean := app.has_perm('finance.read');
  v_profit boolean := app.has_perm('finance.profit.read');
  r jsonb;
begin
  if not app.is_staff() then raise exception 'Chỉ dành cho nội bộ' using errcode = '42501'; end if;

  create temp table if not exists _dash_o on commit drop as select * from public.orders limit 0;
  truncate _dash_o;
  insert into _dash_o select o.* from public.orders o
   where o.deleted_at is null and app.staff_can_see_customer(o.customer_id)
     and (p_customer_id is null or o.customer_id = p_customer_id) and (p_entity_id is null or o.entity_id = p_entity_id);

  create temp table if not exists _dash_f (order_id uuid, total bigint, paid bigint, credit bigint, deposit bigint, st_status text, st_kind text) on commit drop;
  truncate _dash_f;
  insert into _dash_f
  select o.id, coalesce(s.total_vnd, 0), app.order_paid_vnd(o.id), app.order_credit_vnd(o.id), coalesce(s.deposit_vnd, 0), s.status, s.kind
  from _dash_o o left join lateral (select * from public.order_statements x where x.order_id = o.id and x.status <> 'superseded' order by x.version desc limit 1) s on true;

  select jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'kpi', (select jsonb_build_object(
        'orders_new', count(*) filter (where (o.created_at at time zone 'Asia/Ho_Chi_Minh')::date between v_from and v_to),
        'orders_active', count(*) filter (where o.status not in ('hoan_tat','huy','dang_len_don')),
        'orders_draft', count(*) filter (where o.status = 'dang_len_don'),
        'orders_done_period', count(*) filter (where o.status = 'hoan_tat' and (o.status_changed_at at time zone 'Asia/Ho_Chi_Minh')::date between v_from and v_to),
        'orders_overdue', count(*) filter (where d.sla_days is not null and o.status not in ('hoan_tat','huy') and o.status_changed_at < now() - make_interval(days => d.sla_days)),
        'orders_hold', count(*) filter (where o.status = 'tam_giu'),
        'goods_cny_period', coalesce(sum(o.goods_cny) filter (where (o.created_at at time zone 'Asia/Ho_Chi_Minh')::date between v_from and v_to and o.status <> 'huy'), 0),
        'weight_kg_active', coalesce(sum(o.weight_kg) filter (where o.status not in ('hoan_tat','huy')), 0),
        'packages_active', coalesce(sum(o.packages) filter (where o.status not in ('hoan_tat','huy')), 0))
      from _dash_o o join public.order_status_defs d on d.code = o.status),
    'money', case when v_money then (select jsonb_build_object(
        'revenue_period', coalesce(sum(f.total) filter (where (o.created_at at time zone 'Asia/Ho_Chi_Minh')::date between v_from and v_to and o.status <> 'huy'), 0),
        'collected_total', coalesce(sum(f.paid) filter (where o.status <> 'huy'), 0),
        'receivable', coalesce(sum(greatest(f.total - f.paid - f.credit, 0)) filter (where o.status not in ('huy','dang_len_don')), 0),
        'receivable_delivered', coalesce(sum(greatest(f.total - f.paid - f.credit, 0)) filter (where o.status in ('ve_kho_vn','dang_giao','da_giao')), 0),
        'deposit_waiting', coalesce(sum(greatest(f.deposit - f.paid, 0)) filter (where o.status = 'cho_coc'), 0),
        'overpaid', coalesce(sum(greatest(f.paid + f.credit - f.total, 0)) filter (where f.total > 0), 0),
        'quotes_waiting', count(*) filter (where f.st_status = 'active' and o.status not in ('huy')),
        'wallet_total', (select coalesce(sum(l.amount_vnd), 0) from public.wallet_ledger l where app.staff_can_see_customer(l.customer_id)
                           and (p_customer_id is null or l.customer_id = p_customer_id) and (p_entity_id is null or l.entity_id = p_entity_id)),
        'topups_pending', (select count(*) from public.wallet_topups t where t.status = 'cho_duyet' and t.deleted_at is null and app.staff_can_see_customer(t.customer_id)
                             and (p_customer_id is null or t.customer_id = p_customer_id) and (p_entity_id is null or t.entity_id = p_entity_id)),
        'topups_pending_vnd', (select coalesce(sum(t.amount_vnd), 0) from public.wallet_topups t where t.status = 'cho_duyet' and t.deleted_at is null and app.staff_can_see_customer(t.customer_id)
                             and (p_customer_id is null or t.customer_id = p_customer_id) and (p_entity_id is null or t.entity_id = p_entity_id)),
        'topups_period_vnd', (select coalesce(sum(t.amount_vnd), 0) from public.wallet_topups t where t.status = 'da_duyet' and t.deleted_at is null and app.staff_can_see_customer(t.customer_id)
                             and t.transfer_date between v_from and v_to
                             and (p_customer_id is null or t.customer_id = p_customer_id) and (p_entity_id is null or t.entity_id = p_entity_id)))
      from _dash_o o join _dash_f f on f.order_id = o.id) end,
    'profit', case when v_profit then (select jsonb_build_object(
        'revenue_ex_vat', coalesce(sum((p ->> 'revenue_vnd')::bigint), 0),
        'cost', coalesce(sum((p ->> 'cost_vnd')::bigint), 0),
        'profit', coalesce(sum((p ->> 'profit_vnd')::bigint), 0),
        'orders_missing_cost', count(*) filter (where (p ->> 'missing')::int > 0),
        'orders_counted', count(*) filter (where (p ->> 'has_statement')::boolean))
      from _dash_o o cross join lateral (select app.order_profit_calc(o.id) p) x
      where o.status <> 'huy' and (o.created_at at time zone 'Asia/Ho_Chi_Minh')::date between v_from and v_to) end,
    'by_status', (select coalesce(jsonb_agg(jsonb_build_object('code', d.code, 'label', d.label, 'tone', d.tone, 'phase', d.phase, 'rank', d.rank,
                    'count', coalesce(c.n, 0), 'overdue', coalesce(c.late, 0)) order by d.rank), '[]')
                  from public.order_status_defs d
                  left join (select o.status, count(*) n,
                                    count(*) filter (where d2.sla_days is not null and o.status_changed_at < now() - make_interval(days => d2.sla_days)) late
                             from _dash_o o join public.order_status_defs d2 on d2.code = o.status group by o.status) c on c.status = d.code
                  where d.is_active),
    'by_entity', (select coalesce(jsonb_agg(row_to_json(z)::jsonb order by z.active desc, z.orders desc), '[]') from (
                    select e.id as entity_id, e.code, e.legal_name, cu.code as customer_code,
                           count(o.id) as orders, count(o.id) filter (where o.status not in ('hoan_tat','huy','dang_len_don')) as active,
                           count(o.id) filter (where (o.created_at at time zone 'Asia/Ho_Chi_Minh')::date between v_from and v_to) as new_period,
                           case when v_money then coalesce(sum(f.total) filter (where o.status <> 'huy' and (o.created_at at time zone 'Asia/Ho_Chi_Minh')::date between v_from and v_to), 0) end as revenue_period,
                           case when v_money then coalesce(sum(greatest(f.total - f.paid - f.credit, 0)) filter (where o.status not in ('huy','dang_len_don')), 0) end as receivable,
                           case when v_money then app.wallet_balance(e.customer_id, e.id) end as wallet
                    from public.customer_entities e join public.customers cu on cu.id = e.customer_id
                    left join _dash_o o on o.entity_id = e.id left join _dash_f f on f.order_id = o.id
                    where e.deleted_at is null and app.staff_can_see_customer(e.customer_id)
                      and (p_customer_id is null or e.customer_id = p_customer_id) and (p_entity_id is null or e.id = p_entity_id)
                    group by e.id, e.code, e.legal_name, cu.code, e.customer_id) z),
    'by_cs', (select coalesce(jsonb_agg(row_to_json(z)::jsonb order by z.active desc), '[]') from (
                    select coalesce(p.full_name, 'Chưa phân công') as name, o.cs_owner_id as user_id,
                           count(*) filter (where o.status not in ('hoan_tat','huy','dang_len_don')) as active,
                           count(*) filter (where d.sla_days is not null and o.status not in ('hoan_tat','huy') and o.status_changed_at < now() - make_interval(days => d.sla_days)) as overdue,
                           count(*) filter (where (o.created_at at time zone 'Asia/Ho_Chi_Minh')::date between v_from and v_to) as new_period
                    from _dash_o o join public.order_status_defs d on d.code = o.status left join public.profiles p on p.user_id = o.cs_owner_id
                    group by p.full_name, o.cs_owner_id) z),
    'trend', (select coalesce(jsonb_agg(jsonb_build_object('week', to_char(w, 'DD/MM'), 'orders', coalesce(n, 0), 'goods_cny', coalesce(g, 0),
                                        'revenue', case when v_money then coalesce(rv, 0) end) order by w), '[]')
              from generate_series(date_trunc('week', (v_to - 77)::timestamp), date_trunc('week', v_to::timestamp), interval '1 week') w
              left join (select date_trunc('week', (o.created_at at time zone 'Asia/Ho_Chi_Minh')) wk, count(*) n, sum(o.goods_cny) g, sum(f.total) rv
                         from _dash_o o join _dash_f f on f.order_id = o.id where o.status <> 'huy' group by 1) t on t.wk = w),
    'alerts', (select coalesce(jsonb_agg(a order by (a->>'severity')::int, a->>'code'), '[]') from (
        select jsonb_build_object('severity', 1, 'type', 'qua_han', 'order_id', o.id, 'code', o.code, 'entity', e.legal_name,
               'text', d.label || ' quá ' || d.sla_days || ' ngày (đã ' || (current_date - (o.status_changed_at at time zone 'Asia/Ho_Chi_Minh')::date) || ' ngày)') a
        from _dash_o o join public.order_status_defs d on d.code = o.status join public.customer_entities e on e.id = o.entity_id
        where d.sla_days is not null and o.status not in ('hoan_tat','huy') and o.status_changed_at < now() - make_interval(days => d.sla_days)
        union all
        select jsonb_build_object('severity', 1, 'type', 'chua_thu_du_da_giao', 'order_id', o.id, 'code', o.code, 'entity', e.legal_name,
               'text', 'Đã về/giao hàng nhưng còn nợ ' || to_char(f.total - f.paid - f.credit, 'FM999G999G999G999') || ' đ')
        from _dash_o o join _dash_f f on f.order_id = o.id join public.customer_entities e on e.id = o.entity_id
        where v_money and o.status in ('ve_kho_vn','dang_giao','da_giao') and f.total - f.paid - f.credit > 0
        union all
        select jsonb_build_object('severity', 2, 'type', 'chua_bao_gia', 'order_id', o.id, 'code', o.code, 'entity', e.legal_name,
               'text', 'Khách đã gửi đơn, chưa có phiếu tính tiền')
        from _dash_o o join _dash_f f on f.order_id = o.id join public.customer_entities e on e.id = o.entity_id
        where o.status = 'cho_bao_gia' and f.st_status is null
        union all
        select jsonb_build_object('severity', 2, 'type', 'thieu_hd', 'order_id', o.id, 'code', o.code, 'entity', e.legal_name,
               'text', 'Đã giao đủ nhưng chưa phát hành đủ hóa đơn')
        from _dash_o o join public.customer_entities e on e.id = o.entity_id
        where o.status = 'da_giao' and exists (
          select 1 from public.order_items i
          where i.order_id = o.id and i.deleted_at is null
            and coalesce((select sum(sl.qty) from public.sales_invoice_lines sl join public.sales_invoices si on si.id = sl.sales_invoice_id
                          where sl.order_item_id = i.id and si.status = 'da_phat_hanh' and si.deleted_at is null), 0) < i.qty)
        union all
        select jsonb_build_object('severity', 3, 'type', 'thieu_gia_von', 'order_id', o.id, 'code', o.code, 'entity', e.legal_name,
               'text', 'Thiếu giá vốn ' || (p ->> 'missing') || ' khoản → lợi nhuận chưa đúng')
        from _dash_o o join public.customer_entities e on e.id = o.entity_id cross join lateral (select app.order_profit_calc(o.id) p) x
        where v_profit and o.status not in ('huy','dang_len_don') and (p ->> 'missing')::int > 0
      ) al limit 60)
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- 4. Danh sách đơn đầy đủ cho quản trị (lọc, tìm, tiến độ trong 1 lần gọi)
-- ---------------------------------------------------------------------
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
    'delay_reason', o.delay_reason, 'note', o.note
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

revoke all on function public.set_fee_cost(uuid, numeric, timestamptz, text), public.order_profit_detail(uuid),
  public.set_order_cost(uuid, text, text, bigint, text), public.admin_dashboard(date, date, uuid, uuid), public.admin_orders(jsonb) from public, anon;
grant execute on function public.set_fee_cost(uuid, numeric, timestamptz, text), public.order_profit_detail(uuid),
  public.set_order_cost(uuid, text, text, bigint, text), public.admin_dashboard(date, date, uuid, uuid), public.admin_orders(jsonb) to authenticated;

revoke all on public.order_cost_entries from anon, authenticated;
grant select on public.order_cost_entries to authenticated;
grant select, insert on public.order_cost_entries to service_role;
alter table public.order_cost_entries enable row level security;
create policy order_cost_entries_select on public.order_cost_entries for select to authenticated
  using (app.has_perm('finance.profit.read') and exists (select 1 from public.orders o where o.id = order_id and app.staff_can_see_customer(o.customer_id)));
