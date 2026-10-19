import type { Metadata } from "next";
import { ServicesPage } from "@/components/admin/services-page";

export const metadata: Metadata = { title: "Bảng giá dịch vụ" };

export default function Page() {
  return <ServicesPage />;
}
