"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, ErrorState, PageHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { LoadingBlock } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { DEFAULT_WEIGHTS } from "@/lib/assignment";
import { errorMessage, SHIFT_LABEL } from "@/lib/format";
import { useQuery } from "@/lib/hooks/use-query";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { fieldErrors, settingsSchema } from "@/lib/validation/schemas";
import type { Json } from "@/types/database";
import { ChangePasswordForm } from "../shared/change-password";
import { PushToggle } from "../shared/push-toggle";
import { MembersPage } from "./members/members-page";

type Shift = "morning" | "afternoon" | "full";
const WEIGHT_LABEL: Record<keyof typeof DEFAULT_WEIGHTS, string> = {
  today: "Thu nhập hôm nay (yếu tố chính)",
  month: "Thu nhập tháng so với TB nhóm",
  requested: "Phạt lệch do tour chỉ định",
  idle: "Thời gian rảnh",
  shiftEnd: "Phạt gần hết ca",
  declines: "Phạt từ chối nhiều",
};

interface FormState {
  offer_timeout_seconds: string;
  shift_hours: Record<Shift, { start: string; end: string }>;
  weights: Record<keyof typeof DEFAULT_WEIGHTS, string>;
  requested_threshold_percent: string;
  imbalance_threshold_percent: string;
  random_pool_size: string;
  decline_reasons: string[];
}

