"use client";

import { useState, type ReactNode } from "react";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { Field, Textarea } from "./form";

/**
 * Hộp xác nhận; nếu `requireReason` thì bắt buộc nhập lý do (ghi vào nhật ký).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Xác nhận",
  tone = "primary",
  requireReason,
  reasonLabel = "Lý do",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: "primary" | "danger" | "success";
  requireReason?: boolean;
  reasonLabel?: string;
  onConfirm: (reason: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (requireReason && reason.trim().length < 3) {
      setError("Vui lòng nhập lý do (ít nhất 3 ký tự)");
      return;
    }
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      setReason("");
      setError(undefined);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!busy) onOpenChange(v);
      }}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Huỷ bỏ
          </Button>
          <Button variant={tone} onClick={submit} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description ? <div className="text-[15px] text-mocha">{description}</div> : null}
      {requireReason ? (
        <Field label={reasonLabel} required error={error} className="mt-4">
          {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}
        </Field>
      ) : error ? (
        <p className="mt-3 text-sm text-busy-ink">{error}</p>
      ) : null}
    </Dialog>
  );
}
