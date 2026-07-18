import { AuthForm } from "@/components/auth-form";
import { AuthPageShell } from "@/components/auth-page-shell";

export default function LoginPage() {
  return (
    <AuthPageShell>
      <AuthForm mode="sign-in" />
    </AuthPageShell>
  );
}
