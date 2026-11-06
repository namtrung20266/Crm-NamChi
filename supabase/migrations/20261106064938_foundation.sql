-- =====================================================================
-- NAMCHI ERP – Giai đoạn 1 – 0100: Nền tảng chung
--   schema app   : hàm phân quyền, trigger dùng chung (không mở qua API)
--   schema audit : nhật ký hệ thống
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

create schema if not exists app;
create schema if not exists audit;

revoke all on schema app   from public;
revoke all on schema audit from public;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Cột chuẩn: created_at/by, updated_at/by, row_version
-- row_version chống hai người sửa đè nhau: client gửi lại row_version
-- đang thấy; nếu khác bản trong DB thì từ chối.
-- ---------------------------------------------------------------------
create or replace function app.tg_standard_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at  := coalesce(new.created_at, now());
    new.created_by  := coalesce(new.created_by, auth.uid());
    new.updated_at  := new.created_at;
    new.updated_by  := new.created_by;
    new.row_version := 1;
  else
    if new.row_version is distinct from old.row_version then
      raise exception 'Dữ liệu đã bị người khác thay đổi (bạn gửi phiên bản %, hiện tại %). Tải lại rồi sửa.',
        new.row_version, old.row_version
        using errcode = '40001';
    end if;
    new.created_at  := old.created_at;
    new.created_by  := old.created_by;
    new.updated_at  := now();
    new.updated_by  := auth.uid();
    new.row_version := old.row_version + 1;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Chặn xóa vật lý: mọi bảng nghiệp vụ dùng deleted_at
-- ---------------------------------------------------------------------
create or replace function app.tg_block_hard_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Không được xóa vật lý bảng %. Dùng soft delete (deleted_at).', tg_table_name
    using errcode = '42501';
end;
$$;
