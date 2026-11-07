// NAMCHI – Edge Function drive-files: lưu file lên Google Drive, trả file cho người có quyền xem
//   POST  multipart: file, entity_type, ref_id, visibility?, category?, note?  → bản ghi attachments
//   GET   ?id=<attachment_id>[&thumb=1]                                    → nội dung file (ảnh thu nhỏ nếu thumb)
//   GET   /oauth?code&state                                                 → Google chuyển về khi Admin kết nối Drive
// Cấu hình Google lấy từ biến môi trường, không có thì đọc từ Cấu hình hệ thống (schema app, chỉ service role đọc).
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = "https://namtrung20266.github.io/Crm-NamChi";
const CALLBACK = `${URL_}/functions/v1/drive-files/oauth`;
const ALLOWED_ORIGINS = ["https://namtrung20266.github.io", "http://localhost:3000"];
const MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/gif", "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword", "text/csv",
  "application/zip", "application/x-zip-compressed", "video/mp4",
]);
const UUID_RE = /^[0-9a-f-]{36}$/i;
const admin = () => createClient(URL_, SERVICE, { auth: { persistSession: false } });

type Cfg = { id: string; secret: string; refresh: string; root: string };
let cfgCache: { v: Cfg; exp: number } | null = null;
async function cfg(force = false): Promise<Cfg> {
  if (!force && cfgCache && cfgCache.exp > Date.now()) return cfgCache.v;
  let v: Cfg = { id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "", secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "", refresh: Deno.env.get("GOOGLE_REFRESH_TOKEN") ?? "", root: Deno.env.get("DRIVE_ROOT_FOLDER_ID") ?? "" };
  if (!v.refresh) {
    const { data } = await admin().rpc("drive_secrets");
    const d = (data ?? {}) as Record<string, string>;
    v = { id: d.GOOGLE_CLIENT_ID ?? "", secret: d.GOOGLE_CLIENT_SECRET ?? "", refresh: d.GOOGLE_REFRESH_TOKEN ?? "", root: d.DRIVE_ROOT_FOLDER_ID ?? "" };
  }
  cfgCache = { v, exp: Date.now() + 60_000 };
  return v;
}

let gToken: { v: string; exp: number } | null = null;
async function googleToken(): Promise<string> {
  if (gToken && gToken.exp > Date.now() + 60_000) return gToken.v;
  const c = await cfg();
  if (!c.id || !c.secret || !c.refresh || !c.root) throw new Error("DRIVE_NOT_CONFIGURED");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, refresh_token: c.refresh, grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error("DRIVE_AUTH_FAILED");
  gToken = { v: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3000) * 1000 };
  return gToken.v;
}

// Thư mục: gốc/<khách>/<loại>/<YYYY-MM>; cache id theo đường dẫn
const folderCache = new Map<string, string>();
async function ensureFolder(path: string, token: string): Promise<string> {
  let parent = (await cfg()).root;
  let acc = "";
  for (const raw of path.split("/").filter(Boolean)) {
    const name = raw.replace(/['\\]/g, "_");
    acc += "/" + name;
    const hit = folderCache.get(acc);
    if (hit) { parent = hit; continue; }
    const q = `name='${name}' and '${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const sj = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`, { headers: { Authorization: `Bearer ${token}` } })).json();
    let id: string | undefined = sj.files?.[0]?.id;
    if (!id) {
      const c = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }) });
      id = (await c.json()).id;
      if (!id) throw new Error("DRIVE_FOLDER_FAILED");
    }
    folderCache.set(acc, id);
    parent = id;
  }
  return parent;
}

async function uploadToDrive(file: File, name: string, folderId: string, token: string): Promise<string> {
  const init = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": file.type, "X-Upload-Content-Length": String(file.size) },
    body: JSON.stringify({ name, parents: [folderId] }),
  });
  const loc = init.headers.get("Location");
  if (!init.ok || !loc) throw new Error("DRIVE_UPLOAD_INIT_FAILED");
  const put = await fetch(loc, { method: "PUT", headers: { "Content-Type": file.type, "Content-Length": String(file.size) }, body: file.stream() });
  const pj = await put.json().catch(() => ({}));
  if (!put.ok || !pj.id) throw new Error("DRIVE_UPLOAD_FAILED");
  return pj.id as string;
}

