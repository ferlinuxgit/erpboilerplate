"use client";

import { Copy, KeyRound, RotateCw, ShieldX } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { DeleteButton } from "@/components/delete-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ResourceList, type ResourceListColumn } from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/format";
import { getCsrfHeader } from "@/lib/csrf-client";

type ApiKeyRow = {
  id: string;
  name: string;
  createdAt: Date | string;
  revokedAt: Date | string | null;
};

type ApiKeyManagerProps = {
  canManage: boolean;
  rows: ApiKeyRow[];
};

type VisibleSecret = {
  keyId: string;
  name: string;
  plainKey: string;
  action: "created" | "rotated";
};

type TokenAction = "rotate" | "revoke";

function publishVisibleSecret(secret: VisibleSecret) {
  window.dispatchEvent(
    new CustomEvent("api-key-secret-visible", {
      detail: {
        keyId: secret.keyId,
        name: secret.name,
        plainKey: secret.plainKey,
      },
    }),
  );
}

const columns = (
  canManage: boolean,
  onTokenAction: (key: ApiKeyRow, action: TokenAction) => Promise<void>,
  activeActionId: string | null,
): ResourceListColumn<ApiKeyRow>[] => [
  {
    header: "Nombre",
    cell: (key) => (
      <div className="space-y-1">
        <span className="font-medium">{key.name}</span>
        <p className="text-xs text-muted-foreground">{key.id}</p>
      </div>
    ),
    exportValue: (key) => key.name,
    sortValue: (key) => key.name,
  },
  {
    header: "Estado",
    cell: (key) => key.revokedAt ? <StatusBadge tone="danger">Revocada</StatusBadge> : <StatusBadge tone="success">Activa</StatusBadge>,
    exportValue: (key) => key.revokedAt ? "Revocada" : "Activa",
    sortValue: (key) => key.revokedAt ? "revocada" : "activa",
  },
  {
    header: "Creada",
    cell: (key) => formatDateTime(key.createdAt),
    exportValue: (key) => formatDateTime(key.createdAt),
    sortValue: (key) => new Date(key.createdAt),
  },
  {
    header: "Revocada",
    cell: (key) => key.revokedAt ? formatDateTime(key.revokedAt) : "—",
    exportValue: (key) => key.revokedAt ? formatDateTime(key.revokedAt) : "",
    sortValue: (key) => key.revokedAt ? new Date(key.revokedAt) : 0,
  },
  ...(canManage
    ? [
        {
          header: "Acciones",
          cell: (key: ApiKeyRow) => (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                disabled={activeActionId === `${key.id}:rotate`}
                onClick={() => onTokenAction(key, "rotate")}
                size="sm"
                type="button"
                variant="outline"
              >
                <RotateCw aria-hidden="true" />
                Rotar
              </Button>
              {!key.revokedAt ? (
                <Button
                  disabled={activeActionId === `${key.id}:revoke`}
                  onClick={() => onTokenAction(key, "revoke")}
                  size="sm"
                  type="button"
                  variant="destructive"
                >
                  <ShieldX aria-hidden="true" />
                  Revocar
                </Button>
              ) : null}
              <DeleteButton
                description={`Elimina definitivamente la API key "${key.name}" del historial operativo.`}
                label="Eliminar"
                successMessage="API key eliminada correctamente."
                title="Eliminar API key"
                url={`/api/api-keys/${key.id}`}
              />
            </div>
          ),
          className: "text-right",
        },
      ]
    : []),
];

