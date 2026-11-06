"use client";

import { AuthGate } from "@/lib/session";
import { AppShell, ShellSkeleton } from "@/components/app-shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate fallback={<ShellSkeleton />}>
      <AppShell>{children}</AppShell>
    </AuthGate>
  );
}
