"use client";

import { MagnifyingGlass } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageSection } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate } from "@/lib/format";

type TenantRow = {
  id: string;
  name: string;
  createdAt: string;
  trialEndsAt: string | null;
  billingExempt: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
  deletionRequestedAt: string | null;
  ownerEmail: string;
  ownerName: string;
  state: string;
  addons: string[] | null;
  members: number;
  companies: number;
  creditBalance: number;
  monthOcrCostUsd: number;
  monthReadings: number;
};
type Member = { userId: string; name: string; email: string; role: string; disabledAt: string | null; platformAdmin: boolean };
type Movement = { id: string; kind: string; delta: number; description: string; costMicroUsd: number | null; createdAt: string };

const STATE: Record<string, { label: string; tone: "success" | "info" | "warning" | "danger" | "neutral" }> = {
  disabled: { label: "Sin cobro", tone: "neutral" },
  exempt: { label: "Cortesía", tone: "success" },
  trial: { label: "Prueba", tone: "info" },
  active: { label: "De pago", tone: "success" },
  grace: { label: "Impago (gracia)", tone: "warning" },
  past_due: { label: "Impagado", tone: "danger" },
  trial_expired: { label: "Prueba terminada", tone: "danger" },
  canceled: { label: "Cancelado", tone: "danger" },
  suspended: { label: "Suspendido", tone: "danger" },
};

async function send(url: string, body: unknown) {
  const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: JSON.stringify(body) });
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new Error(payload.message ?? "No se pudo completar la acción.");
}

