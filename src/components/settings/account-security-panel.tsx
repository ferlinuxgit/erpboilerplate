"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate } from "@/lib/format";
import { TotpPanel } from "@/components/settings/totp-panel";

type SessionRow = { id: string; createdAt: string; expiresAt: string; ipAddress: string | null; userAgent: string | null; current: boolean };

function deviceLabel(userAgent: string | null) {
  if (!userAgent) return "Dispositivo desconocido";
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Chrome\//.test(userAgent) ? "Chrome" : /Firefox\//.test(userAgent) ? "Firefox" : /Safari\//.test(userAgent) ? "Safari" : "Navegador";
  const system = /Windows/.test(userAgent) ? "Windows" : /Android/.test(userAgent) ? "Android" : /iPhone|iPad/.test(userAgent) ? "iOS" : /Mac OS/.test(userAgent) ? "macOS" : /Linux/.test(userAgent) ? "Linux" : "";
  return system ? `${browser} en ${system}` : browser;
}

/** Cambiar la contraseña con la sesión iniciada y ver / cerrar las sesiones abiertas. */
export function AccountSecurityPanel() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/auth/sessions");
    setSessions(response.ok ? ((await response.json()) as SessionRow[]) : []);
  }, []);

  useEffect(() => {
    let ignore = false;
    void fetch("/api/auth/sessions").then(async (response) => {
      const rows = response.ok ? ((await response.json()) as SessionRow[]) : [];
      if (!ignore) setSessions(rows);
    });
    return () => {
      ignore = true;
    };
  }, []);

  const send = async (url: string, method: "POST" | "DELETE", body?: unknown) => {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: body ? JSON.stringify(body) : undefined });
    const payload = (await response.json().catch(() => ({}))) as { message?: string; revoked?: number };
    if (!response.ok) throw new Error(payload.message ?? "No se pudo completar la acción.");
    return payload;
  };

  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await send("/api/auth/change-password", "POST", { currentPassword, newPassword });
      toast.success(result.revoked ? `Contraseña cambiada. Se han cerrado ${result.revoked} sesiones en otros dispositivos.` : "Contraseña cambiada.");
      setCurrentPassword("");
      setNewPassword("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cambiar la contraseña.");
    } finally {
      setBusy(false);
    }
  };

  const revokeOthers = async () => {
    setBusy(true);
    try {
      const result = await send("/api/auth/sessions", "DELETE");
      toast.success(result.revoked ? `Se han cerrado ${result.revoked} sesiones.` : "No había otras sesiones abiertas.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron cerrar las sesiones.");
    } finally {
      setBusy(false);
    }
  };

  const others = (sessions ?? []).filter((row) => !row.current).length;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form className="space-y-2" noValidate onSubmit={(event) => void changePassword(event)}>
        <p className="font-mono text-xs font-bold uppercase">Cambiar la contraseña</p>
        <AccessibleField id="current-password" label="Contraseña actual">
          <Input autoComplete="current-password" onChange={(event) => setCurrentPassword(event.target.value)} type="password" value={currentPassword} />
        </AccessibleField>
        <AccessibleField helperText="Mínimo 8 caracteres. Se cerrarán tus sesiones en otros dispositivos." id="new-password" label="Contraseña nueva">
          <Input autoComplete="new-password" onChange={(event) => setNewPassword(event.target.value)} type="password" value={newPassword} />
        </AccessibleField>
        <Button disabled={busy || !currentPassword || newPassword.length < 8} type="submit">Cambiar contraseña</Button>
      </form>
      <div className="space-y-2">
        <p className="font-mono text-xs font-bold uppercase">Sesiones abiertas</p>
        <ul className="divide-y divide-window-shadow rounded-surface border border-window-shadow text-xs" data-testid="user-sessions">
          {(sessions ?? []).map((row) => (
            <li className="flex flex-wrap justify-between gap-2 p-2" key={row.id}>
              <span>{deviceLabel(row.userAgent)}{row.ipAddress ? ` · ${row.ipAddress}` : ""} · desde {formatDate(row.createdAt)}</span>
              {row.current ? <span className="font-bold text-success-text">Esta sesión</span> : null}
            </li>
          ))}
          {sessions === null ? <li className="p-2 text-muted-foreground">Cargando…</li> : null}
        </ul>
        <Button disabled={busy || others === 0} onClick={() => void revokeOthers()} type="button" variant="outline">
          Cerrar las demás sesiones{others ? ` (${others})` : ""}
        </Button>
      </div>
      <div className="lg:col-span-2">
        <TotpPanel />
      </div>
    </div>
  );
}
