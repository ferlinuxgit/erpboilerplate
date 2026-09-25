"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AccessibleField, FormErrorMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirmation) {
      setError("Las dos contraseñas no coinciden.");
      return;
    }
    setPending(true);
    setError(null);
    const { error: resetError } = await authClient.resetPassword({ token, password });
    if (resetError) {
      setPending(false);
      setError(resetError.message ?? "No se pudo cambiar la contraseña.");
      return;
    }
    router.replace("/auth/login?reason=password-reset");
  }

  if (!token) {
    return (
      <Card className="w-full border-0 bg-transparent shadow-none">
        <CardHeader>
          <CardTitle aria-level={1} role="heading">Enlace incompleto</CardTitle>
          <CardDescription>Abre el enlace completo del correo o pide uno nuevo.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link className="text-sm underline underline-offset-4" href="/auth/forgot-password">Pedir un enlace nuevo</Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full border-0 bg-transparent shadow-none">
      <CardHeader>
        <CardTitle aria-level={1} role="heading">Elige una contraseña nueva</CardTitle>
        <CardDescription>Al guardarla se cerrarán las sesiones abiertas en otros dispositivos.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
          <FormErrorMessage>{error}</FormErrorMessage>
          <AccessibleField helperText="Mínimo 8 caracteres." id="reset-password-new" label="Contraseña nueva" required>
            <Input autoComplete="new-password" autoFocus minLength={8} onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
          </AccessibleField>
          <AccessibleField id="reset-password-confirmation" label="Repite la contraseña" required>
            <Input autoComplete="new-password" minLength={8} onChange={(event) => setConfirmation(event.target.value)} type="password" value={confirmation} />
          </AccessibleField>
          <Button aria-busy={pending || undefined} className="w-full" disabled={pending} type="submit">
            {pending ? "Guardando…" : "Guardar contraseña"}
          </Button>
        </form>
        {error ? (
          <Link className="block text-center text-sm text-muted-foreground underline-offset-4 hover:underline" href="/auth/forgot-password">
            Pedir un enlace nuevo
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
