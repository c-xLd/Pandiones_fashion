"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage } from "@/components/forms/form-message";
import { createOrganization } from "@/server/actions/auth";

export function OnboardingForm({ hasOrganizations }: { hasOrganizations: boolean }) {
  const [state, action] = useActionState(createOrganization, null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your organization</CardTitle>
        <CardDescription>All products, models, generations and costs belong to an organization.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Organization name</Label>
            <Input id="name" name="name" placeholder="Pandiones" required minLength={2} maxLength={120} />
          </div>
          <FormMessage state={state} />
          <SubmitButton className="w-full" pendingText="Creating…">
            Create organization
          </SubmitButton>
          {hasOrganizations && (
            <Link href="/" className="block text-center text-sm underline">
              Back to studio
            </Link>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
