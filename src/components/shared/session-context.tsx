"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SessionProfile } from "@/lib/auth";

const SessionContext = createContext<SessionProfile | null>(null);

export function SessionProvider({ profile, children }: { profile: SessionProfile; children: ReactNode }) {
  return <SessionContext.Provider value={profile}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionProfile {
  const p = useContext(SessionContext);
  if (!p) throw new Error("useSession phải nằm trong SessionProvider");
  return p;
}
