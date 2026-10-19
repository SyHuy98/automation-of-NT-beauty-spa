"use client";

import { Eye, EyeOff, Pencil, Plus, Sparkle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, EmptyState, ErrorState, PageHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { Badge, Money } from "@/components/ui/misc";
import { LoadingBlock } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/format";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { fieldErrors, serviceSchema } from "@/lib/validation/schemas";
import type { ServiceRow } from "@/types/app";
import { useSession } from "../shared/session-context";
import { useServices } from "./use-dashboard";

export function ServicesPage() {
  const me = useSession();
  const isOwner = me.role === "owner";
  const toast = useToast();
  const { services, error, reload } = useServices(true);
  const [editing, setEditing] = useState<ServiceRow | "new" | null>(null);

  const toggleActive = async (s: ServiceRow) => {
    const { error: err } = await getSupabaseBrowser().from("services").update({ is_active: !s.is_active }).eq("id", s.id);
    if (err) toast.error(errorMessage(err));
    else {
      toast.success(s.is_active ? `Đã ẩn “${s.name}”` : `Đã hiện lại “${s.name}”`);
      void reload();
    }
  };

  return (
    <div>
      <PageHeader
        title="Bảng giá dịch vụ"
        subtitle="Tiền tour chung cho mọi KTV. Đổi giá không ảnh hưởng tour đã tạo (giá được chụp lại lúc tạo tour)."
        action={
          isOwner ? (
            <Button onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" /> Thêm dịch vụ
            </Button>
          ) : null
        }
      />
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {!services ? (
        <LoadingBlock />
      ) : services.length === 0 ? (
        <Card>
          <EmptyState title="Chưa có dịch vụ nào" hint={isOwner ? "Bấm “Thêm dịch vụ” để nhập bảng giá tiền tour." : "Chủ spa chưa nhập bảng giá."} />
        </Card>
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-champagne bg-cream/60 text-mocha">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Dịch vụ</th>
                    <th className="px-4 py-3 text-right font-semibold">Tiền tour</th>
                    <th className="px-4 py-3 text-right font-semibold">Thời lượng</th>
                    <th className="px-4 py-3 font-semibold">Trạng thái</th>
                    <th className="px-4 py-3 text-right font-semibold">Thứ tự</th>
                    {isOwner ? <th className="px-4 py-3" /> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-champagne/60">
                  {services.map((s) => (
                    <tr key={s.id} className={cn(!s.is_active && "opacity-60")}>
                      <td className="px-4 py-3">
                        <span className="font-medium text-espresso">{s.name}</span>
                        {s.requires_skill ? (
                          <Badge tone="gold" className="ml-2">
                            <Sparkle className="h-3 w-3" /> Cần kỹ năng
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Money value={s.tour_fee} className="font-semibold" />
                      </td>
                      <td className="px-4 py-3 text-right tabular">{s.duration_minutes} phút</td>
                      <td className="px-4 py-3">{s.is_active ? <Badge tone="free">Đang dùng</Badge> : <Badge tone="off">Đã ẩn</Badge>}</td>
                      <td className="px-4 py-3 text-right tabular">{s.sort_order}</td>
                      {isOwner ? (
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setEditing(s)} aria-label={`Sửa ${s.name}`}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => toggleActive(s)}
                              aria-label={s.is_active ? `Ẩn ${s.name}` : `Hiện ${s.name}`}
                            >
                              {s.is_active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}
      <ServiceDialog
        service={editing === "new" ? null : editing}
        open={editing !== null}
        onOpenChange={(v) => !v && setEditing(null)}
        nextOrder={(services?.length ?? 0) + 1}
        onSaved={reload}
      />
    </div>
  );
}

function ServiceDialog(props: Parameters<typeof ServiceDialogBody>[0]) {
  if (!props.open) return null;
  return <ServiceDialogBody key={props.service?.id ?? "new"} {...props} />;
}

function ServiceDialogBody({
  service,
  open,
  onOpenChange,
  nextOrder,
  onSaved,
}: {
  service: ServiceRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  nextOrder: number;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(service?.name ?? "");
  const [fee, setFee] = useState(service ? String(service.tour_fee) : "");
  const [duration, setDuration] = useState(service ? String(service.duration_minutes) : "60");
  const [requiresSkill, setRequiresSkill] = useState(service?.requires_skill ?? false);
  const [order, setOrder] = useState(String(service?.sort_order ?? nextOrder));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const parsed = serviceSchema.safeParse({
      name,
      tour_fee: fee.replace(/[.,\s₫]/g, ""),
      duration_minutes: duration,
      requires_skill: requiresSkill,
      sort_order: order || 0,
    });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setBusy(true);
    const supabase = getSupabaseBrowser();
    const { error } = service
      ? await supabase.from("services").update(parsed.data).eq("id", service.id)
      : await supabase.from("services").insert(parsed.data);
    setBusy(false);
    if (error) {
      setErrors({ _: errorMessage(error) });
      return;
    }
    toast.success(service ? "Đã cập nhật dịch vụ" : "Đã thêm dịch vụ");
    onOpenChange(false);
    onSaved();
  };

  const feePreview = Number(fee.replace(/[.,\s₫]/g, ""));

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={service ? `Sửa “${service.name}”` : "Thêm dịch vụ"}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Huỷ bỏ
          </Button>
          <Button onClick={save} loading={busy}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tên dịch vụ" required error={errors.name}>
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="vd: Triệt lông nách Diode Laser" />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Tiền tour (₫)"
            required
            error={errors.tour_fee}
            hint={Number.isFinite(feePreview) && feePreview > 0 ? <Money value={feePreview} /> : undefined}
          >
            {(p) => <Input {...p} value={fee} onChange={(e) => setFee(e.target.value)} inputMode="numeric" placeholder="50000" />}
          </Field>
          <Field label="Thời lượng (phút)" required error={errors.duration_minutes}>
            {(p) => <Input {...p} value={duration} onChange={(e) => setDuration(e.target.value)} inputMode="numeric" />}
          </Field>
        </div>
        <Field label="Thứ tự hiển thị" error={errors.sort_order}>
          {(p) => <Input {...p} value={order} onChange={(e) => setOrder(e.target.value)} inputMode="numeric" />}
        </Field>
        <Checkbox
          checked={requiresSkill}
          onChange={setRequiresSkill}
          label="Cần kỹ năng riêng"
          description="Chỉ KTV được gán kỹ năng này mới được gợi ý (vd: HIFU, tiêm)"
        />
        {errors._ ? <p className="text-sm text-busy-ink">{errors._}</p> : null}
      </div>
    </Dialog>
  );
}
