"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { useCustomers, useEntities } from "@/lib/data";
import { PageHeader, Card, Field, inputCls, Empty } from "@/components/ui";
import { Form, Submit } from "@/components/ui/form";
import { OrderFields, readOrder } from "@/components/order-fields";
import { viError } from "@/lib/errors";

export default function NewOrderPage() {
  const s = useSession();
  const router = useRouter();
  const [customerId, setCustomerId] = useState(s.customer?.id ?? "");
  const customers = useCustomers();
  const ents = useEntities(customerId || null);
  const fx = useQuery({ queryKey: ["default-fx"], enabled: s.isStaff, queryFn: () => q<unknown>(supabase.rpc("get_setting", { p_key: "finance.default_fx_rate" })) });
  if (!s.can("order.write") && !s.can("order.create_own")) return <Empty title="Bạn không có quyền tạo đơn" />;
  return (
    <>
      <PageHeader eyebrow="Vận hành · Đơn hàng" title="Tạo đơn hàng" desc="Ghi phần đầu đơn và tổng tiền. Ảnh/file chi tiết khách gửi đính kèm ở trang đơn." />
      <Card>
        <Form invalidate={[["orders"]]} onSubmit={async (f) => {
          const entity_id = s.entity?.id ?? String(f.get("entity_id") ?? "");
          if (!customerId || !entity_id) return { error: "Chọn khách hàng và công ty nhận hóa đơn" };
          const p = readOrder(f, s.isStaff);
          if ("error" in p) return { error: p.error };
          const payload = { ...p.data, customer_id: customerId, entity_id, ...(s.isStaff ? {} : { fx_rate: 1 }) };
          const { data, error } = await supabase.from("orders").insert(payload).select("id").single();
          if (error) return { error: viError(error) };
          router.push(`/don-hang/chi-tiet/?id=${data.id}`);
        }}>
          <div className="grid gap-4 sm:grid-cols-2">
            {s.isStaff ? <Field label="Khách hàng"><select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={inputCls} required>
              <option value="">Chọn khách…</option>{(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field> : null}
            {s.entity ? <Field label="Công ty nhận hóa đơn"><input disabled value={s.entity.legal_name} className={inputCls + " bg-surface"} /></Field> : (
              <Field label="Công ty nhận hóa đơn"><select name="entity_id" required className={inputCls} defaultValue=""><option value="" disabled>Chọn công ty…</option>
                {(ents.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.code} · {e.legal_name}</option>)}</select></Field>
            )}
          </div>
          <OrderFields staff={s.isStaff} o={{ fx_rate: Number(fx.data ?? 0) || undefined }} key={String(fx.data)} />
          <div className="flex justify-end"><Submit>Tạo đơn</Submit></div>
        </Form>
      </Card>
    </>
  );
}
