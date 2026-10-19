import type { Metadata } from "next";
import { KtvAnnouncements } from "@/components/ktv/ktv-announcements";

export const metadata: Metadata = { title: "Thông báo" };

export default function Page() {
  return <KtvAnnouncements />;
}