const ERR: Record<string, [number, string]> = {
  DRIVE_NOT_CONFIGURED: [503, "Chưa kết nối Google Drive. Admin vào Cấu hình hệ thống → Google Drive để kết nối."],
  DRIVE_AUTH_FAILED: [503, "Mất kết nối Google Drive (quyền bị thu hồi). Admin vào Cấu hình hệ thống → Google Drive để kết nối lại."],
};

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const CORS: Record<string, string> = ALLOWED_ORIGINS.includes(origin)
    ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Expose-Headers": "content-disposition, content-type" }
    : {};
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  // Google chuyển về sau khi Admin cho phép: đổi code lấy refresh token, tạo thư mục gốc, lưu vào cấu hình (kiểm mã state chống giả mạo)
  if (req.method === "GET" && new URL(req.url).pathname.endsWith("/oauth")) {
    const u = new URL(req.url);
    const back = (q: string) => Response.redirect(`${APP_URL}/cai-dat/?tab=drive&drive=${q}`, 302);
    const code = u.searchParams.get("code"), state = u.searchParams.get("state") ?? "";
    if (!code) return back("huy");
    const { data: sec } = await admin().rpc("drive_secrets");
    const d = (sec ?? {}) as Record<string, string>;
    if (!d.OAUTH_STATE || d.OAUTH_STATE.split("|")[0] !== state) return back("loi_state");
    const tr = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: d.GOOGLE_CLIENT_ID ?? "", client_secret: d.GOOGLE_CLIENT_SECRET ?? "", redirect_uri: CALLBACK, grant_type: "authorization_code" }) });
    const tj = await tr.json();
    if (!tr.ok || !tj.access_token) return back("loi_token");
    const me = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${tj.access_token}` } }).then((r) => r.json()).catch(() => ({}));
    let root = d.DRIVE_ROOT_FOLDER_ID ?? "";
    if (!root) {
      const f = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", { method: "POST", headers: { Authorization: `Bearer ${tj.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "NAMCHI-ERP (file hệ thống)", mimeType: "application/vnd.google-apps.folder" }) }).then((r) => r.json()).catch(() => ({}));
      root = f.id ?? "";
    }
    const { data: ok } = await admin().rpc("drive_save_oauth", { p_state: state, p_refresh_token: tj.refresh_token ?? "", p_account: me.email ?? "", p_folder_id: root });
    cfgCache = null; gToken = null; folderCache.clear();
    return back(ok ? "ok" : "loi_state");
  }

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json(401, { error: "Chưa đăng nhập" });
  const caller = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: me } = await caller.auth.getUser();
  if (!me?.user) return json(401, { error: "Phiên đăng nhập không hợp lệ" });

  try {
    if (req.method === "GET") {
      const u = new URL(req.url);
      const id = u.searchParams.get("id") ?? "";
      if (!UUID_RE.test(id)) return json(400, { error: "Thiếu mã file" });
      const { data: att } = await caller.from("attachments").select("storage_key, storage_provider, mime_type, file_name").eq("id", id).maybeSingle();
      if (!att || att.storage_provider !== "gdrive") return json(404, { error: "Không tìm thấy file hoặc không có quyền xem" });
      const token = await googleToken();
      let res: Response | null = null;
      if (u.searchParams.get("thumb") === "1" && att.mime_type.startsWith("image/")) {
        const link = (await (await fetch(`https://www.googleapis.com/drive/v3/files/${att.storage_key}?fields=thumbnailLink`, { headers: { Authorization: `Bearer ${token}` } })).json()).thumbnailLink as string | undefined;
        if (link) { const t = await fetch(link.replace(/=s\d+$/, "=s480"), { headers: { Authorization: `Bearer ${token}` } }); if (t.ok) res = t; }
      }
      if (!res) res = await fetch(`https://www.googleapis.com/drive/v3/files/${att.storage_key}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return json(502, { error: "Không lấy được file từ Drive" });
      return new Response(res.body, { status: 200, headers: { ...CORS, "Content-Type": res.headers.get("Content-Type") ?? att.mime_type,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(att.file_name)}`, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
    }
    if (req.method === "POST") {
      const form = await req.formData();
      const file = form.get("file");
      const entityType = String(form.get("entity_type") ?? "");
      const refId = String(form.get("ref_id") ?? "");
      if (!(file instanceof File)) return json(400, { error: "Chưa chọn file" });
      if (!UUID_RE.test(refId)) return json(400, { error: "Đối tượng đính kèm không hợp lệ" });
      if (!MIME.has(file.type)) return json(400, { error: `Định dạng ${file.type || "không rõ"} không được phép (ảnh, PDF, Excel, Word, CSV, ZIP, MP4)` });
      const { data: scope, error } = await caller.rpc("attachment_scope", { p_entity_type: entityType, p_ref_id: refId, p_visibility: String(form.get("visibility") ?? "customer") });
      if (error || !scope) return json(403, { error: error?.message ?? "Không có quyền đính kèm" });
      if (file.size <= 0 || file.size > Number(scope.max_bytes)) return json(400, { error: `File vượt dung lượng cho phép (${Math.round(Number(scope.max_bytes) / 1048576)} MB)` });
      const token = await googleToken();
      const folder = await ensureFolder(String(scope.folder), token);
      const safe = file.name.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 150);
      const driveId = await uploadToDrive(file, `${scope.label}__${Date.now()}__${safe}`, folder, token);
      const { data: row, error: insErr } = await admin().from("attachments").insert({
        customer_id: scope.customer_id, entity_id: scope.entity_id, entity_type: entityType, entity_ref_id: refId,
        storage_provider: "gdrive", storage_key: driveId, file_name: file.name.slice(0, 250), mime_type: file.type,
        size_bytes: file.size, visibility: scope.visibility, category: String(form.get("category") ?? "") || null,
        note: String(form.get("note") ?? "").slice(0, 500) || null, created_by: me.user.id,
      }).select("id, file_name, mime_type, size_bytes, visibility, category, note, created_at, created_by, entity_type, entity_ref_id").single();
      if (insErr) return json(400, { error: "Không lưu được thông tin file: " + insErr.message });
      return json(200, row);
    }
    return json(405, { error: "Phương thức không hỗ trợ" });
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    const [st, msg] = ERR[code] ?? [500, "Lỗi xử lý file, thử lại sau"];
    console.error("drive-files", code, e);
    return json(st, { error: msg });
  }
});
