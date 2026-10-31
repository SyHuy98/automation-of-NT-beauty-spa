"use client";

import { Bell, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, ErrorState, PageHeader } from "@/components/ui/card";
import { LoadingBlock } from "@/components/ui/spinner";
import { ConnectionBanner, Money, Stat } from "@/components/ui/misc";
import { useCanSeeMoney } from "../../shared/money";
import { useToast } from "@/components/ui/toast";
import { errorMessage, formatTime } from "@/lib/format";
import { useNow } from "@/lib/hooks/use-now";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useDashboard } from "../use-dashboard";
import { BalanceChart } from "./balance-chart";
import { CreateTourDialog } from "./create-tour-dialog";
import { TechnicianGrid } from "./technician-grid";
import { TourDetailDialog } from "./tour-detail-dialog";
import { TourList } from "./tour-list";

export function Dashboard() {
  const { data, error, refetch, connection } = useDashboard();
  const now = useNow(data?.now);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const toast = useToast();
  const canSeeMoney = useCanSeeMoney();

  const metrics = useMemo(() => {
    if (!data) return null;
    const todays = data.tours.filter((t) => isToday(t.createdAt, data.today));
    const valid = todays.filter((t) => t.status !== "cancelled");
    const completed = data.tours.filter((t) => t.status === "completed" && t.completedAt && isToday(t.completedAt, data.today));
    return {
      tours: valid.length,
      completed: completed.length,
      revenue: completed.reduce((s, t) => s + t.totalFee, 0),
      requested: valid.filter((t) => t.isRequested).length,
      active: data.tours.filter((t) => ["waiting", "offered", "in_progress"].includes(t.status)).length,
    };
  }, [data]);

  const detailTour = data?.tours.find((t) => t.id === detailId) ?? null;

  const resolveAlert = async (id: number) => {
    const { error: err } = await getSupabaseBrowser().rpc("resolve_alert", { p_alert_id: id });
    if (err) toast.error(errorMessage(err));
    else void refetch();
  };

  return (
    <div className="-mx-4 -mt-6 md:-mx-8 md:-mt-8">
      <ConnectionBanner state={connection} />
      <div className="px-4 pt-6 md:px-8 md:pt-8">
        <PageHeader
          title="Bảng điều phối"
          subtitle={data ? `Cập nhật realtime · ${formatTime(new Date(now).toISOString())}` : "Đang tải dữ liệu…"}
          action={
            <Button size="lg" onClick={() => setCreateOpen(true)} className="shadow-lift">
              <Plus className="h-5 w-5" /> Tạo tour
            </Button>
          }
        />

        {error && !data ? <ErrorState message={error} onRetry={refetch} /> : null}
        {!data ? (
          !error ? <LoadingBlock /> : null
        ) : (
          <div className="space-y-6">
            {metrics ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Tour hôm nay" value={metrics.tours} hint={`${metrics.active} tour đang chờ / làm`} />
                <Stat label="Đã hoàn thành" value={metrics.completed} />
                {canSeeMoney ? (
                  <Stat label="Tổng tiền tour" value={<Money value={metrics.revenue} />} hint="Tour hoàn thành hôm nay" />
                ) : null}
                <Stat label="Tour chỉ định" value={metrics.requested} />
              </div>
            ) : null}

            {data.alerts.length > 0 ? (
              <Card className="border-pending/50 bg-pending/5">
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      <Bell className="h-5 w-5 text-pending-ink" /> Cần xử lý ({data.alerts.length})
                    </span>
                  }
                />
                <CardBody className="space-y-2">
                  {data.alerts.map((a) => (
                    <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/80 px-3 py-2">
                      <p className="text-sm text-espresso">
                        <span className="mr-2 text-mocha">{formatTime(a.createdAt)}</span>
                        {a.message}
                      </p>
                      <div className="flex gap-2">
                        {a.tourId ? (
                          <Button size="sm" variant="secondary" onClick={() => setDetailId(a.tourId)}>
                            Chọn lại KTV
                          </Button>
                        ) : null}
                        <Button size="sm" variant="ghost" onClick={() => resolveAlert(a.id)}>
                          Đã xem
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardBody>
              </Card>
            ) : null}

            <TechnicianGrid technicians={data.technicians} now={now} onRefresh={refetch} onOpenTour={setDetailId} />

            {canSeeMoney ? (
              <div className="grid gap-6 xl:grid-cols-5">
                <div className="xl:col-span-3">
                  <TourList tours={data.tours} today={data.today} now={now} onOpen={setDetailId} />
                </div>
                <div className="xl:col-span-2">
                  <BalanceChart
                    technicians={data.technicians}
                    thresholdPercent={data.settings.imbalanceThresholdPercent}
                    periodLabel={data.period.startDay > 1 ? "Kỳ này" : "Tháng này"}
                  />
                </div>
              </div>
            ) : (
              <TourList tours={data.tours} today={data.today} now={now} onOpen={setDetailId} />
            )}
          </div>
        )}
      </div>

      <CreateTourDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        technicians={data?.technicians ?? []}
        onCreated={() => void refetch()}
      />
      <TourDetailDialog
        tour={detailTour}
        open={!!detailId}
        onOpenChange={(v) => !v && setDetailId(null)}
        technicians={data?.technicians ?? []}
        now={now}
        onChanged={() => void refetch()}
      />
    </div>
  );
}

function isToday(iso: string, today: string): boolean {
  return new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 10) === today;
}
