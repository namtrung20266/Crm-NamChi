"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession, can } from "@/lib/session";
import { viError, type ActionState } from "@/lib/errors";
import { inviteUser, resetLink } from "@/lib/user-admin";

const uuid = z.string().uuid();
const opt = (s: FormDataEntryValue | null) => {
  const v = typeof s === "string" ? s.trim() : "";
  return v === "" ? null : v;
};
const fail = (error: string): ActionState => ({ error });
const DENIED = fail("Bạn không có quyền thực hiện thao tác này.");

// ---------------- Khách hàng ----------------
const customerSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/, "Mã khách 2–20 ký tự, chữ in hoa/số"),
  name: z.string().trim().min(2, "Cần nhập tên khách hàng"),
  tax_code: z.string().trim().nullable(),
  address: z.string().trim().nullable(),
  payment_term_days: z.coerce.number().int().min(0).max(365),
  credit_limit_vnd: z.coerce.number().int().min(0),
  status: z.enum(["active", "paused", "closed"]),
  note: z.string().trim().nullable(),
});

function readCustomer(f: FormData) {
  return customerSchema.safeParse({
    code: f.get("code"), name: f.get("name"), tax_code: opt(f.get("tax_code")), address: opt(f.get("address")),
    payment_term_days: f.get("payment_term_days") || 30, credit_limit_vnd: String(f.get("credit_limit_vnd") || "0").replace(/\D/g, "") || 0,
    status: f.get("status") || "active", note: opt(f.get("note")),
  });
}

export async function createCustomer(_: ActionState, f: FormData): Promise<ActionState> {
  const s = await getSession();
  if (!can(s, "customer.write")) return DENIED;
  const p = readCustomer(f);
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await createClient();
  const { data, error } = await supabase.from("customers").insert(p.data).select("id").single();
  if (error) return fail(viError(error));
  redirect(`/khach-hang/${data.id}`);
}

export async function updateCustomer(_: ActionState, f: FormData): Promise<ActionState> {
  const s = await getSession();
  if (!can(s, "customer.write")) return DENIED;
  const id = uuid.safeParse(f.get("id"));
  const p = readCustomer(f);
  if (!id.success) return fail("Khách hàng không hợp lệ");
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await createClient();
  const { error } = await supabase.from("customers")
    .update({ ...p.data, row_version: Number(f.get("row_version")) }).eq("id", id.data);
  if (error) return fail(viError(error));
  revalidatePath(`/khach-hang/${id.data}`);
  return { ok: true, message: "Đã lưu thông tin khách hàng." };
}

// ---------------- Công ty con ----------------
const entitySchema = z.object({
  customer_id: uuid,
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,20}$/, "Mã công ty con 1–20 ký tự, chữ in hoa/số"),
  legal_name: z.string().trim().min(2, "Cần nhập tên pháp lý"),
  tax_code: z.string().trim().nullable(),
  invoice_address: z.string().trim().nullable(),
  invoice_email: z.string().trim().email("Email nhận hóa đơn không hợp lệ").nullable(),
  is_retail_buyer: z.boolean(),
});

export async function addEntity(_: ActionState, f: FormData): Promise<ActionState> {
  const s = await getSession();
  if (!can(s, "customer.write")) return DENIED;
  const p = entitySchema.safeParse({
    customer_id: f.get("customer_id"), code: f.get("code"), legal_name: f.get("legal_name"),
    tax_code: opt(f.get("tax_code")), invoice_address: opt(f.get("invoice_address")),
    invoice_email: opt(f.get("invoice_email")), is_retail_buyer: f.get("is_retail_buyer") === "on",
  });
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await createClient();
  const { error } = await supabase.from("customer_entities").insert(p.data);
  if (error) return fail(viError(error));
  revalidatePath(`/khach-hang/${p.data.customer_id}`);
  return { ok: true, message: `Đã thêm công ty con ${p.data.legal_name}.` };
}

