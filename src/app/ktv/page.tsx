import type { Metadata } from "next";
import { KtvHome } from "@/components/ktv/ktv-home";

export const metadata: Metadata = { title: "Trang chính" };

export default function Page() {
  return <KtvHome />;
}
