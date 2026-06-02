"use client";

import { Copy, KeyRound, RotateCw, ShieldX } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { DeleteButton } from "@/components/delete-button";
import { Button } from "@/components/ui/button";
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
    }
  }

  return (
    <div className="space-y-5">
      {canManage ? (
        <form className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]" onSubmit={createKey}>
          <label className="sr-only" htmlFor="api-key-name">
            Nombre de API key
          </label>
          <Input id="api-key-name" onChange={(event) => setName(event.target.value)} placeholder="Nombre de integración" required value={name} />
          <Button disabled={isSubmitting} type="submit">
            <KeyRound aria-hidden="true" />
            {isSubmitting ? "Creando..." : "Crear API key"}
          </Button>
        </form>
      ) : (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Tu rol actual es de solo lectura para API keys.</p>
      )}

      {visibleSecret ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">
          <p className="text-sm font-medium">
            {visibleSecret.action === "created" ? "Clave creada" : "Clave rotada"}: {visibleSecret.name}
          </p>
          <p className="mt-1 text-xs">Copia este secreto ahora. No se volverá a mostrar.</p>
          <div className="mt-2 flex gap-2">
            <Input readOnly value={visibleSecret.plainKey} />
            <Button onClick={copyPlainKey} type="button" variant="outline">
              <Copy aria-hidden="true" />
              Copiar
            </Button>
          </div>
        </div>
      ) : null}

      <ResourceList
        columns={columns(canManage, updateToken, activeActionId)}
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
