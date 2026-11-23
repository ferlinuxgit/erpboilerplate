"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate } from "@/lib/format";

type Status = { enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number };
type Setup = { secret: string; qrDataUrl: string };

async function post<T>(body: unknown): Promise<T> {
  const response = await fetch("/api/auth/totp", { method: "POST", headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: JSON.stringify(body) });
  const payload = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(payload.message ?? "No se pudo completar la acción.");
  return payload;
}

/** Verificación en dos pasos con app de autenticación (Google Authenticator, 1Password…). */
export function TotpPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const response = await fetch("/api/auth/totp");
    if (response.ok) setStatus((await response.json()) as Status);
  };

  useEffect(() => {
    let ignore = false;
    void fetch("/api/auth/totp").then(async (response) => {
      if (response.ok && !ignore) setStatus((await response.json()) as Status);
    });
    return () => {
      ignore = true;
    };
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  };

  const start = () => run(async () => {
    setSetup(await post<Setup>({ action: "setup" }));
    setRecoveryCodes(null);
    setCode("");
  });

  const enable = () => run(async () => {
    const result = await post<{ recoveryCodes: string[] }>({ action: "enable", code });
    setRecoveryCodes(result.recoveryCodes);
    setSetup(null);
    setCode("");
    toast.success("Verificación con app activada.");
    await refresh();
  });

  const disable = () => run(async () => {
    await post({ action: "disable", code });
    setCode("");
    setRecoveryCodes(null);
    toast.success("Verificación con app desactivada.");
    await refresh();
  });

  const regenerate = () => run(async () => {
    const result = await post<{ recoveryCodes: string[] }>({ action: "regenerate", code });
    setRecoveryCodes(result.recoveryCodes);
    setCode("");
    toast.success("Códigos de recuperación nuevos. Los anteriores ya no sirven.");
    await refresh();
  });

  const codeField = (label: string, helper: string) => (
    <AccessibleField helperText={helper} id="totp-code" label={label}>
      <Input autoComplete="one-time-code" maxLength={11} onChange={(event) => setCode(event.target.value.trim())} value={code} />
    </AccessibleField>
  );

  return (
    <div className="space-y-3" data-testid="totp-panel">
      <p className="font-mono text-xs font-bold uppercase">Verificación en dos pasos con app</p>
      {status === null ? <p className="text-sm text-muted-foreground">Cargando…</p> : null}

      {recoveryCodes ? (
        <div className="space-y-2 border border-window-dark-shadow bg-window-highlight p-3" role="status">
          <p className="text-sm font-bold">Guarda estos códigos de recuperación en un lugar seguro.</p>
          <p className="text-xs text-muted-foreground">Te dejan entrar si pierdes el móvil. Cada uno sirve una sola vez y no se volverán a mostrar.</p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-sm" data-testid="totp-recovery-codes">
            {recoveryCodes.map((entry) => <li key={entry}>{entry}</li>)}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void navigator.clipboard?.writeText(recoveryCodes.join("\n")).then(() => toast.success("Códigos copiados."))} type="button" variant="outline">Copiar</Button>
            <Button onClick={() => setRecoveryCodes(null)} type="button">Ya los he guardado</Button>
          </div>
        </div>
      ) : null}

      {status && !status.enabled && !setup ? (
        <div className="space-y-2">
          <p className="text-sm">Además de la contraseña, al entrar se pedirá un código de tu app de autenticación (Google Authenticator, Microsoft Authenticator, 1Password…).</p>
          <Button disabled={busy} onClick={() => void start()} type="button">Activar con app</Button>
        </div>
      ) : null}

      {setup ? (
        <form className="space-y-2" noValidate onSubmit={(event) => { event.preventDefault(); void enable(); }}>
          <p className="text-sm">1. Escanea este código QR con la app (o escribe la clave a mano).</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- QR en data URL generado en el servidor */}
          <img alt="Código QR para la app de autenticación" className="border border-window-shadow bg-white p-1" height={180} src={setup.qrDataUrl} width={180} />
          <p className="break-all font-mono text-xs" data-testid="totp-secret">{setup.secret.match(/.{1,4}/g)?.join(" ")}</p>
          <p className="text-sm">2. Escribe el código de seis dígitos que muestra la app.</p>
          {codeField("Código de la app", "Si falla, comprueba que la hora del móvil es automática.")}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !/^\d{6}$/.test(code)} type="submit">Confirmar y activar</Button>
            <Button onClick={() => { setSetup(null); setCode(""); }} type="button" variant="outline">Cancelar</Button>
          </div>
        </form>
      ) : null}

      {status?.enabled ? (
        <div className="space-y-2">
          <p className="text-sm">
            <span className="font-bold text-success-text">Activada</span>
            {status.enabledAt ? ` desde ${formatDate(status.enabledAt)}` : ""} · quedan {status.recoveryCodesLeft} códigos de recuperación.
          </p>
          {codeField("Código de la app o de recuperación", "Necesario para desactivarla o generar códigos nuevos.")}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || code.length < 6} onClick={() => void regenerate()} type="button" variant="outline">Generar códigos nuevos</Button>
            <Button disabled={busy || code.length < 6} onClick={() => void disable()} type="button" variant="outline">Desactivar</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
