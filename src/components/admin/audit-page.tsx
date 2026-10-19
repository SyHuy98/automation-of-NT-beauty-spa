"use client";

import { ChevronDown, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, EmptyState, ErrorState, PageHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Field, Input, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { LoadingBlock } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { addDays, errorMessage, formatDateTime, vnToday } from "@/lib/format";
import { useQuery } from "@/lib/hooks/use-query";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { Json } from "@/types/database";
import type { ProfileRow } from "@/types/app";
import { useDebounced, useTourLookup } from "./tour-lookup";

const ACTIONS: Record<string, string> = {
  create: "Tạo tour",
  offer: "Gửi lời mời",
  accept: "KTV nhận",
  decline: "KTV từ chối",
  expire: "Hết giờ",
  withdraw: "Thu hồi lời mời",
  complete: "Hoàn thành",
  edit: "Sửa tour",
  cancel: "Huỷ tour",
  reassign: "Đổi KTV",
  lock_month: "Chốt sổ",
  unlock_month: "Mở sổ",
};
const IMPORTANT = new Set(["edit", "cancel", "reassign", "lock_month", "unlock_month"]);

interface LogRow {
  id: number;
  action: string;
  reason: string | null;
  created_at: string;
  before: Json | null;
  after: Json | null;
  tour_id: string | null;
  tour: { code: string; customer_name: string } | null;
  actor: { full_name: string } | null;
}

const PAGE = 100;

export function AuditPage() {
  const [from, setFrom] = useState(addDays(vnToday(), -6));
  const [to, setTo] = useState(vnToday());
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [code, setCode] = useState("");
  const debCode = useDebounced(code.trim(), 400);
  const [people, setPeople] = useState<ProfileRow[]>([]);
  // Các trang "Xem thêm" đã tải, gắn với bộ lọc hiện tại
  const [more, setMore] = useState<{ key: string; rows: LogRow[]; hasMore: boolean } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const lookup = useTourLookup();
  const toast = useToast();

  useEffect(() => {
    void getSupabaseBrowser()
      .from("profiles")
      .select("*")
      .order("full_name")
      .then(({ data }) => setPeople(data ?? []));
  }, []);

  const fetchPage = useCallback(
    async (offset: number): Promise<LogRow[]> => {
      const supabase = getSupabaseBrowser();
      let tourIds: string[] | null = null;
      if (debCode) {
        const { data } = await supabase.from("tours").select("id").ilike("code", `%${debCode}%`).limit(50);
        tourIds = (data ?? []).map((t) => t.id);
      }
      let q = supabase
        .from("tour_audit_logs")
        .select(
          "id, action, reason, created_at, before, after, tour_id, tour:tours!tour_audit_logs_tour_id_fkey(code, customer_name), actor:profiles!tour_audit_logs_actor_id_fkey(full_name)",
        )
        .gte("created_at", `${from}T00:00:00+07:00`)
        .lt("created_at", `${addDays(to, 1)}T00:00:00+07:00`)
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (action) q = q.eq("action", action);
      if (actor === "system") q = q.is("actor_id", null);
      else if (actor) q = q.eq("actor_id", actor);
      if (tourIds) q = tourIds.length ? q.in("tour_id", tourIds) : q.eq("tour_id", "00000000-0000-0000-0000-000000000000");
      const { data, error: err } = await q;
      if (err) throw err;
      return data as unknown as LogRow[];
    },
    [from, to, action, actor, debCode],
  );

  const filterKey = JSON.stringify([from, to, action, actor, debCode]);
  const first = useQuery(() => fetchPage(0), [from, to, action, actor, debCode]);
  const extra = more?.key === filterKey ? more : null;
  const rows = first.data ? [...first.data, ...(extra?.rows ?? [])] : null;
  const hasMore = extra ? extra.hasMore : first.data?.length === PAGE;
  const error = first.error;

  const reload = () => {
    setMore(null);
    first.refetch();
  };

  const loadMore = async () => {
    if (!rows) return;
    setLoadingMore(true);
    try {
      const list = await fetchPage(rows.length);
      setMore({ key: filterKey, rows: [...(extra?.rows ?? []), ...list], hasMore: list.length === PAGE });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div>
      <PageHeader title="Nhật ký thao tác" subtitle="Ai làm gì, lúc nào, trước / sau ra sao. Bấm mã tour để mở và sửa tour." />
      <Card className="mb-4">
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Từ ngày">{(p) => <Input {...p} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label="Đến ngày">{(p) => <Input {...p} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
          <Field label="Hành động">
            {(p) => (
              <Select {...p} value={action} onChange={(e) => setAction(e.target.value)}>
                <option value="">Tất cả</option>
                {Object.entries(ACTIONS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Người thực hiện">
            {(p) => (
              <Select {...p} value={actor} onChange={(e) => setActor(e.target.value)}>
                <option value="">Tất cả</option>
                <option value="system">Hệ thống</option>
                {people.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.full_name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Mã tour">
            {(p) => (
              <div className="flex gap-2">
                <Input {...p} value={code} onChange={(e) => setCode(e.target.value)} placeholder="T-2026…" />
                <Button variant="secondary" size="icon" onClick={() => code.trim() && lookup.open({ code: code.trim() })} aria-label="Mở tour">
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            )}
          </Field>
        </CardBody>
      </Card>

      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {!rows ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState title="Không có thao tác nào trong khoảng này" />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-champagne/60">
            {rows.map((r) => {
              const open = expanded === r.id;
              const hasDiff = r.before || (r.after && IMPORTANT.has(r.action));
              return (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="tabular text-mocha">{formatDateTime(r.created_at)}</span>
                    <Badge tone={IMPORTANT.has(r.action) ? "busy" : r.action === "decline" || r.action === "expire" ? "pending" : "neutral"}>
                      {ACTIONS[r.action] ?? r.action}
                    </Badge>
                    {r.tour ? (
                      <button
                        type="button"
                        onClick={() => r.tour_id && lookup.open({ id: r.tour_id })}
                        className="font-semibold text-gold-strong underline-offset-2 hover:underline"
                      >
                        {r.tour.code}
                      </button>
                    ) : null}
                    {r.tour ? <span className="text-espresso">{r.tour.customer_name}</span> : null}
                    <span className="text-mocha">· {r.actor?.full_name ?? "Hệ thống"}</span>
                    {hasDiff ? (
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : r.id)}
                        className="ml-auto inline-flex items-center gap-1 text-sm text-mocha"
                        aria-expanded={open}
                      >
                        Trước / sau <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
                      </button>
                    ) : null}
                  </div>
                  {r.reason ? <p className="mt-1 text-sm text-espresso">Lý do: {r.reason}</p> : null}
                  {open ? (
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <JsonBox title="Trước" value={r.before} />
                      <JsonBox title="Sau" value={r.after} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {hasMore ? (
            <div className="border-t border-champagne/60 p-3 text-center">
              <Button variant="ghost" onClick={loadMore} loading={loadingMore}>
                Xem thêm
              </Button>
            </div>
          ) : null}
        </Card>
      )}
      {lookup.dialog(reload)}
    </div>
  );
}

function JsonBox({ title, value }: { title: string; value: Json | null }) {
  return (
    <div className="rounded-xl border border-champagne bg-cream/40 p-3">
      <p className="mb-1 text-xs font-semibold uppercase text-mocha">{title}</p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-espresso">
        {value ? JSON.stringify(value, null, 2) : "—"}
      </pre>
    </div>
  );
}
