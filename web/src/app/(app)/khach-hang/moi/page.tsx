import { redirect } from "next/navigation";
import { getSession, can } from "@/lib/session";
import { PageHeader, Card } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { CustomerFields } from "@/components/customer-form";
import { createCustomer } from "../../actions";

export default async function NewCustomerPage() {
  const s = await getSession();
  if (!can(s, "customer.write")) redirect("/khach-hang");
  return (
    <>
      <PageHeader eyebrow="CRM · Khách hàng" title="Thêm khách hàng" desc="Sau khi tạo, thêm công ty con nhận hóa đơn, người liên hệ, CSKH phụ trách và cấp tài khoản." />
      <Card>
        <ActionForm action={createCustomer}>
          <CustomerFields />
          <div className="flex justify-end"><SubmitButton>Tạo khách hàng</SubmitButton></div>
        </ActionForm>
      </Card>
    </>
  );
}
