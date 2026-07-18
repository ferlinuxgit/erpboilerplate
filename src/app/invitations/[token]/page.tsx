"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { AuthPageShell } from "@/components/auth-page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCsrfHeader } from "@/lib/csrf-client";

export default function AcceptInvitationPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  return <AuthPageShell><Card><CardHeader><CardTitle>Aceptar invitación</CardTitle><CardDescription>Debes iniciar sesión con el mismo email al que se envió la invitación.</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-3"><Button disabled={pending} onClick={async () => { setPending(true); setError(""); const response = await fetch(`/api/invitations/${encodeURIComponent(token)}/accept`, { method: "POST", headers: getCsrfHeader() }); const payload = await response.json().catch(() => null); if (response.ok) { router.push("/dashboard"); router.refresh(); return; } setError(payload?.message ?? "No se pudo aceptar la invitación."); setPending(false); }}>{pending ? "Aceptando…" : "Aceptar invitación"}</Button>{error ? <p role="alert" className="w-full text-sm text-destructive">{error}</p> : null}<Link className={buttonVariants({ variant: "outline" })} href="/auth/login">Iniciar sesión</Link></CardContent></Card></AuthPageShell>;
}
