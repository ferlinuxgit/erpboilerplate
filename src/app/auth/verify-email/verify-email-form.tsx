"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/page";
import { loginPathWithNext, redirectTargetFrom, safeNextPath } from "@/lib/auth-client";
import { getCsrfHeader } from "@/lib/csrf-client";

export function VerifyEmailForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const nextPath = safeNextPath(searchParams.get("next"));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function verify() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ token, next: nextPath }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string; redirectTo?: string } | null;
      if (!response.ok) {
        setError(body?.error ?? "No se pudo verificar la dirección de correo.");
        setPending(false);
        return;
      }
      router.replace(redirectTargetFrom(body, nextPath ?? "/dashboard"));
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor. Revisa tu conexión.");
      setPending(false);
    }
  }

  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">Confirma tu dirección para activar la cuenta y continuar.</p>
    {error ? (
      <InlineAlert tone="danger">
        {error}{" "}
        <Link className="underline" href={loginPathWithNext(nextPath)}>Inicia sesión para pedir un enlace nuevo.</Link>
      </InlineAlert>
    ) : null}
    <Button type="button" onClick={() => void verify()} disabled={pending || !token}>
      {pending ? "Verificando..." : "Verificar correo"}
    </Button>
  </div>;
}
