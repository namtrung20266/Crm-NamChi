import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type UserType = "staff" | "customer";

export interface SessionContext {
  userId: string;
  email: string;
  fullName: string;
  userType: UserType;
  roles: { code: string; name: string }[];
  permissions: Set<string>;
  customer: { id: string; code: string; name: string } | null;
  entity: { id: string; code: string; legalName: string } | null;
}

// Đọc ngữ cảnh người dùng 1 lần/request. Mọi dữ liệu lấy qua RLS.
export const getSession = cache(async (): Promise<SessionContext> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: perms }, { data: userRoles }, { data: cu }] = await Promise.all([
    supabase.from("profiles").select("full_name, user_type, is_active").eq("user_id", user.id).maybeSingle(),
    supabase.rpc("my_permissions"),
    supabase.from("user_roles").select("roles(code, name)").eq("user_id", user.id),
    supabase
      .from("customer_users")
      .select("customer_id, entity_id, customers(id, code, name), customer_entities(id, code, legal_name)")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  // Chưa có hồ sơ hoặc đã bị khóa → không cho vào
  if (!profile || !profile.is_active) {
    await supabase.auth.signOut();
    redirect("/login?error=inactive");
  }

  type RoleRow = { roles: { code: string; name: string } | null };
  type CuRow = {
    customers: { id: string; code: string; name: string } | null;
    customer_entities: { id: string; code: string; legal_name: string } | null;
  };
  const cuRow = cu as unknown as CuRow | null;

  return {
    userId: user.id,
    email: user.email ?? "",
    fullName: profile.full_name,
    userType: profile.user_type as UserType,
    roles: ((userRoles ?? []) as unknown as RoleRow[]).flatMap((r) => (r.roles ? [r.roles] : [])),
    permissions: new Set((perms ?? []) as string[]),
    customer: cuRow?.customers ?? null,
    entity: cuRow?.customer_entities
      ? { id: cuRow.customer_entities.id, code: cuRow.customer_entities.code, legalName: cuRow.customer_entities.legal_name }
      : null,
  };
});

export function can(session: SessionContext, permission: string): boolean {
  return session.permissions.has(permission);
}
