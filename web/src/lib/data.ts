"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "./supabase";

export type Customer = { id: string; code: string; name: string; tax_code: string | null; address: string | null; payment_term_days: number; credit_limit_vnd: number; status: string; note: string | null; row_version: number };
export type Entity = { id: string; customer_id: string; code: string; legal_name: string; tax_code: string | null; invoice_address: string | null; invoice_email: string | null; is_retail_buyer: boolean };

export const useCustomers = () =>
  useQuery({ queryKey: ["customers"], queryFn: () => q<Customer[]>(supabase.from("customers").select("*").is("deleted_at", null).order("code")) });

export const useEntities = (customerId?: string | null) =>
  useQuery({
    queryKey: ["entities", customerId ?? "all"],
    queryFn: () => {
      let x = supabase.from("customer_entities").select("*").is("deleted_at", null).order("code");
      if (customerId) x = x.eq("customer_id", customerId);
      return q<Entity[]>(x);
    },
  });

export const useStaff = () =>
  useQuery({ queryKey: ["staff"], queryFn: () => q<{ user_id: string; full_name: string; email: string; role_code: string; role_names: string; is_active: boolean; last_login_at: string | null }[]>(
    supabase.from("user_directory").select("user_id, full_name, email, role_code, role_names, is_active, last_login_at").eq("user_type", "staff").order("full_name")) });

