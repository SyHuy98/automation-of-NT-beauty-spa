import type { Metadata } from "next";
import { Dashboard } from "@/components/admin/dashboard/dashboard";

export const metadata: Metadata = { title: "Bảng điều phối" };

export default function AdminHome() {
  return <Dashboard />;
}
