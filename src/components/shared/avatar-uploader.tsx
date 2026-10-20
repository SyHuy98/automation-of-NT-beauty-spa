"use client";

import { Camera, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/misc";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { removeAvatar, uploadAvatar } from "@/lib/avatar";

/**
 * Đổi ảnh đại diện: bấm vào ảnh (hoặc nút) để chọn ảnh / chụp ảnh mới.
 * Dùng cho chính mình (KTV, quản lý) và cho chủ spa đổi ảnh của nhân viên.
 */
export function AvatarUploader({
  userId,
  name,
  url,
  onChanged,
}: {
  userId: string;
  name: string;
  url: string | null;
  onChanged?: (url: string | null) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState(url);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);

  const done = (next: string | null, message: string) => {
    setCurrent(next);
    onChanged?.(next);
    toast.success(message);
    // làm mới dữ liệu phiên (ảnh ở thanh menu, trang chính…)
    router.refresh();
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy("upload");
    try {
      done(await uploadAvatar(userId, file), "Đã đổi ảnh đại diện");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };

  const onRemove = async () => {
    setBusy("remove");
    try {
      await removeAvatar(userId);
      done(null, "Đã xoá ảnh đại diện");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={!!busy}
        className="relative rounded-full"
        aria-label="Đổi ảnh đại diện"
      >
        <Avatar name={name} src={current} size="xl" />
        <span className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-ivory bg-gold-strong text-white shadow-soft">
          {busy === "upload" ? <Spinner className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
        </span>
      </button>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => input.current?.click()} loading={busy === "upload"} disabled={!!busy}>
            <Camera className="h-4 w-4" /> {current ? "Đổi ảnh" : "Thêm ảnh"}
          </Button>
          {current ? (
            <Button size="sm" variant="ghost" onClick={onRemove} loading={busy === "remove"} disabled={!!busy}>
              <Trash2 className="h-4 w-4" /> Xoá ảnh
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-mocha">Ảnh sẽ được cắt vuông và nén tự động.</p>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => onFile(e.target.files?.[0])}
      />
    </div>
  );
}
