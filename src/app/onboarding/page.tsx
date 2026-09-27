import { redirect } from "next/navigation";
import { getSessionContext } from "@/server/context";
import { OnboardingForm } from "./onboarding-form";

export const metadata = { title: "Create organization" };

export default async function OnboardingPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md space-y-4">
        <OnboardingForm hasOrganizations={ctx.memberships.length > 0} />
        <p className="text-center text-xs text-muted-foreground">
          To join an existing organization, ask one of its admins to add <strong>{ctx.email}</strong> under Settings → Members.
        </p>
      </div>
    </main>
  );
}