// ---------------- Liên hệ ----------------
export async function addContact(_: ActionState, f: FormData): Promise<ActionState> {
  const s = await getSession();
  if (!can(s, "customer.write")) return DENIED;
  const p = z.object({
    customer_id: uuid, entity_id: uuid.nullable(), name: z.string().trim().min(2, "Cần nhập tên người liên hệ"),
    phone: z.string().trim().nullable(), email: z.string().trim().email("Email không hợp lệ").nullable(), role_note: z.string().trim().nullable(),
  }).safeParse({
    customer_id: f.get("customer_id"), entity_id: opt(f.get("entity_id")), name: f.get("name"),
    phone: opt(f.get("phone")), email: opt(f.get("email")), role_note: opt(f.get("role_note")),
  });
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await createClient();
  const { error } = await supabase.from("customer_contacts").insert(p.data);
  if (error) return fail(viError(error));
  revalidatePath(`/khach-hang/${p.data.customer_id}`);
  return { ok: true, message: "Đã thêm người liên hệ." };
}

// ---------------- Phân công CSKH ----------------
export async function assignCs(_: ActionState, f: FormData): Promise<ActionState> {
  const s = await getSession();
  if (!can(s, "user.manage")) return DENIED;
  const p = z.object({ customer_id: uuid, staff_user_id: uuid }).safeParse({ customer_id: f.get("customer_id"), staff_user_id: f.get("staff_user_id") });
  if (!p.success) return fail("Chọn nhân viên CSKH");
  const supabase = await createClient();
  const { error } = await supabase.from("staff_customer_assignments").insert(p.data);
  if (error) return fail(viError(error));
  revalidatePath(`/khach-hang/${p.data.customer_id}`);
  return { ok: true, message: "Đã phân công CSKH." };
}

export async function endAssignment(f: FormData) {
  const s = await getSession();
  if (!can(s, "user.manage")) return;
  const id = uuid.parse(f.get("id"));
  const supabase = await createClient();
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  // kết thúc phân công: nếu bắt đầu hôm nay thì valid_to = hôm nay, ngược lại = hôm qua
  const { data } = await supabase.from("staff_customer_assignments").select("valid_from, row_version, customer_id").eq("id", id).single();
  if (!data) return;
  await supabase.from("staff_customer_assignments")
    .update({ valid_to: data.valid_from >= today ? today : yesterday, row_version: data.row_version }).eq("id", id);
  revalidatePath(`/khach-hang/${data.customer_id}`);
}

// ---------------- Tài khoản: mời, link đặt lại mật khẩu, khóa ----------------
export async function inviteAccount(_: ActionState, f: FormData): Promise<ActionState> {
  const s = await getSession();
  if (!can(s, "customer_user.invite") && !can(s, "user.manage")) return DENIED;
  const p = z.object({
    email: z.string().trim().toLowerCase().email("Email không hợp lệ"),
    full_name: z.string().trim().min(2, "Cần nhập họ tên"),
    user_type: z.enum(["staff", "customer"]),
    role_code: z.string().min(2, "Chọn vai trò"),
    customer_id: uuid.nullable(),
    entity_id: uuid.nullable(),
  }).safeParse({
    email: f.get("email"), full_name: f.get("full_name"), user_type: f.get("user_type"), role_code: f.get("role_code"),
    customer_id: opt(f.get("customer_id")), entity_id: opt(f.get("entity_id")),
  });
  if (!p.success) return fail(p.error.issues[0].message);
  const r = await inviteUser(p.data);
  if (!r.ok) return fail(r.error);
  revalidatePath("/", "layout");
  return { ok: true, message: `Đã tạo tài khoản ${r.email}. Gửi link dưới đây để người dùng tự đặt mật khẩu.`, link: r.link };
}

export async function makeResetLink(_: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get("user_id"));
  if (!id.success) return fail("Tài khoản không hợp lệ");
  const r = await resetLink(id.data);
  if (!r.ok) return fail(r.error);
  return { ok: true, message: `Link đặt lại mật khẩu cho ${r.email}:`, link: r.link };
}

export async function toggleActive(f: FormData) {
  const s = await getSession();
  if (!can(s, "user.manage")) return;
  const id = uuid.parse(f.get("user_id"));
  const active = f.get("active") === "true";
  const supabase = await createClient();
  await supabase.rpc("set_user_active", { p_user_id: id, p_active: active, p_reason: active ? "Mở khóa tài khoản" : "Khóa tài khoản" });
  revalidatePath("/", "layout");
}

