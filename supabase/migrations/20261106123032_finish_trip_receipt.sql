-- Kho VN chốt nhận xe khi có lệch (đã kiểm từng kiện): đổi trạng thái xe & đơn, KHÔNG đụng trạng thái kiện
create or replace function public.finish_trip_receipt(p_trip_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_perm('warehouse.write') then raise exception 'Không có quyền kho' using errcode = '42501'; end if;
  if coalesce(length(trim(p_note)), 0) < 5 then raise exception 'Ghi rõ tình trạng lệch (thiếu/hỏng)' using errcode = '22023'; end if;
  perform set_config('app.change_reason', p_note, true);
  update public.trips set status = 've_vn', actual_date = coalesce(actual_date, current_date),
         note = concat_ws(' | ', note, 'Nhận lệch: ' || p_note), row_version = row_version where id = p_trip_id;
  update public.orders o set status = 've_kho_vn', vn_received_at = current_date, row_version = o.row_version
   where o.id in (select distinct p.order_id from public.picking_lists pl join public.picking_list_packages x on x.picking_list_id = pl.id
                  join public.packages p on p.id = x.package_id where pl.trip_id = p_trip_id and pl.status <> 'huy' and p.status in ('ve_vn','da_giao'))
     and o.status in ('dang_mua','cho_shop_giao','shop_da_phat','ve_kho_qc','ve_bang_tuong','tren_xe');
end $$;
revoke all on function public.finish_trip_receipt(uuid, text) from public, anon;
grant execute on function public.finish_trip_receipt(uuid, text) to authenticated;
