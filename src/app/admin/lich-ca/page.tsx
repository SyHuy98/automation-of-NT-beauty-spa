import type { Metadata } from "next";
import { SchedulePage } from "@/components/admin/schedule-page";

export const metadata: Metadata = { title: "Lịch ca" };

export default function Page() {
  return <SchedulePage />;
}
