"use client";

import { useSession } from "@/lib/session";
import { useEntities } from "@/lib/data";
import { PageHeader, Empty } from "@/components/ui";
import { AccountsPanel } from "@/components/accounts-panel";

export default function CustomerAccountsPage() {
  const s = useSession();
  const ents = useEntities();
  if (s.isStaff || !s.customer || !s.can("customer_user.invite")) return <Empty title="Bạn không có quyền quản lý tài khoản" />;
  return (
    <>
      <PageHeader eyebrow="Quản trị" title="Tài khoản" desc="Mỗi công ty chỉ xem được dữ liệu của chính mình." />
      <AccountsPanel customerId={s.customer.id} entities={ents.data ?? []} />
    </>
  );
}
