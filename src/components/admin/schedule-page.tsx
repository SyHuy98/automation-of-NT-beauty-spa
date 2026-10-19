"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, ErrorState, PageHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { LoadingBlock } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { addDays, errorMessage, formatDate, formatWeekday, SHIFT_LABEL, vnToday } from "@/lib/format";
import { useQuery } from "@/lib/hooks/use-query";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { ProfileRow, ShiftType } from "@/types/app";

const CYCLE: ShiftType[] = ["morning", "afternoon", "full", "off"];
const TONE: Record<ShiftType, string> = {
  morning: "bg-champagne/60 text-gold-stronger border-gold/50",
  afternoon: "bg-[#e9dccb] text-mocha border-taupe/60",
  full: "bg-gold-strong text-white border-gold-strong",
  off: "bg-white text-off-ink border-off/40",
};

/** Lịch ca theo tuần: bấm vào ô để đổi Sáng → Chiều → Full → Nghỉ */
export function SchedulePage() {
  const toast = useToast();
  const [weekStart, setWeekStart] = useState(() => mondayOf(vnToday()));
  // Ô vừa bấm đổi (hiển thị ngay, chưa cần chờ tải lại)
  const [overrides, setOverrides] = useState<Map<string, ShiftType>>(new Map());
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const query = useQuery(async () => {
    const supabase = getSupabaseBrowser();
    const [t, s] = await Promise.all([
      supabase.from("profiles").select("*").eq("role", "technician").eq("is_active", true).order("full_name"),
      supabase.from("shift_schedules").select("technician_id, work_date, shift").gte("work_date", days[0]).lte("work_date", days[6]),
    ]);
    if (t.error) throw t.error;
    return {
      techs: t.data as ProfileRow[],
      schedule: new Map((s.data ?? []).map((r) => [`${r.technician_id}|${r.work_date}`, r.shift as ShiftType])),
    };
  }, [days]);
  const { error, refetch: load } = query;
  const techs = query.data?.techs ?? null;
  const schedule = useMemo(() => new Map([...(query.data?.schedule ?? []), ...overrides]), [query.data, overrides]);

  const cycle = async (tech: ProfileRow, day: string) => {
    const key = `${tech.id}|${day}`;
    const current = schedule.get(key) ?? tech.shift;
    const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
    setOverrides((m) => new Map(m).set(key, next));
    const { error: err } = await getSupabaseBrowser()
      .from("shift_schedules")
      .upsert({ technician_id: tech.id, work_date: day, shift: next, updated_at: new Date().toISOString() });
    if (err) {
      toast.error(errorMessage(err));
      setOverrides((m) => {
        const copy = new Map(m);
        copy.delete(key);
        return copy;
      });
      load();
    }
  };

  const today = vnToday();

  return (
    <div>
      <PageHeader
        title="Lịch ca"
        subtitle="Bấm vào ô để đổi ca: Sáng → Chiều → Full → Nghỉ. Ô không đổi = theo ca mặc định của KTV."
        action={
          <div className="flex items-center gap-1 rounded-xl border border-champagne bg-white/80 px-1">
            <Button variant="ghost" size="icon" onClick={() => setWeekStart((w) => addDays(w, -7))} aria-label="Tuần trước">
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <span className="px-2 text-sm font-medium">
              {formatDate(days[0])} – {formatDate(days[6])}
            </span>
            <Button variant="ghost" size="icon" onClick={() => setWeekStart((w) => addDays(w, 7))} aria-label="Tuần sau">
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        }
      />
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {!techs ? (
        <LoadingBlock />
      ) : (
        <Card>
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-champagne bg-cream/60">
                  <th className="sticky left-0 bg-cream px-4 py-3 text-left font-semibold text-mocha">KTV</th>
                  {days.map((d) => (
                    <th key={d} className={cn("px-2 py-3 text-center font-semibold capitalize text-mocha", d === today && "text-gold-strong")}>
                      {formatWeekday(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-champagne/60">
                {techs.map((t) => (
                  <tr key={t.id}>
                    <td className="sticky left-0 bg-ivory px-4 py-2 font-medium text-espresso">{t.full_name}</td>
                    {days.map((d) => {
                      const explicit = schedule.get(`${t.id}|${d}`);
                      const value = explicit ?? t.shift;
                      return (
                        <td key={d} className="px-1.5 py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => cycle(t, d)}
                            className={cn(
                              "w-full rounded-lg border px-2 py-2 text-xs font-semibold transition-colors",
                              TONE[value],
                              !explicit && "border-dashed opacity-75",
                            )}
                            aria-label={`${t.full_name} ${formatWeekday(d)}: ${SHIFT_LABEL[value]}. Bấm để đổi`}
                          >
                            {SHIFT_LABEL[value].replace("Ca ", "")}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function mondayOf(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Thứ 2 = 0
  return addDays(isoDate, -dow);
}
