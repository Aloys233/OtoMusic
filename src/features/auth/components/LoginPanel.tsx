import { Loader2, LockKeyhole, UserRound, Wifi } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { AuthSession } from "@/stores/auth-store";

type LoginPanelProps = {
  initialValues: AuthSession;
  isSubmitting: boolean;
  errorMessage: string | null;
  onSubmit: (values: AuthSession) => void;
  onFieldChange?: () => void;
};

export function LoginPanel({
  initialValues,
  isSubmitting,
  errorMessage,
  onSubmit,
  onFieldChange,
}: LoginPanelProps) {
  const [values, setValues] = useState<AuthSession>(initialValues);

  const canSubmit = useMemo(
    () =>
      Boolean(values.baseUrl.trim()) &&
      Boolean(values.username.trim()) &&
      Boolean(values.password),
    [values],
  );

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <LockKeyhole className="h-5 w-5" />
          登录 Navidrome
        </CardTitle>
      </CardHeader>

      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit || isSubmitting) {
              return;
            }
            onSubmit(values);
          }}
        >
          <div className="relative">
            <Wifi className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={values.baseUrl}
              placeholder="https://your-navidrome-domain"
              className="pl-9"
              onChange={(event) =>
                setValues((prev) => ({ ...prev, baseUrl: event.target.value }))
              }
              onInput={onFieldChange}
            />
          </div>

          <div className="relative">
            <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={values.username}
              placeholder="用户名"
              className="pl-9"
              onChange={(event) =>
                setValues((prev) => ({ ...prev, username: event.target.value }))
              }
              onInput={onFieldChange}
            />
          </div>

          <div className="relative">
            <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={values.password}
              type="password"
              placeholder="密码"
              className="pl-9"
              onChange={(event) =>
                setValues((prev) => ({ ...prev, password: event.target.value }))
              }
              onInput={onFieldChange}
            />
          </div>

          {errorMessage && (
            <p className="rounded-md bg-rose-100 px-3 py-2 text-xs text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
              {errorMessage}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                登录中...
              </>
            ) : (
              "登录"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