export function PlatformTenants({ initialQuery, tenants }: { initialQuery: string; tenants: TenantRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ members: Member[]; credits: Movement[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<void>, success: string) => {
    setBusy(true);
    try {
      await work();
      toast.success(success);
      router.refresh();
      if (open) await loadDetail(open);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  };

  async function loadDetail(id: string) {
    const response = await fetch(`/api/platform/tenants/${id}`);
    setDetail(response.ok ? await response.json() : null);
  }

  const toggle = (id: string) => {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    setDetail(null);
    void loadDetail(id);
  };

  const tenantAction = (id: string, body: Record<string, unknown>, success: string) => run(() => send(`/api/platform/tenants/${id}`, body), success);

  return (
    <PageSection title="Espacios" description="Pulsa en un espacio para ver sus usuarios, sus créditos y las acciones de soporte.">
      <form className="mb-3 flex max-w-xl gap-2" onSubmit={(event) => { event.preventDefault(); router.push(query.trim() ? `/plataforma?q=${encodeURIComponent(query.trim())}` : "/plataforma"); }}>
        <Input aria-label="Buscar espacio por nombre, email del propietario o id" onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, email del propietario o id" value={query} />
        <Button type="submit" variant="outline"><MagnifyingGlass aria-hidden="true" />Buscar</Button>
      </form>
      <ul className="divide-y divide-window-shadow rounded-surface border border-window-dark-shadow" data-testid="platform-tenants">
        {tenants.map((row) => {
          const state = STATE[row.state] ?? STATE.disabled;
          return (
            <li key={row.id}>
              <button aria-expanded={open === row.id} className="flex w-full flex-wrap items-center justify-between gap-2 p-2.5 text-left hover:bg-window-panel" onClick={() => toggle(row.id)} type="button">
                <span className="min-w-0">
                  <span className="block font-mono text-sm font-bold">{row.name}</span>
                  <span className="block text-xs text-muted-foreground">{row.ownerName} · {row.ownerEmail} · alta {formatDate(row.createdAt)} · {row.companies} empresa{row.companies === 1 ? "" : "s"} · {row.members} usuario{row.members === 1 ? "" : "s"}</span>
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono">{row.creditBalance} créditos · {row.monthReadings} lecturas · {row.monthOcrCostUsd.toFixed(3)} $</span>
                  <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                </span>
              </button>
              {open === row.id ? (
                <div className="space-y-3 border-t border-window-shadow bg-window-panel p-3 text-sm">
                  <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                    <p>Prueba hasta: {row.trialEndsAt ? formatDate(row.trialEndsAt) : "—"}</p>
                    <p>Módulos contratados: {row.addons?.length ? row.addons.join(", ") : "ninguno"}</p>
                    {row.suspendedAt ? <p className="text-danger-text">Suspendido el {formatDate(row.suspendedAt)}: {row.suspendedReason}</p> : null}
                    {row.deletionRequestedAt ? <p className="text-danger-text">Baja solicitada el {formatDate(row.deletionRequestedAt)}</p> : null}
                    <p className="font-mono">id: {row.id}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {row.suspendedAt ? (
                      <Button disabled={busy} onClick={() => void tenantAction(row.id, { action: "unsuspend" }, "Espacio reactivado.")} size="sm" type="button" variant="outline">Reactivar</Button>
                    ) : (
                      <Button disabled={busy} onClick={() => { const reason = window.prompt("Motivo de la suspensión (lo verá el cliente):"); if (reason) void tenantAction(row.id, { action: "suspend", reason }, "Espacio suspendido."); }} size="sm" type="button" variant="outline">Suspender</Button>
                    )}
                    <Button disabled={busy} onClick={() => void tenantAction(row.id, { action: "exempt", exempt: !row.billingExempt }, row.billingExempt ? "Cortesía retirada." : "Cuenta de cortesía.")} size="sm" type="button" variant="outline">
                      {row.billingExempt ? "Quitar cortesía" : "Dar cortesía"}
                    </Button>
                    <Button disabled={busy} onClick={() => { const days = Number(window.prompt("¿Cuántos días más de prueba?", "14")); if (Number.isInteger(days) && days > 0) void tenantAction(row.id, { action: "extendTrial", days }, `Prueba ampliada ${days} días.`); }} size="sm" type="button" variant="outline">Ampliar prueba</Button>
                    <Button disabled={busy} onClick={() => { const credits = Number(window.prompt("Créditos a añadir (negativo para quitar):", "50")); if (Number.isInteger(credits) && credits !== 0) void tenantAction(row.id, { action: "grantCredits", credits, note: "Ajuste de soporte" }, "Créditos ajustados."); }} size="sm" type="button" variant="outline">Ajustar créditos</Button>
                  </div>
                  {detail ? (
                    <div className="grid gap-3 lg:grid-cols-2">
                      <div>
                        <p className="mb-1 font-mono text-xs font-bold uppercase">Usuarios</p>
                        <ul className="divide-y divide-window-shadow rounded-surface border border-window-shadow bg-card text-xs">
                          {detail.members.map((member) => (
                            <li className="flex flex-wrap items-center justify-between gap-2 p-2" key={member.userId}>
                              <span>{member.name} · {member.email} · {member.role}{member.disabledAt ? <span className="ml-1 font-bold text-danger-text">bloqueado</span> : null}</span>
                              <span className="flex gap-1">
                                <Button disabled={busy} onClick={() => void run(() => send(`/api/platform/users/${member.userId}`, { action: "revokeSessions" }), "Sesiones cerradas.")} size="sm" type="button" variant="ghost">Cerrar sesiones</Button>
                                <Button disabled={busy || member.platformAdmin} onClick={() => void run(() => send(`/api/platform/users/${member.userId}`, { action: member.disabledAt ? "enable" : "disable" }), member.disabledAt ? "Usuario desbloqueado." : "Usuario bloqueado.")} size="sm" type="button" variant="ghost">
                                  {member.disabledAt ? "Desbloquear" : "Bloquear"}
                                </Button>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="mb-1 font-mono text-xs font-bold uppercase">Créditos (90 días)</p>
                        <ul className="max-h-64 divide-y divide-window-shadow overflow-y-auto rounded-surface border border-window-shadow bg-card text-xs">
                          {detail.credits.map((movement) => (
                            <li className="flex justify-between gap-2 p-2" key={movement.id}>
                              <span className="min-w-0 truncate">{formatDate(movement.createdAt)} · {movement.description}{movement.costMicroUsd ? ` · ${(movement.costMicroUsd / 1_000_000).toFixed(4)} $` : ""}</span>
                              <span className="font-mono font-bold">{movement.delta > 0 ? "+" : ""}{movement.delta}</span>
                            </li>
                          ))}
                          {detail.credits.length === 0 ? <li className="p-2 text-muted-foreground">Sin movimientos.</li> : null}
                        </ul>
                      </div>
                    </div>
                  ) : <p className="text-xs text-muted-foreground">Cargando…</p>}
                </div>
              ) : null}
            </li>
          );
        })}
        {tenants.length === 0 ? <li className="p-3 text-sm text-muted-foreground">Ningún espacio coincide con la búsqueda.</li> : null}
      </ul>
    </PageSection>
  );
}
