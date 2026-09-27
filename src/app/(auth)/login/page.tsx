import { signIn } from "@/server/actions/auth";
import { AuthForm } from "../auth-form";
import { pageMetadata } from "@/lib/i18n/metadata";
import { getI18n } from "@/lib/i18n/server";

export const generateMetadata = pageMetadata((d) => d.auth.signInTitle);

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const { d } = await getI18n();
  // Known error codes are localized; anything else is ignored (no reflected text).
  const message = error === "link" ? d.auth.linkInvalid : error === "confirm" ? d.auth.confirmationInvalid : null;
  return (
    <>
      {message && <p className="mb-3 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{message}</p>}
      <AuthForm mode="login" action={signIn} next={next} />
    </>
  );
}
