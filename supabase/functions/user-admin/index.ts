// NAMCHI – Edge Function user-admin
// Tạo tài khoản mới hoặc tạo link đặt lại mật khẩu, KHÔNG gửi email:
// trả về token để ứng dụng dựng link, người mời gửi link qua Zalo/email.
// Khóa service role chỉ tồn tại trong môi trường Edge Function của Supabase.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Chỉ chấp nhận POST" });
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json(401, { error: "Chưa đăng nhập" });

  // Client mang phiên của người gọi → mọi kiểm tra quyền chạy qua RLS/RPC
  const caller = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

  const { data: me } = await caller.auth.getUser();
  if (!me?.user) return json(401, { error: "Phiên đăng nhập không hợp lệ" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "Dữ liệu không hợp lệ" }); }

  const action = String(body.action ?? "");

  if (action === "invite") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const fullName = String(body.full_name ?? "").trim();
    const userType = String(body.user_type ?? "");
    const roleCode = String(body.role_code ?? "");
    const customerId = body.customer_id ? String(body.customer_id) : null;
    const entityId = body.entity_id ? String(body.entity_id) : null;

    if (!EMAIL_RE.test(email)) return json(400, { error: "Email không hợp lệ" });
    if (fullName.length < 2) return json(400, { error: "Cần nhập họ tên" });
    if (!["staff", "customer"].includes(userType)) return json(400, { error: "Loại tài khoản không hợp lệ" });
    if ((customerId && !UUID_RE.test(customerId)) || (entityId && !UUID_RE.test(entityId))) {
      return json(400, { error: "Mã khách hàng không hợp lệ" });
    }

    const { data: allowed, error: permErr } = await caller.rpc("can_provision", {
      p_user_type: userType, p_role_code: roleCode, p_customer_id: customerId, p_entity_id: entityId,
    });
    if (permErr || allowed !== true) return json(403, { error: "Bạn không có quyền cấp tài khoản này" });

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "invite", email });
    if (linkErr || !link?.user) {
      const exists = /already|registered|exists/i.test(linkErr?.message ?? "");
      return json(exists ? 409 : 500, { error: exists ? "Email này đã có tài khoản" : "Không tạo được tài khoản" });
    }

    const { error: provErr } = await caller.rpc("provision_user", {
      p_user_id: link.user.id, p_email: email, p_full_name: fullName, p_user_type: userType,
      p_role_code: roleCode, p_customer_id: customerId, p_entity_id: entityId,
    });
    if (provErr) {
      await admin.auth.admin.deleteUser(link.user.id); // dọn tài khoản dở dang
      return json(400, { error: "Không lưu được hồ sơ tài khoản: " + provErr.message });
    }
    return json(200, { token_hash: link.properties.hashed_token, type: "invite", email });
  }

  if (action === "reset_link") {
    const userId = String(body.user_id ?? "");
    if (!UUID_RE.test(userId)) return json(400, { error: "Tài khoản không hợp lệ" });

    // Người gọi phải nhìn thấy tài khoản này (RLS) và có quyền cấp loại tài khoản đó
    const { data: target } = await caller.from("user_directory")
      .select("email, user_type, role_code, customer_id, entity_id, is_active").eq("user_id", userId).maybeSingle();
    if (!target?.email) return json(404, { error: "Không tìm thấy tài khoản" });
    const { data: allowed } = await caller.rpc("can_provision", {
      p_user_type: target.user_type, p_role_code: target.role_code,
      p_customer_id: target.customer_id, p_entity_id: target.entity_id,
    });
    if (allowed !== true) return json(403, { error: "Bạn không có quyền với tài khoản này" });
    if (!target.is_active) return json(400, { error: "Tài khoản đang bị khóa" });

    const { data: link, error } = await admin.auth.admin.generateLink({ type: "recovery", email: target.email });
    if (error || !link) return json(500, { error: "Không tạo được link" });
    return json(200, { token_hash: link.properties.hashed_token, type: "recovery", email: target.email });
  }

  return json(400, { error: "Thao tác không hợp lệ" });
});
