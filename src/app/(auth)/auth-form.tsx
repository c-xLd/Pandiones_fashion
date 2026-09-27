"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage } from "@/components/forms/form-message";
import type { FormState } from "@/server/actions/auth";

export function AuthForm({
  mode,
  action,
  next,
}: {
  mode: "login" | "signup";
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  next?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const isLogin = mode === "login";
  return (
    <Card>
      <CardHeader>
        <CardTitle>{isLogin ? "Sign in" : "Create an account"}</CardTitle>
        <CardDescription>
          {isLogin ? "Use your studio account." : "You can create or join an organization after signing up."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          {next && <input type="hidden" name="next" value={next} />}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={isLogin ? "current-password" : "new-password"}
              minLength={8}
              required
            />
          </div>
          <FormMessage state={state} />
          <SubmitButton className="w-full" pendingText={isLogin ? "Signing in…" : "Creating account…"}>
            {isLogin ? "Sign in" : "Create account"}
          </SubmitButton>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {isLogin ? (
            <>
              No account? <Link className="underline" href="/signup">Sign up</Link>
            </>
          ) : (
            <>
              Already registered? <Link className="underline" href="/login">Sign in</Link>
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
