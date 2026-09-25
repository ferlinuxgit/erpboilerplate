import type { Metadata } from "next";

import { AuthForm } from "@/components/auth-form";
import { AuthPageShell } from "@/components/auth-page-shell";
import { safeNextPath } from "@/lib/auth-client";

export const metadata: Metadata = { title: "Crear cuenta" };

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const nextPath = safeNextPath(firstValue((await searchParams).next));
  const notice = nextPath?.startsWith("/invitations/")
    ? "Crea la cuenta con el mismo email en el que recibiste la invitación. Al terminar volverás a ella para aceptarla."
    : null;

  return (
    <AuthPageShell>
      <AuthForm mode="sign-up" nextPath={nextPath} notice={notice} />
    </AuthPageShell>
  );
}
