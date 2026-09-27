"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage } from "@/components/forms/form-message";
import type { FormState } from "@/server/actions/auth";
import { useI18n } from "@/lib/i18n/client";

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
  const { d } = useI18n();
  const isLogin = mode === "login";
  return (
    <Card>
      <CardHeader>
        <CardTitle>{isLogin ? d.auth.signIn : d.auth.createAccount}</CardTitle>
        <CardDescription>
          {isLogin ? d.auth.signInDescription : d.auth.signUpDescription}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          {next && <input type="hidden" name="next" value={next} />}
          <div className="space-y-1.5">
            <Label htmlFor="email">{d.auth.email}</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">{d.auth.password}</Label>
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
          <SubmitButton className="w-full" pendingText={isLogin ? d.auth.signingIn : d.auth.creatingAccount}>
            {isLogin ? d.auth.signIn : d.auth.createAccountButton}
          </SubmitButton>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {isLogin ? (
            <>
              {d.auth.noAccount} <Link className="underline" href="/signup">{d.auth.signUp}</Link>
            </>
          ) : (
            <>
              {d.auth.alreadyRegistered} <Link className="underline" href="/login">{d.auth.signIn}</Link>
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
