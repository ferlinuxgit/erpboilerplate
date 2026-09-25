"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { invalidateActiveContext } from "@/lib/active-context-client";
import { authClient, loginPathWithNext, registerPathWithNext } from "@/lib/auth-client";
import { getCsrfHeader } from "@/lib/csrf-client";

type AcceptInvitationProps = {
  token: string;
  invitedEmail: string;
  signedInEmail: string | null;
  accepted: boolean;
  expired: boolean;
};

export function AcceptInvitation({ accepted, expired, invitedEmail, signedInEmail, token }: AcceptInvitationProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const invitationPath = `/invitations/${encodeURIComponent(token)}`;
  const loginHref = loginPathWithNext(invitationPath);
  const registerHref = registerPathWithNext(invitationPath);
  const emailMatches = signedInEmail?.toLowerCase() === invitedEmail.toLowerCase();

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

  async function switchAccount() {
    await authClient.signOut();
    router.push(loginHref);
    router.refresh();
  }

  if (accepted) {
    return (
      <div className="space-y-3">
        <p className="text-sm" role="status">Esta invitación ya se aceptó.</p>
        <Link className={buttonVariants()} href={signedInEmail ? "/dashboard" : loginHref}>{signedInEmail ? "Ir al panel" : "Iniciar sesión"}</Link>
      </div>
    );
  }

  if (expired) {
    return <p className="border border-warning bg-warning/10 p-2 text-sm" role="alert">La invitación ha caducado. Pide a quien te invitó que te la reenvíe desde Configuración › Equipo.</p>;
  }

  if (!signedInEmail) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Para aceptarla, entra o crea tu cuenta con <strong>{invitedEmail}</strong>. Volverás aquí automáticamente.</p>
        <div className="flex flex-wrap gap-2">
          <Link className={buttonVariants()} href={registerHref}>Crear cuenta</Link>
          <Link className={buttonVariants({ variant: "outline" })} href={loginHref}>Ya tengo cuenta: iniciar sesión</Link>
        </div>
      </div>
    );
  }

  if (!emailMatches) {
    return (
      <div className="space-y-3">
        <p className="border border-warning bg-warning/10 p-2 text-sm" role="alert">
          Has iniciado sesión como <strong>{signedInEmail}</strong>, pero la invitación es para <strong>{invitedEmail}</strong>.
        </p>
        <Button onClick={() => void switchAccount()} type="button" variant="outline">Cambiar de cuenta</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Button aria-busy={pending || undefined} disabled={pending} onClick={() => void accept()} type="button">
        {pending ? "Aceptando…" : "Aceptar invitación"}
      </Button>
      {error ? <p role="alert" className="w-full text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
