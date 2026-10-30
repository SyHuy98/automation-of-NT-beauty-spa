"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Segmented } from "@/components/ui/form";
import { formatMoney, formatMoneyShort } from "@/lib/format";
import type { DashboardTechnician, Gender } from "@/types/app";

/**
 * Biểu đồ cân bằng thu nhập giữa các KTV (hôm nay / kỳ lương này).
 * KTV nam và nữ là 2 nhóm riêng (khách nam → KTV nam, khách nữ → KTV nữ) nên
 * mỗi nhóm có trung bình riêng.
 * Chỉ tính TOUR THƯỜNG (tour khách chỉ định là công riêng, không tính vào cân bằng).
 * Kỳ lương: so theo tiền / giờ có mặt (giống thuật toán phân tour) – KTV ca ngắn
 * hoặc mới đi làm lại không bị báo "thấp hơn TB"; KTV chưa đi làm kỳ này không tính.
 * Đường ngang = trung bình nhóm; cột đỏ gạch = lệch trên TB quá ngưỡng,
 * cột xám = thấp hơn TB quá ngưỡng.
 */
export function BalanceChart({
  technicians,
  thresholdPercent,
  periodLabel = "Kỳ này",
}: {
  technicians: DashboardTechnician[];
  thresholdPercent: number;
  periodLabel?: string;
}) {
  const [range, setRange] = useState<"today" | "month">("month");
  const hasMale = technicians.some((t) => t.gender === "male");
  const hasFemale = technicians.some((t) => t.gender !== "male");
  const [pickedGroup, setGroup] = useState<Gender>("female");
  // chỉ có 1 nhóm thì luôn hiện nhóm đó
  const group: Gender = hasMale && hasFemale ? pickedGroup : hasMale ? "male" : "female";

  const perHour = range === "month";
  const { rows, avg, absent } = useMemo(() => {
    const inGroup = technicians.filter((t) => (t.gender === "male" ? "male" : "female") === group);
    const members = perHour ? inGroup.filter((t) => t.monthWorkedMinutes > 0) : inGroup;
    const rows = members.map((t) => {
      const total = range === "today" ? t.todayAmount - t.todayRequestedAmount : t.monthAmount - t.monthRequestedAmount;
      const hours = Math.max(1, (t.monthWorkedMinutes - t.monthRequestedMinutes) / 60);
      return {
        name: shortName(t.fullName),
        fullName: t.fullName,
        value: perHour ? total / hours : total,
        total,
        hours,
        requested: range === "today" ? t.todayRequestedAmount : t.monthRequestedAmount,
      };
    });
    const avg = rows.length ? rows.reduce((s, r) => s + r.value, 0) / rows.length : 0;
    return { rows: rows.sort((a, b) => b.value - a.value), avg, absent: inGroup.length - members.length };
  }, [technicians, range, group, perHour]);

  const hi = avg * (1 + thresholdPercent / 100);
  const lo = avg * (1 - thresholdPercent / 100);
  const outliers = rows.filter((r) => avg > 0 && (r.value > hi || r.value < lo));

  return (
    <Card className="h-full">
      <CardHeader
        title="Cân bằng thu nhập"
        subtitle={`Tiền tour thường (không tính khách chỉ định)${perHour ? " chia theo giờ có mặt" : ""} · đánh dấu KTV lệch quá ±${thresholdPercent}%`}
        action={
          <div className="flex flex-wrap justify-end gap-2">
            {hasMale && hasFemale ? (
              <Segmented<Gender>
                ariaLabel="Nhóm KTV"
                value={group}
                onChange={setGroup}
                options={[
                  { value: "female", label: "KTV nữ" },
                  { value: "male", label: "KTV nam" },
                ]}
              />
            ) : null}
            <Segmented
              ariaLabel="Khoảng thời gian"
              value={range}
              onChange={setRange}
              options={[
                { value: "today", label: "Hôm nay" },
                { value: "month", label: periodLabel },
              ]}
            />
          </div>
        }
      />
      <CardBody>
        {rows.length === 0 ? (
          <EmptyState title="Chưa có dữ liệu" />
        ) : (
          <>
            <p className="mb-2 text-sm text-mocha">
              Trung bình nhóm {group === "male" ? "KTV nam" : "KTV nữ"}:{" "}
              <strong className="tabular text-espresso">
                {formatMoney(Math.round(avg))}
                {perHour ? " / giờ có mặt" : ""}
              </strong>
              {absent > 0 ? ` · ${absent} KTV chưa đi làm kỳ này không tính` : ""}
            </p>
            <div className="h-72" role="img" aria-label="Biểu đồ thu nhập theo KTV">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="#E8D5A8" strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fill: "#6B4F3A", fontSize: 12 }} axisLine={false} tickLine={false} interval={0} />
                  <YAxis
                    tickFormatter={(v: number) => formatMoneyShort(v)}
                    tick={{ fill: "#6B4F3A", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    width={52}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(232,213,168,0.25)" }}
                    formatter={(v, _n, item) => {
                      const row = item?.payload as { requested?: number; total?: number; hours?: number } | undefined;
                      const req = row?.requested ?? 0;
                      const extra = req > 0 ? ` (+${formatMoney(req)} chỉ định)` : "";
                      return perHour
                        ? [
                            `${formatMoney(Math.round(Number(v)))}/giờ · ${formatMoney(row?.total ?? 0)} trong ${Math.round(row?.hours ?? 0)} giờ${extra}`,
                            "Tour thường",
                          ]
                        : [`${formatMoney(Number(v))}${extra}`, "Tour thường"];
                    }}
                    labelFormatter={(_, p) => (p?.[0]?.payload as { fullName?: string })?.fullName ?? ""}
                    contentStyle={{ borderRadius: 12, borderColor: "#E8D5A8", background: "#FBF7F0" }}
                  />
                  <ReferenceLine y={avg} stroke="#8C6D35" strokeDasharray="6 4" label={{ value: "TB", fill: "#8C6D35", fontSize: 12, position: "right" }} />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                    {rows.map((r) => (
                      <Cell
                        key={r.fullName}
                        fill={avg > 0 && r.value > hi ? "#B5523B" : avg > 0 && r.value < lo ? "#9C948A" : "#C9A96E"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {outliers.length > 0 ? (
              <ul className="mt-3 space-y-1 text-sm">
                {outliers.map((r) => {
                  const pct = Math.round(((r.value - avg) / avg) * 100);
                  return (
                    <li key={r.fullName} className={pct > 0 ? "text-busy-ink" : "text-off-ink"}>
                      {r.fullName}: {pct > 0 ? "cao hơn" : "thấp hơn"} TB {Math.abs(pct)}%
                    </li>
                  );
                })}
              </ul>
            ) : avg > 0 ? (
              <p className="mt-3 text-sm text-free-ink">Thu nhập đang cân bằng trong ngưỡng cho phép.</p>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.slice(-1)[0] ?? name;
}
