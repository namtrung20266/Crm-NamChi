"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, usePathname } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase, q } from "./supabase";

export interface Ctx {
  user_id: string; full_name: string; email: string; user_type: "staff" | "customer"; is_active: boolean;
  roles: { code: string; name: string }[]; permissions: string[];
  customer: { id: string; code: string; name: string } | null;
  entity: { id: string; code: string; legal_name: string } | null;
}
export interface SessionValue extends Ctx { can: (p: string) => boolean; isStaff: boolean }

const SessionCtx = createContext<SessionValue | null>(null);
export const useSession = () => {
  const v = useContext(SessionCtx);
  if (!v) throw new Error("useSession ngoài AuthGate");
  return v;
};

// Chặn trang khi chưa đăng nhập; nạp ngữ cảnh người dùng 1 lần (my_context)
export function AuthGate({ children, fallback }: { children: React.ReactNode; fallback: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) qc.clear();
    });
    return () => sub.subscription.unsubscribe();
  }, [qc]);

  const ctx = useQuery({
    queryKey: ["ctx", session?.user.id],
    enabled: !!session,
    staleTime: 5 * 60_000,
    queryFn: () => q<Ctx>(supabase.rpc("my_context")),
  });

  useEffect(() => {
    if (session === null) router.replace(`/login/?next=${encodeURIComponent(path)}`);
  }, [session, router, path]);
  useEffect(() => {
    if (ctx.data && !ctx.data.is_active) {
      supabase.auth.signOut().then(() => router.replace("/login/?error=inactive"));
    }
    if (session && ctx.isSuccess && !ctx.data) {
      supabase.auth.signOut().then(() => router.replace("/login/?error=inactive"));
    }
  }, [ctx.data, ctx.isSuccess, session, router]);

  if (!session || !ctx.data) return <>{fallback}</>;
  const perms = new Set(ctx.data.permissions);
  const value: SessionValue = { ...ctx.data, can: (p) => perms.has(p), isStaff: ctx.data.user_type === "staff" };
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