export function ApiKeyManager({ canManage, rows }: ApiKeyManagerProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [visibleSecret, setVisibleSecret] = useState<VisibleSecret | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ key: ApiKeyRow; action: TokenAction } | null>(null);

  async function createKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setVisibleSecret(null);
    try {
      const response = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json().catch(() => null)) as { id?: string; name?: string; message?: string; plainKey?: string } | null;
      if (!response.ok || !payload?.plainKey) throw new Error(payload?.message ?? "No se pudo crear la API key.");
      setName("");
      const secret = { keyId: payload.id ?? "new", name: payload.name ?? name, plainKey: payload.plainKey, action: "created" as const };
      setVisibleSecret(secret);
      setCreateOpen(false);
      publishVisibleSecret(secret);
      toast.success("API key creada. Copia la clave ahora; no se volverá a mostrar.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error inesperado.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copyPlainKey() {
    if (!visibleSecret) return;
    await navigator.clipboard.writeText(visibleSecret.plainKey);
    toast.success("API key copiada.");
  }

  async function updateToken(key: ApiKeyRow, action: TokenAction) {
    const actionId = `${key.id}:${action}`;
    setActiveActionId(actionId);
    setVisibleSecret(null);
    try {
      const response = await fetch(`/api/api-keys/${key.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json().catch(() => null)) as { message?: string; plainKey?: string } | null;
      if (!response.ok) throw new Error(payload?.message ?? "No se pudo actualizar la API key.");
      if (action === "rotate") {
        if (!payload?.plainKey) throw new Error("La rotación no devolvió una clave nueva.");
        const secret = { keyId: key.id, name: key.name, plainKey: payload.plainKey, action: "rotated" as const };
        setVisibleSecret(secret);
        publishVisibleSecret(secret);
        toast.success("API key rotada. Copia la nueva clave ahora.");
      } else {
        toast.success("API key revocada correctamente.");
      }
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error inesperado.");
    } finally {
      setActiveActionId(null);
      setPendingAction(null);
    }
  }

  return (
    <div className="space-y-5">
      {canManage ? (
        <div className="flex justify-end"><Button onClick={() => setCreateOpen(true)} type="button"><KeyRound aria-hidden="true" />Crear API key</Button></div>
      ) : (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Tu rol actual es de solo lectura para API keys.</p>
      )}

      <Dialog description="Usa un nombre que identifique con claridad la integración o el entorno." initialFocusId="api-key-name" onClose={() => setCreateOpen(false)} open={createOpen} title="Crear API key">
        <form className="space-y-4" onSubmit={createKey}><div className="space-y-2"><label className="text-sm font-medium" htmlFor="api-key-name">Nombre</label><Input id="api-key-name" onChange={(event) => setName(event.target.value)} placeholder="Integración de producción" required value={name} /></div><DialogFooter><Button onClick={() => setCreateOpen(false)} type="button" variant="outline">Cancelar</Button><Button disabled={isSubmitting} type="submit"><KeyRound aria-hidden="true" />{isSubmitting ? "Creando…" : "Crear API key"}</Button></DialogFooter></form>
      </Dialog>

      <Dialog description="Guárdala ahora en un gestor de secretos. Por seguridad, no volverá a mostrarse." onClose={() => setVisibleSecret(null)} open={Boolean(visibleSecret)} title={visibleSecret?.action === "rotated" ? "API key rotada" : "API key creada"}>
        {visibleSecret ? <div className="space-y-4"><div><p className="text-sm font-medium">{visibleSecret.name}</p><p className="mt-1 break-all rounded-lg border bg-muted/40 p-3 font-mono text-sm" data-testid="api-key-visible-secret">{visibleSecret.plainKey}</p></div><DialogFooter><Button onClick={() => setVisibleSecret(null)} type="button" variant="outline">He terminado</Button><Button onClick={copyPlainKey} type="button"><Copy aria-hidden="true" />Copiar clave</Button></DialogFooter></div> : null}
      </Dialog>

      <Dialog description={pendingAction?.action === "revoke" ? "La clave dejará de funcionar inmediatamente. Esta acción no se puede deshacer." : "La clave actual dejará de funcionar y se generará un secreto nuevo que solo se mostrará una vez."} onClose={() => setPendingAction(null)} open={Boolean(pendingAction)} title={pendingAction?.action === "revoke" ? "Revocar API key" : "Rotar API key"}>
        {pendingAction ? <><p className="text-sm">Clave seleccionada: <span className="font-medium">{pendingAction.key.name}</span></p><DialogFooter><Button onClick={() => setPendingAction(null)} type="button" variant="outline">Cancelar</Button><Button disabled={Boolean(activeActionId)} onClick={() => void updateToken(pendingAction.key, pendingAction.action)} type="button" variant={pendingAction.action === "revoke" ? "destructive" : "default"}>{activeActionId ? "Procesando…" : pendingAction.action === "revoke" ? "Revocar clave" : "Rotar clave"}</Button></DialogFooter></> : null}
      </Dialog>

      <ResourceList
        columns={columns(canManage, async (key, action) => { setPendingAction({ key, action }); }, activeActionId)}
        emptyDescription="Crea una API key para conectar integraciones externas con este tenant."
        emptyTitle="No hay API keys activas."
        exportFileName="api-keys.csv"
        getRowId={(key) => key.id}
        getSearchText={(key) => [key.name, key.revokedAt ? "revocada" : "activa", formatDateTime(key.createdAt)].join(" ")}
        items={rows}
        searchPlaceholder="Buscar API key"
        testId="api-keys-list"
        title="API keys activas"
      />
    </div>
  );
}
