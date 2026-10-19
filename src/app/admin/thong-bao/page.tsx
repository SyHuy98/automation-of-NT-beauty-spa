import type { Metadata } from "next";
import { AnnouncementsPage } from "@/components/admin/announcements-page";

export const metadata: Metadata = { title: "Thông báo" };

export default function Page() {
  return <AnnouncementsPage />;
}
