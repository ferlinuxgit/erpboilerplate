"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { AuthPageShell } from "@/components/auth-page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { invalidateActiveContext } from "@/lib/active-context-client";
import { loginPathWithNext } from "@/lib/auth-client";
import { getCsrfHeader } from "@/lib/csrf-client";

export default function AcceptInvitationPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const invitationPath = `/invitations/${encodeURIComponent(token)}`;
  const loginHref = loginPathWithNext(invitationPath);

  async function accept() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/invitations/${encodeURIComponent(token)}/accept`, { method: "POST", headers: getCsrfHeader() });
      const payload = await response.json().catch(() => null);
      if (response.ok) {
        // El servidor ya ha activado el espacio invitado: recarga completa del contexto.
        invalidateActiveContext();
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/dashboard");
        return;
      }
      if (response.status === 401) {
        router.push(loginHref);
        return;
      }
      setError(payload?.message ?? "No se pudo aceptar la invitación.");
    } catch {
      setError("No se pudo conectar con el servidor. Revisa tu conexión.");
    }
    setPending(false);
  }

  return (
    <AuthPageShell>
      <Card className="w-full border-0 bg-transparent shadow-none">
        <CardHeader>
          <CardTitle aria-level={1} role="heading">Aceptar invitación</CardTitle>
          <CardDescription>Debes iniciar sesión con el mismo email al que se envió la invitación. Al aceptarla pasarás a trabajar en ese espacio.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button aria-busy={pending || undefined} disabled={pending} onClick={() => void accept()} type="button">
            {pending ? "Aceptando…" : "Aceptar invitación"}
          </Button>
          <Link className={buttonVariants({ variant: "outline" })} href={loginHref}>Iniciar sesión</Link>
          {error ? <p role="alert" className="w-full text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    </AuthPageShell>
  );
}
