"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { EmptyState, InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatIban } from "@/lib/bank-import/iban";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate, formatDateTime } from "@/lib/format";

type ConnectionAccount = { id: string; iban: string | null; name: string | null; currency: string | null; bankAccountId: string | null; lastSyncedAt: Date | string | null; lastSyncError: string | null };
type Connection = {
  id: string;
  institutionName: string;
  status: string;
  consentExpiresAt: Date | string | null;
  lastSyncedAt: Date | string | null;
  lastSyncError: string | null;
  daysLeft: number | null;
  needsRenewal: boolean;
  accounts: ConnectionAccount[];
};
type Institution = { id: string; name: string; bic: string | null };
type Account = { id: string; bankName: string; iban: string };

const statusLabels: Record<string, string> = { PENDING: "Esperando permiso", LINKED: "Conectado", EXPIRED: "Permiso caducado", ERROR: "Error" };

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  return status === "LINKED" ? "success" : status === "EXPIRED" || status === "PENDING" ? "warning" : status === "ERROR" ? "danger" : "neutral";
}

async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...getCsrfHeader() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await readApiError(response, "No se pudo completar la operación."));
  return response.json() as Promise<unknown>;
}

/** Conexiones PSD2: conectar un banco, sincronizar, renovar el permiso y elegir la cuenta de destino. */
export function BankConnectionsManager({ accounts, canWrite, connections }: { accounts: Account[]; canWrite: boolean; connections: Connection[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [institutions, setInstitutions] = useState<Institution[] | null>(null);
  const [query, setQuery] = useState("");
  const [institutionId, setInstitutionId] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function loadInstitutions() {
    setError(null);
    setBusy("institutions");
    try {
      const response = await fetch("/api/bank-connections/institutions", { cache: "no-store" });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo cargar la lista de bancos."));
      setInstitutions((await response.json()) as Institution[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo cargar la lista de bancos.");
    } finally {
      setBusy(null);
    }
  }

  async function goToBank(promise: Promise<unknown>) {
    const result = (await promise) as { link?: string };
    if (!result.link) throw new Error("El servicio no devolvió el enlace del banco.");
    window.location.assign(result.link);
  }

  async function run(key: string, action: () => Promise<void>) {
    setError(null);
    setBusy(key);
    try {
      await action();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "No se pudo completar la operación.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  }

  const filtered = (institutions ?? []).filter((institution) => institution.name.toLocaleLowerCase("es-ES").includes(query.trim().toLocaleLowerCase("es-ES"))).slice(0, 200);

  return (
    <div className="space-y-4" data-testid="bank-connections">
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {connections.length === 0 ? <EmptyState title="Ningún banco conectado" description="Conecta tu banco para recibir los movimientos sin descargar extractos." /> : null}
      {connections.map((connection) => (
        <div className="space-y-2 border p-3" key={connection.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-mono font-bold">{connection.institutionName}</p>
              <p className="text-xs text-muted-foreground">
                {connection.consentExpiresAt ? `Permiso hasta el ${formatDate(connection.consentExpiresAt)}${connection.daysLeft !== null && connection.daysLeft >= 0 ? ` (quedan ${connection.daysLeft} días)` : ""}` : "Permiso pendiente"}
                {" · "}
                {connection.lastSyncedAt ? `Última sincronización: ${formatDateTime(connection.lastSyncedAt)}` : "Sin sincronizar todavía"}
              </p>
              {connection.lastSyncError ? <p className="text-xs text-destructive">{connection.lastSyncError}</p> : null}
            </div>
            <StatusBadge tone={statusTone(connection.status)}>{statusLabels[connection.status] ?? connection.status}</StatusBadge>
          </div>
          {connection.needsRenewal ? (
            <InlineAlert tone="warning">
              {connection.status === "EXPIRED" ? "El permiso de 90 días ha caducado: renuévalo para seguir recibiendo movimientos." : "El permiso de 90 días caduca pronto: renuévalo para no perder movimientos."}
            </InlineAlert>
          ) : null}
          {connection.accounts.length > 0 ? (
            <ul className="space-y-1">
              {connection.accounts.map((account) => (
                <li className="flex flex-wrap items-center justify-between gap-2 text-sm" key={account.id}>
                  <span>
                    <span className="font-mono">{account.iban ? formatIban(account.iban) : "Cuenta sin IBAN"}</span>
                    {account.name ? <span className="text-muted-foreground"> · {account.name}</span> : null}
                    {account.lastSyncError ? <span className="block text-xs text-destructive">{account.lastSyncError}</span> : null}
                  </span>
                  <label className="flex items-center gap-2 text-xs">
                    <span>Volcar en</span>
                    <Select
                      aria-label={`Cuenta de destino de ${account.iban ?? account.name ?? "la cuenta"}`}
                      disabled={!canWrite || busy !== null}
                      onChange={(event) => void run(`link-${account.id}`, async () => {
                        await send(`/api/bank-connections/${connection.id}`, "PATCH", { action: "link", accountId: account.id, bankAccountId: event.target.value || null });
                        toast.success("Cuenta de destino guardada.");
                        router.refresh();
                      })}
                      value={account.bankAccountId ?? ""}
                    >
                      <option value="">No sincronizar</option>
                      {accounts.map((own) => <option key={own.id} value={own.id}>{own.bankName} · {formatIban(own.iban)}</option>)}
                    </Select>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              {connection.status === "LINKED" ? (
                <Button disabled={busy !== null} onClick={() => void run(`sync-${connection.id}`, async () => {
                  const result = (await send(`/api/bank-connections/${connection.id}`, "PATCH", { action: "sync" })) as { imported: number; duplicates: number; autoAssigned: number; errors: string[] };
                  if (result.errors.length) toast.warning(result.errors[0]);
                  toast.success(`${result.imported} movimientos nuevos${result.autoAssigned ? `, ${result.autoAssigned} asignados por reglas` : ""}.`);
                  router.refresh();
                })} size="sm" type="button">{busy === `sync-${connection.id}` ? "Sincronizando…" : "Sincronizar ahora"}</Button>
              ) : null}
              <Button disabled={busy !== null} onClick={() => void run(`renew-${connection.id}`, () => goToBank(send(`/api/bank-connections/${connection.id}`, "PATCH", { action: "renew" })))} size="sm" type="button" variant="outline">
                {connection.status === "PENDING" ? "Volver a dar permiso" : "Renovar permiso"}
              </Button>
              <Button disabled={busy !== null} onClick={() => {
                if (!window.confirm(`¿Desconectar ${connection.institutionName}? Dejaremos de recibir sus movimientos; los ya importados se quedan.`)) return;
                void run(`revoke-${connection.id}`, async () => {
                  await send(`/api/bank-connections/${connection.id}`, "DELETE");
                  toast.success("Banco desconectado.");
                  router.refresh();
                });
              }} size="sm" type="button" variant="ghost">Desconectar</Button>
            </div>
          ) : null}
        </div>
      ))}
      {canWrite ? (
        <div className="space-y-2 border border-dashed p-3">
          <p className="font-mono text-sm font-bold">Conectar un banco</p>
          {institutions === null ? (
            <Button disabled={busy !== null} onClick={() => void loadInstitutions()} type="button" variant="outline">{busy === "institutions" ? "Cargando bancos…" : "Elegir mi banco"}</Button>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <AccessibleField id="bank-connection-search" label="Buscar banco">
                <Input onChange={(event) => setQuery(event.target.value)} placeholder="Santander, BBVA, CaixaBank…" value={query} />
              </AccessibleField>
              <AccessibleField id="bank-connection-institution" label="Banco">
                <Select onChange={(event) => setInstitutionId(event.target.value)} value={institutionId}>
                  <option value="">Elige tu banco</option>
                  {filtered.map((institution) => <option key={institution.id} value={institution.id}>{institution.name}</option>)}
                </Select>
              </AccessibleField>
              <div className="sm:col-span-2">
                <Button disabled={!institutionId || busy !== null} onClick={() => void run("connect", () => goToBank(send("/api/bank-connections", "POST", { institutionId })))} type="button">
                  {busy === "connect" ? "Abriendo tu banco…" : "Ir a mi banco a dar permiso"}
                </Button>
                <p className="mt-1 text-xs text-muted-foreground">Te llevaremos a la web de tu banco. Al terminar volverás aquí automáticamente.</p>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
