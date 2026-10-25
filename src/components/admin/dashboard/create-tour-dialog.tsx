"use client";

import { AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";
import { createTourAction, type CreatedTour } from "@/app/actions/tours";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Segmented, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { pickAuto, pickWeightedRandom, type RankedCandidate } from "@/lib/assignment";
import { playAlert } from "@/lib/alerts";
import { ASSIGN_MODE_LABEL, GENDER_LABEL } from "@/lib/format";
import { tourCreateSchema, fieldErrors } from "@/lib/validation/schemas";
import { techStatus, TECH_STATUS_LABEL, type AssignMode, type DashboardTechnician, type Gender } from "@/types/app";
import { useServices } from "../use-dashboard";
import { CandidateList } from "./candidate-list";
import { ServicePicker } from "./service-picker";
import { useRanking } from "./use-ranking";

const MODE_HINT: Record<AssignMode, string> = {
  suggest: "Hiện top 3 KTV phù hợp nhất kèm lý do – bạn bấm chọn để gửi lời mời.",
  auto: "Gửi luôn cho người điểm cao nhất; nếu từ chối / hết giờ thì tự chuyển người kế tiếp.",
  random: "Chọn ngẫu nhiên có trọng số trong nhóm ứng viên tốt – công bằng nhưng không cứng nhắc.",
  requested: "Khách chỉ định KTV. Nếu KTV đang bận, tour sẽ chờ và tự gửi khi KTV đó rảnh.",
};

export function CreateTourDialog(props: Parameters<typeof CreateTourBody>[0]) {
  // Mỗi lần mở là một form mới (không phải reset tay từng ô)
  if (!props.open) return null;
  return <CreateTourBody {...props} />;
}

function CreateTourBody({
  open,
  onOpenChange,
  technicians,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  technicians: DashboardTechnician[];
  onCreated: () => void;
}) {
  const toast = useToast();
  const { services } = useServices();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState<Gender>("female");
  // Khách nam đồng ý để KTV nữ làm (đông khách / khách muốn KTV nữ)
  const [allowFemale, setAllowFemale] = useState(false);
  const allowAnyGender = gender === "male" && allowFemale;
  const [note, setNote] = useState("");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [mode, setMode] = useState<AssignMode>("suggest");
  const [pair, setPair] = useState(false);
  const [requestedId, setRequestedId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [shareA, setShareA] = useState(50);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const needRanking = open && serviceIds.length > 0 && mode !== "requested";
  const ranking = useRanking(
    serviceIds,
    null,
    needRanking || (open && mode === "requested" && pair && serviceIds.length > 0),
    gender,
    allowAnyGender,
  );

  const requestedTech = technicians.find((t) => t.id === requestedId);
  const requestedStatus = requestedTech ? techStatus(requestedTech) : null;

  const offersFor = (ids: string[]) =>
    ids.length === 2
      ? [
          { technician_id: ids[0], share_percent: shareA },
          { technician_id: ids[1], share_percent: 100 - shareA },
        ]
      : ids.map((id) => ({ technician_id: id, share_percent: 100 }));

  const submit = async (offerIds: string[], modeOverride?: AssignMode) => {
    const payload = {
      customer_name: name,
      customer_phone: phone,
      customer_gender: gender,
      allow_any_gender: allowAnyGender,
      note,
      service_ids: serviceIds,
      assign_mode: modeOverride ?? mode,
      team_size: pair ? 2 : 1,
      requested_technician_id: mode === "requested" ? requestedId || null : null,
      offers: offersFor(offerIds),
    };
    const parsed = tourCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return null;
    }
    setErrors({});
    const res = await createTourAction(parsed.data);
    if (!res.ok) {
      if (res.fieldErrors) setErrors(res.fieldErrors);
      toast.error(res.error);
      return null;
    }
    return res.data;
  };

  const report = (tour: CreatedTour) => {
    const sent = tour.offers.filter((o) => !o.queued).length;
    const queued = tour.offers.filter((o) => o.queued);
    if (queued.length) toast.warning(`Tour ${tour.code}: KTV chỉ định đang bận (${queued[0].reason}) – tour sẽ tự gửi khi KTV rảnh`);
    else if (sent) toast.success(`Đã tạo tour ${tour.code} và gửi lời mời`);
    else toast.success(`Đã tạo tour ${tour.code} – đang chờ phân`);
    onCreated();
    onOpenChange(false);
  };

  // Gợi ý – tour 1 KTV: bấm "Gửi" ngay trên dòng ứng viên
  const sendTo = async (c: RankedCandidate) => {
    setBusyId(c.technicianId);
    const tour = await submit([c.technicianId]);
    setBusyId(null);
    if (tour) report(tour);
  };

  const submitMain = async () => {
    if (serviceIds.length === 0) {
      setErrors((e) => ({ ...e, service_ids: "Chọn ít nhất 1 dịch vụ" }));
      toast.error("Chọn dịch vụ trước khi tạo tour");
      return;
    }
    setSubmitting(true);
    try {
      let ids: string[] = [];
      if (mode === "auto" || mode === "random") {
        // tính lại ngay lúc bấm để dùng dữ liệu mới nhất
        const fresh = await ranking.reload();
        if (!fresh) {
          // lỗi tải dữ liệu (mất mạng / hết phiên) – không phải "không có KTV rảnh"
          toast.error("Không tải được danh sách KTV – kiểm tra mạng hoặc đăng nhập lại rồi thử lại");
          return;
        }
        const pick =
          mode === "auto" ? pickAuto(fresh.result) : pickWeightedRandom(fresh.result, fresh.snapshot.settings.randomPoolSize);
        if (pick) ids = [pick.technicianId];
        else {
          playAlert();
          toast.warning("Hiện không có KTV rảnh phù hợp – tour sẽ chờ và tự gửi khi có người rảnh");
        }
      } else if (mode === "requested") {
        ids = pair ? [requestedId, partnerId].filter(Boolean) : [requestedId];
      } else if (pair) {
        ids = selected;
      }
      const tour = await submit(ids);
      if (tour) report(tour);
    } finally {
      setSubmitting(false);
    }
  };

  // Tour chỉ gồm dịch vụ không phân biệt giới tính (tiêm meso, botox, HIFU…)
  const genderFree =
    serviceIds.length > 0 && serviceIds.every((id) => (services ?? []).some((s) => s.id === id && s.any_gender));

  const total = useMemo(
    () => (services ?? []).filter((s) => serviceIds.includes(s.id)).reduce((a, s) => a + s.tour_fee, 0),
    [services, serviceIds],
  );

  const mainLabel =
    mode === "auto"
      ? "Tạo & gửi tự động"
      : mode === "random"
        ? "Tạo & chọn ngẫu nhiên"
        : mode === "requested"
          ? "Tạo tour chỉ định"
          : pair
            ? "Gửi cho 2 KTV đã chọn"
            : "Tạo tour, phân sau";

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Tạo tour mới"
      description={total ? `Tổng tiền tour: ${total.toLocaleString("vi-VN")} ₫` : undefined}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
          <Button
            variant={mode === "suggest" && !pair ? "secondary" : "primary"}
            onClick={submitMain}
            loading={submitting}
            disabled={(mode === "suggest" && pair && selected.length !== 2) || !!busyId}
          >
            {mainLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tên khách" required error={errors.customer_name}>
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="vd: Chị Hương" />}
          </Field>
          <Field label="Số điện thoại" error={errors.customer_phone} hint="Không bắt buộc">
            {(p) => <Input {...p} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />}
          </Field>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-mocha">
            Khách <span className="text-busy-ink">*</span>
          </p>
          <Segmented<Gender>
            ariaLabel="Giới tính khách"
            value={gender}
            onChange={(g) => {
              setGender(g);
              setSelected([]);
            }}
            options={[
              { value: "female", label: "Khách nữ" },
              { value: "male", label: "Khách nam" },
            ]}
          />
          <p className="mt-1 text-sm text-mocha">
            {genderFree
              ? "Dịch vụ chuyên môn không phân biệt giới tính – KTV nam hoặc nữ có kỹ năng đều được."
              : gender === "female"
                ? "Chỉ phân cho KTV nữ."
                : allowAnyGender
                  ? "Khách đồng ý KTV nữ – KTV nam và nữ đều được gợi ý / gửi, chia công bằng như nhau."
                  : "Ưu tiên KTV nam; không còn KTV nam rảnh thì mới gợi ý KTV nữ."}
          </p>
          {gender === "male" && !genderFree ? (
            <div className="mt-2">
              <Checkbox
                checked={allowFemale}
                onChange={(v) => {
                  setAllowFemale(v);
                  setSelected([]);
                }}
                label="Khách đồng ý để KTV nữ làm"
                description="Đông khách hoặc khách muốn KTV nữ. Khách chỉ định đích danh KTV nữ thì dùng chế độ “Khách chỉ định”."
              />
            </div>
          ) : null}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-mocha">
            Dịch vụ <span className="text-busy-ink">*</span>
          </p>
          <ServicePicker
            services={services}
            selected={serviceIds}
            onChange={(ids) => {
              setServiceIds(ids);
              if (ids.length) setErrors((e) => ({ ...e, service_ids: "" }));
            }}
            error={errors.service_ids}
          />
        </div>

        <Field label="Ghi chú" error={errors.note}>
          {(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-16" />}
        </Field>

        <div className="space-y-3 rounded-2xl border border-champagne bg-cream/40 p-4">
          <p className="text-sm font-medium text-mocha">Chế độ phân</p>
          <Segmented<AssignMode>
            ariaLabel="Chế độ phân tour"
            value={mode}
            onChange={setMode}
            options={(["suggest", "auto", "random", "requested"] as AssignMode[]).map((m) => ({
              value: m,
              label: ASSIGN_MODE_LABEL[m],
              disabled: pair && (m === "auto" || m === "random"),
            }))}
          />
          <p className="text-sm text-mocha">{MODE_HINT[mode]}</p>
          {errors.assign_mode ? <p className="text-sm text-busy-ink">{errors.assign_mode}</p> : null}
          <Checkbox
            checked={pair}
            onChange={(v) => {
              setPair(v);
              setSelected([]);
              // Tour 2 KTV không dùng chế độ Tự động / Random
              if (v && (mode === "auto" || mode === "random")) setMode("suggest");
            }}
            label="2 KTV làm chung"
            description="Chọn 2 người và tỷ lệ chia tiền (tổng 100%)"
          />
          {pair ? (
            <div className="flex flex-wrap items-center gap-3">
              <Field label="Tỷ lệ người thứ nhất (%)" className="w-44">
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min={1}
                    max={99}
                    value={shareA}
                    onChange={(e) => setShareA(Math.min(99, Math.max(1, Number(e.target.value) || 50)))}
                  />
                )}
              </Field>
              <p className="pt-6 text-sm text-mocha">Người thứ hai: {100 - shareA}%</p>
              {errors.offers ? <p className="w-full text-sm text-busy-ink">{errors.offers}</p> : null}
            </div>
          ) : null}
        </div>

        {mode === "requested" ? (
          <div className="space-y-3">
            <Field label="KTV khách chỉ định" required error={errors.requested_technician_id}>
              {(p) => (
                <Select {...p} value={requestedId} onChange={(e) => setRequestedId(e.target.value)}>
                  <option value="">— Chọn KTV —</option>
                  {technicians.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.fullName} · {GENDER_LABEL[t.gender]} ({TECH_STATUS_LABEL[techStatus(t)]})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {requestedTech && gender === "female" && requestedTech.gender === "male" && !genderFree ? (
              <p className="flex items-start gap-2 rounded-xl border border-pending/50 bg-pending/10 px-3 py-2 text-sm text-pending-ink">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Khách nữ chỉ định KTV nam – vẫn tạo được vì khách đã chọn.
              </p>
            ) : null}
            {requestedTech && requestedStatus !== "free" ? (
              <p className="flex items-start gap-2 rounded-xl border border-pending/50 bg-pending/10 px-3 py-2 text-sm text-pending-ink">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {requestedTech.fullName} đang {TECH_STATUS_LABEL[requestedStatus!].toLowerCase()} – vẫn tạo được, tour sẽ chờ
                và tự gửi lời mời khi KTV này rảnh.
              </p>
            ) : null}
            {pair ? (
              <Field label="KTV làm cùng">
                {(p) => (
                  <Select {...p} value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                    <option value="">— Chọn KTV thứ hai —</option>
                    {(ranking.result?.candidates ?? [])
                      .filter((c) => c.technicianId !== requestedId)
                      .map((c) => (
                        <option key={c.technicianId} value={c.technicianId}>
                          {c.fullName} · {c.reasons.slice(0, 2).join(" · ")}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
            ) : null}
          </div>
        ) : null}

        {mode === "suggest" ? (
          <div>
            <p className="mb-2 text-sm font-medium text-mocha">{pair ? "Chọn 2 KTV" : "Gợi ý KTV (bấm Gửi để mời)"}</p>
            <CandidateList
              result={ranking.result}
              loading={ranking.loading}
              error={ranking.error}
              onReload={ranking.reload}
              actionLabel="Gửi"
              onAction={pair ? undefined : sendTo}
              actionBusyId={busyId}
              selectable={pair}
              selected={selected}
              max={2}
              onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(0, 2)))}
            />
          </div>
        ) : null}

        {mode === "auto" || mode === "random" ? (
          <div>
            <p className="mb-2 text-sm font-medium text-mocha">Ứng viên hiện tại</p>
            <CandidateList result={ranking.result} loading={ranking.loading} error={ranking.error} onReload={ranking.reload} />
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
