import type { Metadata } from "next";

import { AuthForm } from "@/components/auth-form";
import { AuthPageShell } from "@/components/auth-page-shell";
import { safeNextPath, SESSION_EXPIRED_REASON } from "@/lib/auth-client";

export const metadata: Metadata = { title: "Iniciar sesión" };

const PASSWORD_RESET_REASON = "password-reset";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; reason?: string | string[] }> }) {
  const query = await searchParams;
  const nextPath = safeNextPath(firstValue(query.next));
  const notice = firstValue(query.reason) === SESSION_EXPIRED_REASON
    ? "Tu sesión ha caducado. Inicia sesión de nuevo para continuar donde lo dejaste."
    : firstValue(query.reason) === PASSWORD_RESET_REASON
      ? "Contraseña actualizada. Inicia sesión con la nueva contraseña."
      : nextPath?.startsWith("/invitations/")
        ? "Inicia sesión con el email en el que recibiste la invitación. Si aún no tienes cuenta, créala desde el enlace de abajo."
        : null;

  return (
    <AuthPageShell>
      <AuthForm mode="sign-in" nextPath={nextPath} notice={notice} />
    </AuthPageShell>
  );
}
