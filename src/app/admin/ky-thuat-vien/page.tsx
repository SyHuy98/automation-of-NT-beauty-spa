import type { Metadata } from "next";
import { MembersPage } from "@/components/admin/members/members-page";

export const metadata: Metadata = { title: "Kỹ thuật viên" };

export default function Page() {
  return <MembersPage role="technician" />;
}
