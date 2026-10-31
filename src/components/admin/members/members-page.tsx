"use client";

import { KeyRound, Lock, Pencil, Plus, Sparkle, Trash2, Unlock } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, ErrorState, PageHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { Avatar, Badge } from "@/components/ui/misc";
import { LoadingBlock } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { adminUsers } from "@/lib/admin-users";
import { GENDER_LABEL, vnToday } from "@/lib/format";
import { usePayPeriodSettings } from "@/lib/hooks/use-pay-period";
import { payPeriodRange } from "@/lib/pay-period";
import { useQuery } from "@/lib/hooks/use-query";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { passwordSchema } from "@/lib/validation/schemas";
import type { ProfileRow, ServiceRow } from "@/types/app";
import { useSession } from "../../shared/session-context";
import { MemberDialog } from "./member-dialog";

const EMPTY_MAP = new Map<string, string[]>();
const EMPTY_LIST: ServiceRow[] = [];
const EMPTY_STATS = new Map<string, Stats>();

interface Stats {
  offers: number;
  accepted: number;
  declined: number;
  expired: number;
}

export function MembersPage({ role, embedded }: { role: "technician" | "manager" | "receptionist"; embedded?: boolean }) {
  const me = useSession();
  const isOwner = me.role === "owner";
  const toast = useToast();
  const [editing, setEditing] = useState<ProfileRow | "new" | null>(null);
  const [resetFor, setResetFor] = useState<ProfileRow | null>(null);
  const [lockFor, setLockFor] = useState<ProfileRow | null>(null);
  const [deleteFor, setDeleteFor] = useState<ProfileRow | null>(null);

  // Thống kê lời mời tính từ đầu kỳ lương hiện tại
  const pp = usePayPeriodSettings();
  const periodFrom = pp ? payPeriodRange(pp.currentPeriod, pp.startDay).from : null;

  const query = useQuery(async () => {
    const supabase = getSupabaseBrowser();
    const [m, s, sv, st] = await Promise.all([
      supabase.from("profiles").select("*").eq("role", role).order("is_active", { ascending: false }).order("full_name"),
      supabase.from("technician_skills").select("technician_id, service_id"),
      supabase.from("services").select("*").order("sort_order").order("name"),
      role === "technician" && periodFrom
        ? supabase.rpc("technician_response_stats", { p_from: periodFrom!, p_to: vnToday() })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (m.error) throw m.error;
    const skills = new Map<string, string[]>();
    for (const row of s.data ?? []) skills.set(row.technician_id, [...(skills.get(row.technician_id) ?? []), row.service_id]);
    return {
      members: m.data as ProfileRow[],
      skills,
      services: (sv.data ?? []) as ServiceRow[],
      stats: new Map(((st.data ?? []) as Array<Stats & { technician_id: string }>).map((r) => [r.technician_id, r])),
    };
  }, [role, periodFrom]);
  const { error, refetch: load } = query;
  const members = query.data?.members ?? null;
  const skills = query.data?.skills ?? EMPTY_MAP;
  const services = query.data?.services ?? EMPTY_LIST;
  const stats = query.data?.stats ?? EMPTY_STATS;

  const serviceName = useMemo(() => new Map(services.map((s) => [s.id, s.name])), [services]);
  const label = role === "technician" ? "KTV" : role === "receptionist" ? "lễ tân" : "quản lý";

  const content = (
    <>
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {!members ? (
        <LoadingBlock />
      ) : members.length === 0 ? (
        <EmptyState title={`Chưa có ${label} nào`} hint={isOwner ? `Bấm “Thêm ${label}” để tạo tài khoản.` : undefined} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {members.map((m) => {
            const st = stats.get(m.id);
            const sk = skills.get(m.id) ?? [];
            return (
              <li key={m.id} className="flex flex-col gap-3 rounded-2xl border border-champagne bg-white/80 p-4 shadow-soft">
                <div className="flex items-center gap-3">
                  <Avatar name={m.full_name} src={m.avatar_url} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-espresso">{m.full_name}</p>
                    <p className="text-sm text-mocha">
                      {role === "technician" && m.gender ? `${GENDER_LABEL[m.gender]} · ` : ""}@{m.username}
                      {m.phone ? ` · ${m.phone}` : ""}
                    </p>
                  </div>
                  {m.is_active ? <Badge tone="free">Hoạt động</Badge> : <Badge tone="off">Đã khoá</Badge>}
                </div>
                {role === "technician" ? (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {sk.length === 0 ? (
                        <span className="text-sm text-mocha">Chưa có kỹ năng riêng</span>
                      ) : (
                        sk.map((id) => (
                          <Badge key={id} tone="gold">
                            <Sparkle className="h-3 w-3" /> {serviceName.get(id) ?? "?"}
                          </Badge>
                        ))
                      )}
                    </div>
                    {st ? (
                      <p className="text-sm text-mocha">
                        Kỳ này: {st.offers} lời mời · nhận {st.accepted} ·{" "}
                        <span className={st.declined > 0 ? "font-semibold text-busy-ink" : ""}>từ chối {st.declined}</span> ·{" "}
                        <span className={st.expired > 0 ? "font-semibold text-pending-ink" : ""}>hết giờ {st.expired}</span>
                      </p>
                    ) : null}
                  </>
                ) : null}
                {isOwner ? (
                  <div className="mt-auto flex flex-wrap gap-1.5 border-t border-champagne/60 pt-3">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(m)}>
                      <Pencil className="h-4 w-4" /> Sửa
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setResetFor(m)}>
                      <KeyRound className="h-4 w-4" /> Đặt lại mật khẩu
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setLockFor(m)}>
                      {m.is_active ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                      {m.is_active ? "Khoá" : "Mở khoá"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleteFor(m)} aria-label={`Xoá ${m.full_name}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <MemberDialog
        role={role}
        member={editing === "new" ? null : editing}
        open={editing !== null}
        onOpenChange={(v) => !v && setEditing(null)}
        services={services}
        currentSkills={editing && editing !== "new" ? (skills.get(editing.id) ?? []) : []}
        onSaved={load}
      />
      <ResetPasswordDialog member={resetFor} onClose={() => setResetFor(null)} />
      <ConfirmDialog
        open={!!lockFor}
        onOpenChange={(v) => !v && setLockFor(null)}
        title={lockFor?.is_active ? `Khoá tài khoản ${lockFor?.full_name}?` : `Mở khoá ${lockFor?.full_name}?`}
        description={
          lockFor?.is_active
            ? "Tài khoản bị khoá sẽ không đăng nhập được và không được gợi ý tour. Lịch sử tiền tour vẫn giữ nguyên."
            : "Tài khoản sẽ đăng nhập và nhận tour trở lại."
        }
        confirmLabel={lockFor?.is_active ? "Khoá" : "Mở khoá"}
        tone={lockFor?.is_active ? "danger" : "primary"}
        onConfirm={async () => {
          await adminUsers({ action: "set_active", id: lockFor!.id, active: !lockFor!.is_active });
          toast.success(lockFor!.is_active ? "Đã khoá tài khoản" : "Đã mở khoá tài khoản");
          load();
        }}
      />
      <ConfirmDialog
        open={!!deleteFor}
        onOpenChange={(v) => !v && setDeleteFor(null)}
        title={`Xoá hẳn tài khoản ${deleteFor?.full_name}?`}
        description="Chỉ xoá được tài khoản tạo nhầm (chưa có tour nào). Tài khoản đã làm tour thì hãy dùng Khoá."
        confirmLabel="Xoá hẳn"
        tone="danger"
        onConfirm={async () => {
          await adminUsers({ action: "delete", id: deleteFor!.id });
          toast.success("Đã xoá tài khoản");
          load();
        }}
      />
    </>
  );

  if (embedded) {
    return (
      <Card>
        <CardHeader
          title={role === "receptionist" ? "Tài khoản lễ tân" : "Tài khoản quản lý ca"}
          subtitle={
            role === "receptionist"
              ? "Chỉ dùng Bảng điều phối: tạo & phân tour, sửa / huỷ / hoàn thành tour, vào ca hộ KTV. Không xem tiền tour, thu nhập, chốt lương, KTV, cài đặt"
              : "Được tạo & phân tour, sửa/huỷ tour, gửi thông báo, xem dashboard"
          }
          action={
            isOwner ? (
              <Button size="sm" onClick={() => setEditing("new")}>
                <Plus className="h-4 w-4" /> Thêm {label}
              </Button>
            ) : null
          }
        />
        <CardBody>{content}</CardBody>
      </Card>
    );
  }

  return (
    <div>
      <PageHeader
        title="Kỹ thuật viên"
        subtitle={isOwner ? "Tạo tài khoản, gán kỹ năng, khoá / mở khoá, đặt lại mật khẩu" : "Chỉ chủ spa mới được sửa tài khoản"}
        action={
          isOwner ? (
            <Button onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" /> Thêm KTV
            </Button>
          ) : null
        }
      />
      {content}
    </div>
  );
}

function ResetPasswordDialog({ member, onClose }: { member: ProfileRow | null; onClose: () => void }) {
  if (!member) return null;
  return <ResetPasswordBody key={member.id} member={member} onClose={onClose} />;
}

function ResetPasswordBody({ member, onClose }: { member: ProfileRow; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const p = passwordSchema.safeParse(password);
    if (!p.success) {
      setError(p.error.issues[0].message);
      return;
    }
    setBusy(true);
    try {
      await adminUsers({ action: "reset_password", id: member.id, password });
      toast.success(`Đã đặt lại mật khẩu cho ${member.full_name}`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Đặt lại mật khẩu – ${member.full_name}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Huỷ bỏ
          </Button>
          <Button onClick={save} loading={busy}>
            Lưu mật khẩu
          </Button>
        </>
      }
    >
      <Field label="Mật khẩu tạm mới" required error={error} hint="Báo cho nhân viên và nhắc đổi lại trong mục Tài khoản">
        {(p) => <Input {...p} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />}
      </Field>
    </Dialog>
  );
}
