"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DestructiveActionDialog } from "@/components/ui/destructive-action-dialog";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { assignableRoles, canManageMemberWithRole, type AppRole } from "@/lib/rbac";
import { roleLabels } from "@/lib/status-labels";

export function TeamMemberActions({
  actorRole,
  membershipId,
  role,
}: {
  actorRole: AppRole;
  membershipId: string;
  role: AppRole;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const options = assignableRoles(actorRole);
  async function changeRole(nextRole: AppRole) {
    setPending(true);
    try {
      const response = await fetch(`/api/team-members/${membershipId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ role: nextRole }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(payload?.message ?? "No se pudo cambiar el rol.");
      toast.success("Rol actualizado.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo cambiar el rol.",
      );
    } finally {
      setPending(false);
    }
  }
  async function remove() {
    setPending(true);
    setRemoveError(null);
    try {
      const response = await fetch(`/api/team-members/${membershipId}`, {
        method: "DELETE",
        headers: getCsrfHeader(),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(payload?.message ?? "No se pudo eliminar el miembro.");
      toast.success("Miembro eliminado.");
      setRemoveOpen(false);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo eliminar el miembro.";
      setRemoveError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }
  if (!canManageMemberWithRole(actorRole, role)) {
    return <span className="text-xs text-muted-foreground">Solo un propietario puede cambiarlo</span>;
  }
  return (
    <div className="flex justify-end gap-2">
      <Select
        aria-label="Rol del miembro"
        className="h-8 w-36"
        defaultValue={role}
        disabled={pending}
        onChange={(event) => {
          const next = options.find((option) => option === event.target.value);
          if (next) void changeRole(next);
        }}
      >
        {options.map((option) => (
          <option key={option} value={option}>{roleLabels[option]}</option>
        ))}
      </Select>
      <Button disabled={pending} onClick={() => setRemoveOpen(true)} size="sm" type="button" variant="ghost">Eliminar</Button>
      <DestructiveActionDialog
        confirmLabel="Retirar acceso"
        description="Se retirará el acceso de este miembro a la organización. Su actividad histórica y los documentos que haya creado se conservarán."
        errorMessage={removeError}
        isSubmitting={pending}
        onCancel={() => { if (!pending) { setRemoveOpen(false); setRemoveError(null); } }}
        onConfirm={remove}
        open={removeOpen}
        title="Retirar acceso del miembro"
      />
    </div>
  );
}
