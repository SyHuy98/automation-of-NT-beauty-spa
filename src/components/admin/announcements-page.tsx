"use client";

import { Send } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, ErrorState, PageHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Field, Input, Segmented, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { LoadingBlock } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { errorMessage, formatDateTime } from "@/lib/format";
import { useQuery } from "@/lib/hooks/use-query";
import { useRealtime } from "@/lib/hooks/use-realtime";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { announcementSchema, fieldErrors } from "@/lib/validation/schemas";
import type { ProfileRow } from "@/types/app";

interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  target: string;
  created_at: string;
  author: { full_name: string } | null;
  recipients: Array<{ technician_id: string; read_at: string | null; technician: { full_name: string } | null }>;
}

export function AnnouncementsPage() {
  const toast = useToast();
  const [target, setTarget] = useState<"all" | "individual">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, error, refetch: load } = useQuery(async () => {
    const supabase = getSupabaseBrowser();
    const [t, h] = await Promise.all([
      supabase.from("profiles").select("*").eq("role", "technician").eq("is_active", true).order("full_name"),
      supabase
        .from("announcements")
        .select(
          "id, title, body, target, created_at, author:profiles!announcements_created_by_fkey(full_name), recipients:announcement_recipients(technician_id, read_at, technician:profiles!announcement_recipients_technician_id_fkey(full_name))",
        )
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (h.error) throw h.error;
    return { techs: (t.data ?? []) as ProfileRow[], history: h.data as unknown as AnnouncementRow[] };
  }, []);
  const techs = data?.techs ?? [];
  const history = data?.history ?? null;

  // cập nhật trạng thái đã đọc theo thời gian thực
  useRealtime("admin-announcements", [{ table: "announcement_recipients" }], load, { pollMs: 60_000 });

  const send = async () => {
    const parsed = announcementSchema.safeParse({ title, body, technician_ids: target === "all" ? [] : selected });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    if (target === "individual" && selected.length === 0) {
      setErrors({ technician_ids: "Chọn ít nhất 1 KTV" });
      return;
    }
    setErrors({});
    setBusy(true);
    const { error: err } = await getSupabaseBrowser().rpc("send_announcement", {
      p_title: parsed.data.title,
      p_body: parsed.data.body,
      ...(target === "individual" ? { p_technician_ids: selected } : {}),
    });
    setBusy(false);
    if (err) {
      toast.error(errorMessage(err));
      return;
    }
    toast.success("Đã gửi thông báo");
    setTitle("");
    setBody("");
    setSelected([]);
    load();
  };

  return (
    <div>
      <PageHeader title="Thông báo" subtitle="Gửi cho tất cả KTV hoặc riêng từng người; xem ai đã đọc" />
      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader title="Soạn thông báo" />
          <CardBody className="space-y-4">
            <Segmented
              ariaLabel="Người nhận"
              value={target}
              onChange={setTarget}
              options={[
                { value: "all", label: "Tất cả KTV" },
                { value: "individual", label: "Chọn KTV" },
              ]}
            />
            {target === "individual" ? (
              <div>
                <div className="flex flex-wrap gap-2">
                  {techs.map((t) => {
                    const on = selected.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setSelected((s) => (on ? s.filter((x) => x !== t.id) : [...s, t.id]))}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-sm",
                          on ? "border-gold-strong bg-gold-strong text-white" : "border-champagne bg-white",
                        )}
                      >
                        {t.full_name}
                      </button>
                    );
                  })}
                </div>
                {errors.technician_ids ? <p className="mt-1 text-sm text-busy-ink">{errors.technician_ids}</p> : null}
              </div>
            ) : null}
            <Field label="Tiêu đề" required error={errors.title}>
              {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} />}
            </Field>
            <Field label="Nội dung" required error={errors.body}>
              {(p) => <Textarea {...p} value={body} onChange={(e) => setBody(e.target.value)} className="min-h-32" />}
            </Field>
            <Button className="w-full" onClick={send} loading={busy}>
              <Send className="h-4 w-4" /> Gửi thông báo
            </Button>
          </CardBody>
        </Card>

        <Card className="xl:col-span-3">
          <CardHeader title="Đã gửi" />
          <CardBody>
            {error ? <ErrorState message={error} onRetry={load} /> : null}
            {!history ? (
              <LoadingBlock />
            ) : history.length === 0 ? (
              <EmptyState title="Chưa gửi thông báo nào" />
            ) : (
              <ul className="space-y-3">
                {history.map((a) => {
                  const read = a.recipients.filter((r) => r.read_at);
                  const unread = a.recipients.filter((r) => !r.read_at);
                  const open = expanded === a.id;
                  return (
                    <li key={a.id} className="rounded-2xl border border-champagne bg-white/80 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-espresso">{a.title}</p>
                          <p className="text-xs text-mocha">
                            {formatDateTime(a.created_at)} · {a.author?.full_name ?? "—"} ·{" "}
                            {a.target === "all" ? "Tất cả KTV" : "Gửi riêng"}
                          </p>
                        </div>
                        <button type="button" onClick={() => setExpanded(open ? null : a.id)} aria-expanded={open}>
                          <Badge tone={unread.length === 0 ? "free" : "pending"}>
                            Đã đọc {read.length}/{a.recipients.length}
                          </Badge>
                        </button>
                      </div>
                      <p className="mt-2 whitespace-pre-line text-sm text-espresso">{a.body}</p>
                      {open ? (
                        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                          <div>
                            <p className="font-semibold text-free-ink">Đã đọc</p>
                            {read.map((r) => (
                              <p key={r.technician_id} className="text-mocha">
                                {r.technician?.full_name} · {formatDateTime(r.read_at)}
                              </p>
                            ))}
                          </div>
                          <div>
                            <p className="font-semibold text-pending-ink">Chưa đọc</p>
                            {unread.map((r) => (
                              <p key={r.technician_id} className="text-mocha">
                                {r.technician?.full_name}
                              </p>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
