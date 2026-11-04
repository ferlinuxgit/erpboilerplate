"use client";

import { Eye, EyeSlash, SignIn } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineAlert } from "@/components/ui/page";

/** Acceso al portal con el email y la contraseña que te ha dado la empresa. */
export function AdvisorLoginForm({ notice }: { notice: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/advisor/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo entrar."));
      const payload = (await response.json()) as { redirectTo?: string };
      router.push(payload.redirectTo ?? "/asesor");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo entrar.");
      setPending(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <div>
        <h1 className="font-mono text-lg font-bold">Portal del asesor</h1>
        <p className="mt-1 text-sm text-muted-foreground">Entra con el email y la contraseña que te ha facilitado la empresa. Podrás consultar y descargar facturas, gastos, libros y modelos.</p>
      </div>
      {notice ? <InlineAlert tone="info">{notice}</InlineAlert> : null}
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      <div className="space-y-1">
        <Label htmlFor="advisor-email">Email</Label>
        <Input autoComplete="username" id="advisor-email" inputMode="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="advisor-password">Contraseña</Label>
        <div className="flex gap-1">
          <Input autoComplete="current-password" id="advisor-password" onChange={(event) => setPassword(event.target.value)} required type={showPassword ? "text" : "password"} value={password} />
          <Button aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} onClick={() => setShowPassword((value) => !value)} size="icon" type="button" variant="outline">
            {showPassword ? <EyeSlash aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </Button>
        </div>
      </div>
      <Button className="w-full" disabled={pending} size="lg" type="submit">
        <SignIn aria-hidden="true" />
        {pending ? "Entrando…" : "Entrar"}
      </Button>
      <p className="text-xs text-muted-foreground">¿Has olvidado la contraseña? Pide a la empresa que te genere una nueva desde Configuración → Acceso del asesor.</p>
    </form>
  );
}
