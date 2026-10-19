import { redirect } from "next/navigation";
import { getSessionProfile, homeForRole } from "@/lib/auth";

export default async function Home() {
  const profile = await getSessionProfile();
  redirect(profile ? homeForRole(profile.role) : "/login");
}
