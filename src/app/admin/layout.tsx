import { AdminShell } from "@/components/admin/admin-shell";
import { SessionProvider } from "@/components/shared/session-context";
import { requireRole } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireRole(["owner", "manager"]);
  return (
    <SessionProvider profile={profile}>
      <AdminShell>{children}</AdminShell>
    </SessionProvider>
  );
}