export function SettingsPage() {
  const toast = useToast();
  // Bản đang sửa; null = chưa sửa gì → hiển thị đúng dữ liệu đã lưu
  const [edited, setEdited] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const query = useQuery(async (): Promise<FormState> => {
    const { data, error } = await getSupabaseBrowser().from("app_settings").select("*").single();
    if (error) throw error;
    const sh = data.shift_hours as FormState["shift_hours"];
    const w = { ...DEFAULT_WEIGHTS, ...(data.weights as Record<string, number>) };
    return {
      offer_timeout_seconds: String(data.offer_timeout_seconds),
      shift_hours: {
        morning: sh.morning ?? { start: "09:00", end: "18:00" },
        afternoon: sh.afternoon ?? { start: "12:00", end: "21:00" },
        full: sh.full ?? { start: "09:00", end: "21:00" },
      },
      weights: Object.fromEntries(Object.entries(w).map(([k, v]) => [k, String(v)])) as FormState["weights"],
      requested_threshold_percent: String(data.requested_threshold_percent),
      imbalance_threshold_percent: String(data.imbalance_threshold_percent),
      random_pool_size: String(data.random_pool_size),
      decline_reasons: data.decline_reasons,
    };
  }, []);
  const { error: loadError, refetch: load } = query;
  const form = edited ?? query.data;

  const save = async () => {
    if (!form) return;
    const parsed = settingsSchema.safeParse({ ...form, decline_reasons: form.decline_reasons.filter((r) => r.trim()) });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      toast.error("Có ô nhập chưa hợp lệ");
      return;
    }
    setErrors({});
    setBusy(true);
    const { error } = await getSupabaseBrowser()
      .from("app_settings")
      .update({
        ...parsed.data,
        shift_hours: parsed.data.shift_hours as unknown as Json,
        weights: parsed.data.weights as unknown as Json,
      })
      .eq("id", true);
    setBusy(false);
    if (error) toast.error(errorMessage(error));
    else toast.success("Đã lưu cài đặt");
  };

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setEdited((f) => {
    const base = f ?? query.data;
    return base ? { ...base, [k]: v } : f;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cài đặt"
        subtitle="Chỉ chủ spa"
        action={
          <Button onClick={save} loading={busy} disabled={!form}>
            Lưu cài đặt
          </Button>
        }
      />
      {loadError ? <ErrorState message={loadError} onRetry={load} /> : null}
      {!form ? (
        <LoadingBlock />
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader title="Phân tour" />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Thời gian chờ KTV phản hồi (giây)" error={errors.offer_timeout_seconds} hint="30–900 giây, mặc định 120">
                {(p) => <Input {...p} inputMode="numeric" value={form.offer_timeout_seconds} onChange={(e) => set("offer_timeout_seconds", e.target.value)} />}
              </Field>
              <Field label="Số ứng viên vào vòng Random" error={errors.random_pool_size} hint="Chọn ngẫu nhiên trong top N">
                {(p) => <Input {...p} inputMode="numeric" value={form.random_pool_size} onChange={(e) => set("random_pool_size", e.target.value)} />}
              </Field>
              <Field label="Ngưỡng lệch do tour chỉ định (%)" error={errors.requested_threshold_percent} hint="Vượt TB nhóm quá ngưỡng thì giảm ưu tiên tour thường">
                {(p) => (
                  <Input {...p} inputMode="numeric" value={form.requested_threshold_percent} onChange={(e) => set("requested_threshold_percent", e.target.value)} />
                )}
              </Field>
              <Field label="Ngưỡng cảnh báo lệch thu nhập (%)" error={errors.imbalance_threshold_percent} hint="Đánh dấu trên biểu đồ cân bằng">
                {(p) => (
                  <Input {...p} inputMode="numeric" value={form.imbalance_threshold_percent} onChange={(e) => set("imbalance_threshold_percent", e.target.value)} />
                )}
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Giờ ca" />
            <CardBody className="space-y-3">
              {(["morning", "afternoon", "full"] as Shift[]).map((s) => (
                <div key={s} className="grid grid-cols-[110px_1fr_1fr] items-end gap-3">
                  <p className="pb-3 text-sm font-medium text-espresso">{SHIFT_LABEL[s]}</p>
                  <Field label="Bắt đầu" error={errors[`shift_hours.${s}.start`]}>
                    {(p) => (
                      <Input
                        {...p}
                        type="time"
                        value={form.shift_hours[s].start}
                        onChange={(e) => set("shift_hours", { ...form.shift_hours, [s]: { ...form.shift_hours[s], start: e.target.value } })}
                      />
                    )}
                  </Field>
                  <Field label="Kết thúc" error={errors[`shift_hours.${s}.end`]}>
                    {(p) => (
                      <Input
                        {...p}
                        type="time"
                        value={form.shift_hours[s].end}
                        onChange={(e) => set("shift_hours", { ...form.shift_hours, [s]: { ...form.shift_hours[s], end: e.target.value } })}
                      />
                    )}
                  </Field>
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Trọng số thuật toán gợi ý" subtitle="Số càng lớn yếu tố càng quan trọng. Mặc định đã cân đối sẵn." />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              {(Object.keys(WEIGHT_LABEL) as Array<keyof typeof DEFAULT_WEIGHTS>).map((k) => (
                <Field key={k} label={WEIGHT_LABEL[k]} error={errors[`weights.${k}`]} hint={`Mặc định ${DEFAULT_WEIGHTS[k]}`}>
                  {(p) => (
                    <Input {...p} inputMode="decimal" value={form.weights[k]} onChange={(e) => set("weights", { ...form.weights, [k]: e.target.value })} />
                  )}
                </Field>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Lý do từ chối" subtitle="Lý do bắt đầu bằng “Khác” sẽ yêu cầu KTV ghi rõ" />
            <CardBody className="space-y-2">
              {form.decline_reasons.map((r, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={r}
                    aria-label={`Lý do ${i + 1}`}
                    onChange={(e) => set("decline_reasons", form.decline_reasons.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Xoá lý do"
                    onClick={() => set("decline_reasons", form.decline_reasons.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {errors.decline_reasons ? <p className="text-sm text-busy-ink">{errors.decline_reasons}</p> : null}
              <Button variant="secondary" size="sm" onClick={() => set("decline_reasons", [...form.decline_reasons, ""])}>
                <Plus className="h-4 w-4" /> Thêm lý do
              </Button>
            </CardBody>
          </Card>
        </div>
      )}

      <MembersPage role="manager" embedded />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Đổi mật khẩu của bạn" />
          <CardBody>
            <ChangePasswordForm />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Thông báo đẩy trên thiết bị này" subtitle="Admin nhận cảnh báo qua âm thanh khi đang mở bảng điều phối" />
          <CardBody>
            <PushToggle />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
