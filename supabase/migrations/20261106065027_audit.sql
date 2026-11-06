-- =====================================================================
-- NAMCHI ERP – Giai đoạn 1 – 0300: Nhật ký hệ thống (chỉ ghi thêm)
-- Tài liệu: mục 4.6
-- =====================================================================
create table audit.logs (
  id             bigint generated always as identity primary key,
  table_name     text not null,
  row_id         text not null,
  action         text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data       jsonb,
  new_data       jsonb,
  changed_fields text[],
  actor_id       uuid,
  ip             text,
  reason         text,
  at             timestamptz not null default now()
);
create index audit_logs_table_row_idx on audit.logs(table_name, row_id);
create index audit_logs_actor_idx     on audit.logs(actor_id, at desc);
create index audit_logs_at_idx        on audit.logs(at desc);

-- Không ai sửa/xóa nhật ký, kể cả chủ sở hữu bảng
create or replace function audit.tg_block_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Nhật ký hệ thống chỉ được ghi thêm, không sửa/xóa.' using errcode = '42501';
end;
$$;
create trigger logs_no_update before update or delete on audit.logs
  for each row execute function audit.tg_block_change();
create trigger logs_no_truncate before truncate on audit.logs
  for each statement execute function audit.tg_block_change();

revoke all on audit.logs from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Trigger ghi nhật ký dùng chung.
--   Lý do thay đổi: server đặt `set local app.change_reason = '...'`
--   IP: lấy từ header PostgREST (x-forwarded-for) nếu có
-- ---------------------------------------------------------------------
create or replace function audit.tg_log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old     jsonb;
  v_new     jsonb;
  v_changed text[];
  v_row_id  text;
  v_headers jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;

  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into v_changed
    from jsonb_object_keys(v_new) k
    where v_new -> k is distinct from v_old -> k
      and k not in ('updated_at', 'updated_by', 'row_version');
    if v_changed is null then
      return new;  -- không có thay đổi thực chất
    end if;
  end if;

  v_row_id := coalesce(v_new ->> 'id', v_old ->> 'id',
                       v_new ->> 'user_id', v_old ->> 'user_id', '?');

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;

  insert into audit.logs (table_name, row_id, action, old_data, new_data, changed_fields, actor_id, ip, reason)
  values (tg_table_schema || '.' || tg_table_name, v_row_id, tg_op, v_old, v_new, v_changed,
          auth.uid(),
          v_headers ->> 'x-forwarded-for',
          nullif(current_setting('app.change_reason', true), ''));

  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'user_roles', 'role_permissions', 'customers', 'customer_entities',
                           'customer_contacts', 'customer_users', 'staff_customer_assignments',
                           'trade_parties', 'app_settings', 'attachments']
  loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I
                    for each row execute function audit.tg_log_change()', t, t);
  end loop;
end;
$$;

-- View đọc nhật ký cho người có quyền audit.read (định nghĩa ở 0400 sau khi có app.has_perm)
