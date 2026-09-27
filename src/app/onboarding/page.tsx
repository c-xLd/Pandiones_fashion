import { redirect } from "next/navigation";
import { getSessionContext } from "@/server/context";
import { OnboardingForm } from "./onboarding-form";
import { pageMetadata } from "@/lib/i18n/metadata";
import { getI18n } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import { LanguageSwitcher } from "@/components/studio/language-switcher";

export const generateMetadata = pageMetadata((d) => d.onboarding.metaTitle);

export default async function OnboardingPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  const { d } = await getI18n();
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <OnboardingForm hasOrganizations={ctx.memberships.length > 0} />
        <p className="text-center text-xs text-muted-foreground">
          {fmt(d.onboarding.joinHint, { email: ctx.email ?? "" })}
        </p>
        <LanguageSwitcher className="mx-auto w-40" />
      </div>
    </main>
  );
}
