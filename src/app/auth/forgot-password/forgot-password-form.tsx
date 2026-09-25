"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AccessibleField, FormErrorMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentMessage, setSentMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Indica un email válido, por ejemplo persona@empresa.com.");
      return;
    }
    setPending(true);
    setError(null);
    const { data, error: requestError } = await authClient.requestPasswordReset({ email: email.trim() });
    setPending(false);
    if (requestError) {
      setError(requestError.message ?? "No se pudo enviar el enlace.");
      return;
    }
    setSentMessage((data as { message?: string } | null)?.message ?? "Revisa tu correo.");
  }

  return (
    <Card className="w-full border-0 bg-transparent shadow-none">
      <CardHeader>
        <CardTitle aria-level={1} role="heading">¿Olvidaste tu contraseña?</CardTitle>
        <CardDescription>Escribe el email con el que entras y te enviaremos un enlace para elegir una nueva.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sentMessage ? (
          <div className="space-y-4">
            <p className="border border-window-dark-shadow bg-window-highlight px-3 py-2 text-sm text-window-text" role="status">
              {sentMessage}
            </p>
            <Button className="w-full" onClick={() => setSentMessage(null)} type="button" variant="outline">
              Enviar a otro email
            </Button>
          </div>
        ) : (
          <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
            <FormErrorMessage>{error}</FormErrorMessage>
            <AccessibleField id="forgot-password-email" label="Email" required>
              <Input
                autoCapitalize="none"
                autoComplete="username"
                autoFocus
                inputMode="email"
                onChange={(event) => setEmail(event.target.value)}
                spellCheck={false}
                type="email"
                value={email}
              />
            </AccessibleField>
            <Button aria-busy={pending || undefined} className="w-full" disabled={pending} type="submit">
              {pending ? "Enviando…" : "Enviarme el enlace"}
            </Button>
          </form>
        )}
        <Link className="block text-center text-sm text-muted-foreground underline-offset-4 hover:underline" href="/auth/login">
          Volver a iniciar sesión
        </Link>
      </CardContent>
    </Card>
  );
}
