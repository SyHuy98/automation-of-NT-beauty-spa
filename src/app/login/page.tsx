import type { Metadata } from "next";
import { LeafOrnament, Logo } from "@/components/ui/misc";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Đăng nhập" };

export default function LoginPage() {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <LeafOrnament className="pointer-events-none absolute -left-6 -top-6 h-64 w-64 rotate-180" />
      <LeafOrnament className="pointer-events-none absolute -bottom-8 -right-8 h-72 w-72" />
      <div className="relative w-full max-w-sm animate-fade-in rounded-[1.75rem] border border-champagne bg-white/75 px-7 py-9 shadow-lift backdrop-blur-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="items-center" />
          <div className="mt-5 flex items-center gap-3 text-gold" aria-hidden="true">
            <span className="h-px w-10 bg-gold/60" />
            <span className="text-xs">✦</span>
            <span className="h-px w-10 bg-gold/60" />
          </div>
          <p className="mt-4 text-sm text-mocha">Đăng nhập để bắt đầu ca làm việc</p>
        </div>
        <LoginForm />
      </div>
      <p className="absolute bottom-4 text-center text-xs text-mocha/80">151 Đường 3/2, Quận 10, TP.HCM</p>
    </main>
  );
}
