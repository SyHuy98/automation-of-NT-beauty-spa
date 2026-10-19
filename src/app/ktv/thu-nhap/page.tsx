import type { Metadata } from "next";
import { KtvEarnings } from "@/components/ktv/ktv-earnings";

export const metadata: Metadata = { title: "Thu nhập" };

export default function Page() {
  return <KtvEarnings />;
}
