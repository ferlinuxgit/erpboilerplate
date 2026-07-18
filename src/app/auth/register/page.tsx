import { AuthForm } from "@/components/auth-form";
import { AuthPageShell } from "@/components/auth-page-shell";

export default function RegisterPage() {
  return (
    <AuthPageShell>
      <AuthForm mode="sign-up" />
    </AuthPageShell>
  );
}
