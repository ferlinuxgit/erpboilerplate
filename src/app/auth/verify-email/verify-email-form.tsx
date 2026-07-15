"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/page";
import { getCsrfHeader } from "@/lib/csrf-client";

export function VerifyEmailForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function verify() {
    setPending(true);
    setError(null);
    const response = await fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getCsrfHeader() },
      body: JSON.stringify({ token }),
    });
    const body = await response.json() as { error?: string };
    if (!response.ok) {
      setError(body.error ?? "No se pudo verificar la dirección de correo.");
      setPending(false);
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">Confirma tu dirección para activar la cuenta y continuar.</p>
    {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
    <Button type="button" onClick={() => void verify()} disabled={pending || !token}>
      {pending ? "Verificando..." : "Verificar correo"}
    </Button>
  </div>;
}
