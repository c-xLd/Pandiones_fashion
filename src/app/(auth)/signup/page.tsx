import { signUp } from "@/server/actions/auth";
import { AuthForm } from "../auth-form";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata((d) => d.auth.signUpTitle);

export default function SignupPage() {
  return <AuthForm mode="signup" action={signUp} />;
}
