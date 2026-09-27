import { signUp } from "@/server/actions/auth";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Sign up" };

export default function SignupPage() {
  return <AuthForm mode="signup" action={signUp} />;
}
