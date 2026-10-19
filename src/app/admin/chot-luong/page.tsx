import type { Metadata } from "next";
import { PayrollPage } from "@/components/admin/payroll-page";

export const metadata: Metadata = { title: "Chốt lương" };

export default function Page() {
  return <PayrollPage />;
}
