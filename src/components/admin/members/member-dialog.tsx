"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { adminUsers } from "@/lib/admin-users";
import { errorMessage } from "@/lib/format";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { fieldErrors, memberCreateSchema, memberUpdateSchema } from "@/lib/validation/schemas";
import type { ProfileRow, ServiceRow, ShiftType } from "@/types/app";

export function MemberDialog(props: Parameters<typeof MemberDialogBody>[0]) {
  if (!props.open) return null;
  // key: mỗi lần mở / đổi người → form khởi tạo lại từ dữ liệu mới
  return <MemberDialogBody key={props.member?.id ?? "new"} {...props} />;
}

function MemberDialogBody({
  role,
  member,
  open,
  onOpenChange,
  services,
  currentSkills,
  onSaved,
}: {
  role: "technician" | "manager";
  member: ProfileRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  services: ServiceRow[];
  currentSkills: string[];
  onSaved: () => void;
}) {
  const toast = useToast();
  const [fullName, setFullName] = useState(member?.full_name ?? "");
  const [username, setUsername] = useState(member?.username ?? "");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState(member?.phone ?? "");
  const [skillIds, setSkillIds] = useState<string[]>(currentSkills);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const isNew = !member;
  const skillServices = services.filter((s) => s.requires_skill);

  const save = async () => {
    setBusy(true);
    try {
      if (isNew) {
        const parsed = memberCreateSchema.safeParse({
          full_name: fullName,
          username,
          password,
          phone,
          role,
          skill_ids: role === "technician" ? skillIds : [],
        });
        if (!parsed.success) {
          setErrors(fieldErrors(parsed.error));
          return;
        }
        await adminUsers({ action: "create", ...parsed.data, phone: parsed.data.phone || undefined });
        toast.success(`Đã tạo tài khoản ${parsed.data.username}`);
      } else {
        const parsed = memberUpdateSchema.safeParse({ full_name: fullName, phone, skill_ids: skillIds });
        if (!parsed.success) {
          setErrors(fieldErrors(parsed.error));
          return;
        }
        const { error } = await getSupabaseBrowser().rpc("update_member_profile", {
          p_id: member.id,
          p_full_name: parsed.data.full_name,
          p_phone: parsed.data.phone,
          // ca làm xác định theo từng ngày (Lịch ca / lúc vào ca), không lưu ở hồ sơ
          p_shift: null as unknown as ShiftType,
          p_skill_ids: role === "technician" ? parsed.data.skill_ids : (null as unknown as string[]),
        });
        if (error) throw new Error(errorMessage(error));
        toast.success("Đã lưu thay đổi");
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setErrors({ _: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const title = isNew ? (role === "technician" ? "Thêm Kỹ thuật viên" : "Thêm tài khoản quản lý") : `Sửa ${member?.full_name}`;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Huỷ bỏ
          </Button>
          <Button onClick={save} loading={busy}>
            {isNew ? "Tạo tài khoản" : "Lưu"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Họ tên" required error={errors.full_name}>
            {(p) => <Input {...p} value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />}
          </Field>
          <Field label="Số điện thoại" error={errors.phone}>
            {(p) => <Input {...p} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />}
          </Field>
          <Field
            label="Tên đăng nhập"
            required
            error={errors.username}
            hint={isNew ? "Chữ thường không dấu, vd: lan.nguyen" : "Không đổi được tên đăng nhập"}
          >
            {(p) => (
              <Input
                {...p}
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                disabled={!isNew}
                autoCapitalize="none"
                autoComplete="off"
              />
            )}
          </Field>
          {isNew ? (
            <Field label="Mật khẩu tạm" required error={errors.password} hint="Tối thiểu 6 ký tự">
              {(p) => <Input {...p} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />}
            </Field>
          ) : null}
        </div>

        {role === "technician" ? (
          <div>
            <p className="mb-1 text-sm font-medium text-mocha">Kỹ năng riêng</p>
            {skillServices.length === 0 ? (
              <p className="text-sm text-mocha">Chưa có dịch vụ nào đánh dấu “cần kỹ năng riêng”. Mọi dịch vụ thường KTV nào cũng làm được.</p>
            ) : (
              <div className="grid gap-1 sm:grid-cols-2">
                {skillServices.map((s) => (
                  <Checkbox
                    key={s.id}
                    checked={skillIds.includes(s.id)}
                    onChange={(v) => setSkillIds((ids) => (v ? [...ids, s.id] : ids.filter((x) => x !== s.id)))}
                    label={s.name}
                  />
                ))}
              </div>
            )}
          </div>
        ) : null}
        {errors._ ? (
          <p role="alert" className="rounded-xl border border-busy/40 bg-busy/5 px-3 py-2 text-sm text-busy-ink">
            {errors._}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
