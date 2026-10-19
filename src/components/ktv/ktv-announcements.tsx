"use client";

import { Megaphone } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { LoadingBlock } from "@/components/ui/spinner";
import { formatDateTime } from "@/lib/format";
import { useQuery } from "@/lib/hooks/use-query";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "../shared/session-context";
import { useKtvData } from "./ktv-data";

interface Row {
  announcement_id: string;
  read_at: string | null;
  announcement: { title: string; body: string; created_at: string; target: string } | null;
}

export function KtvAnnouncements() {
  const me = useSession();
  const { data: snap, refetch } = useKtvData();
  const [openId, setOpenId] = useState<string | null>(null);
  // đã đọc (cập nhật ngay trên giao diện, chưa cần chờ tải lại)
  const [readNow, setReadNow] = useState<Set<string>>(new Set());

  // tải lại khi badge thay đổi (có thông báo mới qua realtime)
  const query = useQuery(async () => {
    const { data, error: err } = await getSupabaseBrowser()
      .from("announcement_recipients")
      .select("announcement_id, read_at, announcement:announcements(title, body, created_at, target)")
      .eq("technician_id", me.id)
      .order("announcement_id", { ascending: false })
      .limit(100);
    if (err) throw err;
    return (data as unknown as Row[]).sort((a, b) =>
      (b.announcement?.created_at ?? "").localeCompare(a.announcement?.created_at ?? ""),
    );
  }, [me.id, snap?.unreadAnnouncements]);
  const { error, refetch: load } = query;
  const rows =
    query.data?.map((r) => (!r.read_at && readNow.has(r.announcement_id) ? { ...r, read_at: new Date().toISOString() } : r)) ?? null;

  const open = async (r: Row) => {
    setOpenId((id) => (id === r.announcement_id ? null : r.announcement_id));
    if (!r.read_at) {
      // mở ra là tính đã đọc
      setReadNow((s) => new Set(s).add(r.announcement_id));
      await getSupabaseBrowser().rpc("mark_announcement_read", { p_announcement_id: r.announcement_id });
      void refetch();
    }
  };

  const markAll = async () => {
    await getSupabaseBrowser().rpc("mark_announcement_read", {});
    load();
    void refetch();
  };

  const unread = rows?.filter((r) => !r.read_at).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-2xl font-semibold text-espresso">Thông báo</h1>
        {unread > 0 ? (
          <Button size="sm" variant="ghost" onClick={markAll}>
            Đánh dấu đã đọc hết
          </Button>
        ) : null}
      </div>
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {!rows ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Megaphone className="h-8 w-8" />} title="Chưa có thông báo nào" />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const expanded = openId === r.announcement_id;
            return (
              <li key={r.announcement_id}>
                <button
                  type="button"
                  onClick={() => open(r)}
                  aria-expanded={expanded}
                  className={cn(
                    "w-full rounded-2xl border p-4 text-left transition-colors",
                    r.read_at ? "border-champagne bg-white/70" : "border-gold bg-champagne/30",
                  )}
                >
                  <div className="flex items-start gap-3">
                    {!r.read_at ? <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-gold-strong" aria-label="Chưa đọc" /> : null}
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-espresso", !r.read_at && "font-semibold")}>{r.announcement?.title}</p>
                      <p className="text-xs text-mocha">
                        {formatDateTime(r.announcement?.created_at)} · {r.announcement?.target === "all" ? "Gửi tất cả" : "Gửi riêng bạn"}
                      </p>
                      <p className={cn("mt-2 whitespace-pre-line text-[15px] text-espresso", !expanded && "line-clamp-2")}>
                        {r.announcement?.body}
                      </p>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
