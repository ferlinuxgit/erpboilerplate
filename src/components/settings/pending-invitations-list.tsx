"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { CopyLinkButton } from "@/components/settings/copy-link-button";
import { Button } from "@/components/ui/button";
import { DestructiveActionDialog } from "@/components/ui/destructive-action-dialog";
import { EmptyState } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate } from "@/lib/format";
import { roleLabels, statusLabel } from "@/lib/status-labels";

export type PendingInvitationRow = {
  id: string;
  email: string;
  role: string;
  url: string;
  expiresAt: string;
  /** Calculado en el servidor al renderizar. */
  expired: boolean;
  invitedByName: string | null;
};

export function PendingInvitationsList({ rows }: { rows: PendingInvitationRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PendingInvitationRow | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function resend(row: PendingInvitationRow) {
    setBusyId(row.id);
    try {
      const response = await fetch(`/api/invitations/${encodeURIComponent(row.id)}/resend`, { method: "POST", headers: getCsrfHeader() });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? "No se pudo reenviar la invitación.");
      toast.success(payload?.emailSent ? `Invitación reenviada a ${row.email}. Caduca en 7 días.` : "Invitación renovada 7 días. Copia el enlace y compártelo.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo reenviar la invitación.");
    } finally {
      setBusyId(null);
    }
  }

  async function cancel() {
    if (!cancelTarget) return;
    setBusyId(cancelTarget.id);
    setCancelError(null);
    try {
      const response = await fetch(`/api/invitations/${encodeURIComponent(cancelTarget.id)}`, { method: "DELETE", headers: getCsrfHeader() });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? "No se pudo cancelar la invitación.");
      toast.success("Invitación cancelada. El enlace ya no funciona.");
      setCancelTarget(null);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo cancelar la invitación.";
      setCancelError(message);
      toast.error(message);
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return <EmptyState description="Cuando invites a alguien aparecerá aquí hasta que acepte." title="No hay invitaciones pendientes" />;
  }

  return (
    <>
      <ul className="divide-y divide-window-shadow border border-window-dark-shadow" data-testid="pending-invitations">
        {rows.map((row) => {
          const expired = row.expired;
          return (
            <li className="flex flex-wrap items-center gap-2 p-2 text-xs" key={row.id}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono font-bold">{row.email}</p>
                <p className="text-muted-foreground">
                  {statusLabel(roleLabels, row.role)}
                  {row.invitedByName ? ` · invitada por ${row.invitedByName}` : ""}
                  {" · "}
                  {expired ? "caducada" : `caduca el ${formatDate(row.expiresAt)}`}
                </p>
              </div>
              {expired ? <StatusBadge tone="warning">Caducada</StatusBadge> : <StatusBadge tone="info">Pendiente</StatusBadge>}
              <div className="flex flex-wrap gap-1">
                <CopyLinkButton size="xs" url={row.url} />
                <Button disabled={busyId === row.id} onClick={() => void resend(row)} size="xs" type="button" variant="outline">
                  {busyId === row.id ? "Enviando…" : "Reenviar"}
                </Button>
                <Button disabled={busyId === row.id} onClick={() => { setCancelError(null); setCancelTarget(row); }} size="xs" type="button" variant="ghost">
                  Cancelar
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <DestructiveActionDialog
        cancelLabel="Mantenerla"
        confirmLabel="Cancelar invitación"
        description={`El enlace enviado a ${cancelTarget?.email ?? "esta persona"} dejará de funcionar. Podrás invitarla de nuevo cuando quieras.`}
        errorMessage={cancelError}
        isSubmitting={Boolean(cancelTarget && busyId === cancelTarget.id)}
        onCancel={() => { if (!busyId) setCancelTarget(null); }}
        onConfirm={cancel}
        open={Boolean(cancelTarget)}
        title="Cancelar invitación"
      />
    </>
  );
}
