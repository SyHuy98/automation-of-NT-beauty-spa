"use client";

import { Eye, EyeOff } from "lucide-react";
import { useActionState, useState } from "react";
import { loginAction, type LoginState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  const [show, setShow] = useState(false);

  return (
    <form action={action} className="space-y-4" noValidate>
      <Field label="Tên đăng nhập" error={state.fieldErrors?.username}>
        {(p) => (
          <Input
            {...p}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            placeholder="vd: lan.nguyen"
            required
          />
        )}
      </Field>
      <Field label="Mật khẩu" error={state.fieldErrors?.password}>
        {(p) => (
          <div className="relative">
            <Input {...p} name="password" type={show ? "text" : "password"} autoComplete="current-password" required className="pr-11" />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-mocha hover:bg-cream"
              aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
            >
              {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
        )}
      </Field>
      {state.error ? (
        <p role="alert" className="rounded-xl border border-busy/30 bg-busy/5 px-3 py-2 text-sm text-busy-ink">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        Đăng nhập
      </Button>
    </form>
  );
}
