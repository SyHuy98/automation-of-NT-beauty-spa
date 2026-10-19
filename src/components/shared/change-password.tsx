"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/format";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { passwordSchema } from "@/lib/validation/schemas";
import { useSession } from "./session-context";

export function ChangePasswordForm() {
  const me = useSession();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!current) errs.current = "Nhập mật khẩu hiện tại";
    const p = passwordSchema.safeParse(next);
    if (!p.success) errs.next = p.error.issues[0].message;
    if (next !== confirm) errs.confirm = "Mật khẩu nhập lại không khớp";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    const supabase = getSupabaseBrowser();
    // Xác thực mật khẩu cũ trước khi đổi
    const { error: signErr } = await supabase.auth.signInWithPassword({ email: `${me.username}@ntspa.local`, password: current });
    if (signErr) {
      setBusy(false);
      setErrors({ current: "Mật khẩu hiện tại không đúng" });
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: next });
    setBusy(false);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    toast.success("Đã đổi mật khẩu");
  };

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <Field label="Mật khẩu hiện tại" error={errors.current}>
        {(p) => <Input {...p} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}
      </Field>
      <Field label="Mật khẩu mới" error={errors.next} hint="Tối thiểu 6 ký tự">
        {(p) => <Input {...p} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
      </Field>
      <Field label="Nhập lại mật khẩu mới" error={errors.confirm}>
        {(p) => <Input {...p} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
      </Field>
      <Button type="submit" className="w-full" loading={busy}>
        Đổi mật khẩu
      </Button>
    </form>
  );
}
