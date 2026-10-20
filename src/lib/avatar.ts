"use client";

import { getSupabaseBrowser } from "@/lib/supabase/client";

const BUCKET = "avatars";
const SIZE = 384; // ảnh vuông 384×384 – đủ nét cho màn hình retina, nhẹ (~30–60KB)
const MAX_INPUT_BYTES = 15 * 1024 * 1024;

/** Cắt giữa thành hình vuông, thu nhỏ và nén JPEG ngay trên điện thoại trước khi tải lên */
async function toSquareJpeg(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Vui lòng chọn file ảnh");
  if (file.size > MAX_INPUT_BYTES) throw new Error("Ảnh quá lớn (tối đa 15MB)");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Không đọc được ảnh này. Hãy chọn ảnh JPG hoặc PNG");
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Trình duyệt không hỗ trợ xử lý ảnh");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("Không xử lý được ảnh");
  return blob;
}

/** Xoá các ảnh cũ trong thư mục của người dùng, trừ file `keep` */
async function removeOld(userId: string, keep?: string) {
  const storage = getSupabaseBrowser().storage.from(BUCKET);
  const { data } = await storage.list(userId);
  const old = (data ?? []).map((f) => `${userId}/${f.name}`).filter((p) => p !== keep);
  if (old.length) await storage.remove(old);
}

/** Tải ảnh mới lên Storage rồi lưu link vào hồ sơ. Trả về link ảnh. */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const blob = await toSquareJpeg(file);
  const supabase = getSupabaseBrowser();
  // tên file mới mỗi lần để trình duyệt / CDN không giữ ảnh cũ trong cache
  const path = `${userId}/${Date.now()}.jpg`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: "image/jpeg",
    cacheControl: "31536000",
    upsert: false,
  });
  if (upErr) throw new Error(`Không tải được ảnh lên: ${upErr.message}`);

  const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const { error } = await supabase.rpc("set_avatar", { p_user_id: userId, p_avatar_url: url });
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(error.message);
  }
  await removeOld(userId, path).catch(() => undefined);
  return url;
}

export async function removeAvatar(userId: string): Promise<void> {
  const { error } = await getSupabaseBrowser().rpc("set_avatar", {
    p_user_id: userId,
    p_avatar_url: null as unknown as string,
  });
  if (error) throw new Error(error.message);
  await removeOld(userId).catch(() => undefined);
}
