"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase, q } from "./supabase";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

export type Attachment = { id: string; file_name: string; mime_type: string; size_bytes: number; visibility: string; category: string | null; note: string | null; created_at: string; created_by: string | null; entity_type: string; entity_ref_id: string };
const FN = `${SUPABASE_URL}/functions/v1/drive-files`;

async function token() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Phiên đăng nhập đã hết, đăng nhập lại.");
  return data.session.access_token;
}

// Ảnh lớn được thu nhỏ trước khi tải (≤ 2000px, JPEG 85%) → nhanh hơn, tiết kiệm Drive
async function shrink(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 600_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.(png|webp)$/i, ".jpg"), { type: "image/jpeg" });
  } catch { return file; }
}

export async function uploadFile(file: File, entityType: string, refId: string, opt: { visibility?: "customer" | "internal"; category?: string; note?: string } = {}) {
  const f = await shrink(file);
  const fd = new FormData();
  fd.append("file", f); fd.append("entity_type", entityType); fd.append("ref_id", refId);
  fd.append("visibility", opt.visibility ?? "customer");
  if (opt.category) fd.append("category", opt.category);
  if (opt.note) fd.append("note", opt.note);
  const res = await fetch(FN, { method: "POST", headers: { Authorization: `Bearer ${await token()}`, apikey: SUPABASE_ANON_KEY }, body: fd });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? "Tải file thất bại");
  return j as Attachment;
}

export async function fileBlobUrl(id: string, thumb = false) {
  const res = await fetch(`${FN}?id=${id}${thumb ? "&thumb=1" : ""}`, { headers: { Authorization: `Bearer ${await token()}`, apikey: SUPABASE_ANON_KEY } });
  if (!res.ok) throw new Error("Không mở được file");
  return URL.createObjectURL(await res.blob());
}
export const useFileUrl = (id: string, thumb = false, enabled = true) =>
  useQuery({ queryKey: ["file-url", id, thumb], enabled, staleTime: 30 * 60_000, gcTime: 30 * 60_000, retry: 1, queryFn: () => fileBlobUrl(id, thumb) });

export const useAttachments = (entityType: string, refIds: string[]) =>
  useQuery({
    queryKey: ["attachments", entityType, ...refIds], enabled: refIds.length > 0,
    queryFn: () => q<Attachment[]>(supabase.from("attachments").select("id, file_name, mime_type, size_bytes, visibility, category, note, created_at, created_by, entity_type, entity_ref_id")
      .eq("entity_type", entityType).in("entity_ref_id", refIds).is("deleted_at", null).order("created_at")),
  });

export const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
