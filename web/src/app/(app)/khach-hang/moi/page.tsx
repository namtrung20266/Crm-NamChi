"use client";

import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { PageHeader, Card, Empty } from "@/components/ui";
import { Form, Submit } from "@/components/ui/form";
import { CustomerFields, readCustomer } from "@/components/customer-form";
import { viError } from "@/lib/errors";

export default function NewCustomerPage() {
  const s = useSession();
  const router = useRouter();
  if (!s.can("customer.write")) return <Empty title="Bạn không có quyền thêm khách hàng" />;
  return (
    <>
      <PageHeader eyebrow="CRM · Khách hàng" title="Thêm khách hàng" />
      <Card>
        <Form invalidate={[["customers"]]} onSubmit={async (f) => {
          const p = readCustomer(f);
          if ("error" in p) return { error: p.error };
          const { data, error } = await supabase.from("customers").insert(p.data).select("id").single();
          if (error) return { error: viError(error) };
          router.push(`/khach-hang/chi-tiet/?id=${data.id}`);
        }}>
          <CustomerFields />
          <div className="flex justify-end"><Submit>Tạo khách hàng</Submit></div>
        </Form>
      </Card>
    </>
  );
}
