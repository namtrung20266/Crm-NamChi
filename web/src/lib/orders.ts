"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "./supabase";

export type Order = {
  id: string; code: string; customer_id: string; entity_id: string; order_week: string | null; supplier_name: string | null;
  goods_group: string | null; goods_desc: string | null; china_invoice_type: string; goods_qty: number; goods_cny: number; fx_rate: number;
  china_tax_cny: number; weight_kg: number; cbm: number; packages: number; vat_rate: number; status: string; expected_week: string | null;
  delay_reason: string | null; note: string | null; internal_note: string | null; created_at: string; row_version: number;
  customer_entities?: { code: string; legal_name: string } | null; customers?: { code: string; name: string } | null;
};
export type Fin = { order_id: string; total_vnd: number; deposit_vnd: number; paid_vnd: number; remaining_vnd: number; statement_kind: string | null; statement_status: string | null };

export const ORDER_SELECT = "*, customer_entities(code, legal_name), customers(code, name)";

export function useOrders(filter: { status?: string; customerId?: string; entityId?: string }) {
  return useQuery({
    queryKey: ["orders", filter],
    queryFn: async () => {
      let x = supabase.from("orders").select(ORDER_SELECT).order("created_at", { ascending: false }).limit(500);
      if (filter.status) x = x.eq("status", filter.status);
      if (filter.customerId) x = x.eq("customer_id", filter.customerId);
      if (filter.entityId) x = x.eq("entity_id", filter.entityId);
      const orders = await q<Order[]>(x);
      const fin = orders.length
        ? await q<Fin[]>(supabase.from("order_finance").select("order_id, total_vnd, deposit_vnd, paid_vnd, remaining_vnd, statement_kind, statement_status").in("order_id", orders.map((o) => o.id)))
        : [];
      const m = new Map(fin.map((f) => [f.order_id, f]));
      return orders.map((o) => ({ ...o, fin: m.get(o.id) ?? null }));
    },
  });
}
