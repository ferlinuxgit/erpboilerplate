import type { Metadata } from "next";

import { AuthPageShell } from "@/components/auth-page-shell";

import { ForgotPasswordForm } from "./forgot-password-form";
import { captchaSiteKey } from "@/lib/captcha";

export const metadata: Metadata = { title: "Recuperar contraseña" };

export default function ForgotPasswordPage() {
  return (
    <AuthPageShell>
      <ForgotPasswordForm captchaSiteKey={captchaSiteKey()} />
    </AuthPageShell>
  );
}
