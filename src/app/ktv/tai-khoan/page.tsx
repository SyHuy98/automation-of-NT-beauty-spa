import type { Metadata } from "next";
import { KtvAccount } from "@/components/ktv/ktv-account";

export const metadata: Metadata = { title: "Tài khoản" };

export default function Page() {
  return <KtvAccount />;
}
