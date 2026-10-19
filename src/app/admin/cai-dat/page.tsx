import type { Metadata } from "next";
import { SettingsPage } from "@/components/admin/settings-page";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Cài đặt" };

export default async function Page() {
  await requireRole(["owner"]);
  return <SettingsPage />;
}
