// NAMCHI – Edge Function drive-files
// Tải file lên Google Drive của tài khoản hệ thống và trả file về cho người có quyền xem.
//   POST  multipart: file, entity_type, ref_id, visibility?, category?, note?  → bản ghi attachments
//   GET   ?id=<attachment_id>[&thumb=1]                                   → nội dung file (ảnh thu nhỏ nếu thumb)
// Quyền: kiểm bằng phiên của người gọi (RPC attachment_scope / RLS bảng attachments).
// Chỉ hàm này (service role) ghi bảng attachments → người dùng không gắn được file Drive tùy ý.
// Secrets cần đặt trên Supabase: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, DRIVE_ROOT_FOLDER_ID
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const G_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const G_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const G_REFRESH = Deno.env.get("GOOGLE_REFRESH_TOKEN") ?? "";
const ROOT = Deno.env.get("DRIVE_ROOT_FOLDER_ID") ?? "";

const ALLOWED_ORIGINS = ["https://namtrung20266.github.io", "http://localhost:3000"];
const MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/gif", "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword", "text/csv",
  "application/zip", "application/x-zip-compressed", "video/mp4",
]);
const UUID_RE = /^[0-9a-f-]{36}$/i;

// Token Google: cache trong bộ nhớ instance tới khi gần hết hạn
let gToken: { v: string; exp: number } | null = null;
async function googleToken(): Promise<string> {
  if (gToken && gToken.exp > Date.now() + 60_000) return gToken.v;
  if (!G_ID || !G_SECRET || !G_REFRESH || !ROOT) throw new Error("DRIVE_NOT_CONFIGURED");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: G_ID, client_secret: G_SECRET, refresh_token: G_REFRESH, grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error("DRIVE_AUTH_FAILED");
  gToken = { v: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3000) * 1000 };
  return gToken.v;
}

// Thư mục: ROOT/<khách>/<loại>/<YYYY-MM>; cache id theo đường dẫn
const folderCache = new Map<string, string>();
async function ensureFolder(path: string, token: string): Promise<string> {
  let parent = ROOT;
  let acc = "";
  for (const raw of path.split("/").filter(Boolean)) {
    const name = raw.replace(/['\\]/g, "_");
    acc += "/" + name;
    const hit = folderCache.get(acc);
    if (hit) { parent = hit; continue; }
    const q = `name='${name}' and '${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const s = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`, { headers: { Authorization: `Bearer ${token}` } });
    const sj = await s.json();
    let id: string | undefined = sj.files?.[0]?.id;
    if (!id) {
      const c = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }),
      });
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
  DRIVE_NOT_CONFIGURED: [503, "Kho file Google Drive chưa được cấu hình. Báo Admin đặt secrets cho hàm drive-files."],
  DRIVE_AUTH_FAILED: [503, "Không đăng nhập được Google Drive (token hết hạn hoặc bị thu hồi). Báo Admin cấp lại."],
};

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const CORS: Record<string, string> = ALLOWED_ORIGINS.includes(origin)
    ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Expose-Headers": "content-disposition, content-type" }
    : {};
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
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
      // RLS quyết định: không thấy bản ghi = không có quyền
      const { data: att } = await caller.from("attachments").select("storage_key, storage_provider, mime_type, file_name").eq("id", id).maybeSingle();
      if (!att || att.storage_provider !== "gdrive") return json(404, { error: "Không tìm thấy file hoặc không có quyền xem" });
      const token = await googleToken();
      let res: Response | null = null;
      if (u.searchParams.get("thumb") === "1" && att.mime_type.startsWith("image/")) {
        const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${att.storage_key}?fields=thumbnailLink`, { headers: { Authorization: `Bearer ${token}` } });
        const link = (await meta.json()).thumbnailLink as string | undefined;
        if (link) {
          const t = await fetch(link.replace(/=s\d+$/, "=s480"), { headers: { Authorization: `Bearer ${token}` } });
          if (t.ok) res = t;
        }
      }
      if (!res) res = await fetch(`https://www.googleapis.com/drive/v3/files/${att.storage_key}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return json(502, { error: "Không lấy được file từ Drive" });
      return new Response(res.body, { status: 200, headers: {
        ...CORS, "Content-Type": res.headers.get("Content-Type") ?? att.mime_type,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(att.file_name)}`,
        "Cache-Control": "private, max-age=600", "X-Content-Type-Options": "nosniff" } });
    }

    if (req.method === "POST") {
      const form = await req.formData();
      const file = form.get("file");
      const entityType = String(form.get("entity_type") ?? "");
      const refId = String(form.get("ref_id") ?? "");
      if (!(file instanceof File)) return json(400, { error: "Chưa chọn file" });
      if (!UUID_RE.test(refId)) return json(400, { error: "Đối tượng đính kèm không hợp lệ" });
      if (!MIME.has(file.type)) return json(400, { error: `Định dạng ${file.type || "không rõ"} không được phép (ảnh, PDF, Excel, Word, CSV, ZIP, MP4)` });
      const { data: scope, error } = await caller.rpc("attachment_scope", {
        p_entity_type: entityType, p_ref_id: refId, p_visibility: String(form.get("visibility") ?? "customer"),
      });
      if (error || !scope) return json(403, { error: error?.message ?? "Không có quyền đính kèm" });
      if (file.size <= 0 || file.size > Number(scope.max_bytes)) return json(400, { error: `File vượt dung lượng cho phép (${Math.round(Number(scope.max_bytes) / 1048576)} MB)` });
      const token = await googleToken();
      const folder = await ensureFolder(String(scope.folder), token);
      const safe = file.name.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 150);
      const driveId = await uploadToDrive(file, `${scope.label}__${Date.now()}__${safe}`, folder, token);
      const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
      const category = String(form.get("category") ?? "") || null;
      const note = String(form.get("note") ?? "").slice(0, 500) || null;
      const { data: row, error: insErr } = await admin.from("attachments").insert({
        customer_id: scope.customer_id, entity_id: scope.entity_id, entity_type: entityType, entity_ref_id: refId,
        storage_provider: "gdrive", storage_key: driveId, file_name: file.name.slice(0, 250), mime_type: file.type,
        size_bytes: file.size, visibility: scope.visibility, category, note, created_by: me.user.id,
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
