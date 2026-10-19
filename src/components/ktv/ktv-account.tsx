"use client";

import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/misc";
import { SHIFT_LABEL } from "@/lib/format";
import { ChangePasswordForm } from "../shared/change-password";
import { PushToggle } from "../shared/push-toggle";
import { useSession } from "../shared/session-context";

export function KtvAccount() {
  const me = useSession();
  return (
    <div className="space-y-4">
      <h1 className="font-serif text-2xl font-semibold text-espresso">Tài khoản</h1>
      <Card>
        <CardBody className="flex items-center gap-4">
          <Avatar name={me.fullName} size="lg" />
          <div>
            <p className="font-serif text-xl font-semibold text-espresso">{me.fullName}</p>
            <p className="text-sm text-mocha">
              @{me.username} · Ca mặc định: {SHIFT_LABEL[me.shift]}
            </p>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Thông báo đẩy" />
        <CardBody>
          <PushToggle />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Đổi mật khẩu" />
        <CardBody>
          <ChangePasswordForm />
        </CardBody>
      </Card>
      <form action={logoutAction}>
        <Button type="submit" variant="ghost" size="lg" className="w-full">
          <LogOut className="h-5 w-5" /> Đăng xuất
        </Button>
      </form>
    </div>
  );
}
