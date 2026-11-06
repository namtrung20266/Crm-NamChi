import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession, can } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { AccountsPanel } from "@/components/accounts-panel";

export default async function CustomerAccountsPage() {
  const s = await getSession();
  if (s.userType !== "customer" || !s.customer || !can(s, "customer_user.invite")) redirect("/");
  const supabase = await createClient();
  const { data: ents } = await supabase.from("customer_entities").select("id, code, legal_name").order("code");
  return (
    <>
      <PageHeader eyebrow="Quản trị" title="Tài khoản" desc="Cấp tài khoản cho nhân sự của từng công ty. Mỗi công ty chỉ xem được dữ liệu của chính mình." />
      <AccountsPanel session={s} customerId={s.customer.id} entities={ents ?? []} />
    </>
  );
}