export async function changeStaffRole(f: FormData) {
  const s = await getSession();
  if (!can(s, "user.manage")) return;
  const id = uuid.parse(f.get("user_id"));
  const role = z.string().parse(f.get("role_code"));
  const supabase = await createClient();
  await supabase.rpc("set_staff_role", { p_user_id: id, p_role_code: role, p_reason: "Đổi vai trò" });
  revalidatePath("/nhan-vien");
}

// ---------------- Phân quyền ----------------
export async function togglePermission(f: FormData) {
  const s = await getSession();
  if (!can(s, "role.manage")) return;
  const roleId = uuid.parse(f.get("role_id"));
  const permId = uuid.parse(f.get("permission_id"));
  const on = f.get("on") === "true";
  const supabase = await createClient();
  if (on) await supabase.from("role_permissions").insert({ role_id: roleId, permission_id: permId });
  else await supabase.from("role_permissions").delete().eq("role_id", roleId).eq("permission_id", permId);
  revalidatePath("/phan-quyen");
}

// ---------------- Cài đặt ----------------
export async function newSetting(_: ActionState, f: FormData): Promise<ActionState> {
  const s = await getSession();
  if (!can(s, "settings.manage")) return DENIED;
  const key = z.string().regex(/^[a-z0-9_.]+$/).safeParse(f.get("key"));
  if (!key.success) return fail("Chọn tham số");
  let value: unknown;
  try { value = JSON.parse(String(f.get("value") ?? "")); } catch { return fail("Giá trị phải là số hoặc JSON hợp lệ"); }
  const from = String(f.get("valid_from") || "");
  const validFrom = from ? new Date(from + "T00:00:00+07:00").toISOString() : new Date().toISOString();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_setting", { p_key: key.data, p_value: value, p_valid_from: validFrom, p_note: opt(f.get("note")) });
  if (error) return fail(viError(error));
  revalidatePath("/cai-dat");
  return { ok: true, message: "Đã tạo bản cài đặt mới. Bản cũ vẫn được giữ cho các giao dịch trước đó." };
}

export async function addTradeParty(_: ActionState, f: FormData): Promise<ActionState> {
  const s = await getSession();
  if (!can(s, "settings.manage")) return DENIED;
  const p = z.object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,30}$/, "Mã 2–30 ký tự in hoa/số"),
    party_role: z.enum(["importer", "exporter", "supplier"]),
    legal_name: z.string().trim().min(2, "Cần nhập tên"),
    tax_code: z.string().trim().nullable(),
    country: z.string().trim().min(2).max(2),
  }).safeParse({ code: f.get("code"), party_role: f.get("party_role"), legal_name: f.get("legal_name"), tax_code: opt(f.get("tax_code")), country: f.get("country") || "VN" });
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await createClient();
  const { error } = await supabase.from("trade_parties").insert(p.data);
  if (error) return fail(viError(error));
  revalidatePath("/cai-dat");
  return { ok: true, message: "Đã thêm đối tác." };
}

// ---------------- Hồ sơ cá nhân ----------------
export async function updateProfile(_: ActionState, f: FormData): Promise<ActionState> {
  const s = await getSession();
  const p = z.object({ full_name: z.string().trim().min(2, "Cần nhập họ tên"), phone: z.string().trim().nullable() })
    .safeParse({ full_name: f.get("full_name"), phone: opt(f.get("phone")) });
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await createClient();
  const { data: cur } = await supabase.from("profiles").select("row_version").eq("user_id", s.userId).single();
  const { error } = await supabase.from("profiles").update({ ...p.data, row_version: cur?.row_version }).eq("user_id", s.userId);
  if (error) return fail(viError(error));
  revalidatePath("/", "layout");
  return { ok: true, message: "Đã lưu." };
}

export async function changePassword(_: ActionState, f: FormData): Promise<ActionState> {
  await getSession();
  const p = z.object({ password: z.string().min(10, "Mật khẩu tối thiểu 10 ký tự"), confirm: z.string() })
    .refine((v) => v.password === v.confirm, { message: "Hai lần nhập không khớp" })
    .safeParse({ password: f.get("password"), confirm: f.get("confirm") });
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: p.data.password });
  if (error) return fail(/should be different/i.test(error.message) ? "Mật khẩu mới phải khác mật khẩu cũ." : "Không đổi được mật khẩu, thử lại.");
  return { ok: true, message: "Đã đổi mật khẩu." };
}
