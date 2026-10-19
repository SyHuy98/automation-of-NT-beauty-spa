import { KtvShell } from "@/components/ktv/ktv-shell";
import { SessionProvider } from "@/components/shared/session-context";
import { requireRole } from "@/lib/auth";

export default async function KtvLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireRole(["technician"]);
  return (
    <SessionProvider profile={profile}>
      <KtvShell>{children}</KtvShell>
    </SessionProvider>
  );
}
