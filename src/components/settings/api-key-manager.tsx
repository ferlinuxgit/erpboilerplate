"use client";

import { Copy } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { DeleteButton } from "@/components/delete-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResourceList, type ResourceListColumn } from "@/components/ui/resource-list";
import { formatDateTime } from "@/lib/format";
import { getCsrfHeader } from "@/lib/csrf-client";

type ApiKeyRow = {
  id: string;
  name: string;
  createdAt: Date | string;
};

type ApiKeyManagerProps = {
  canManage: boolean;
  rows: ApiKeyRow[];
};

const columns = (canManage: boolean): ResourceListColumn<ApiKeyRow>[] => [
  {
    header: "Nombre",
    cell: (key) => <span className="font-medium">{key.name}</span>,
    exportValue: (key) => key.name,
    sortValue: (key) => key.name,
  },
  {
    header: "Creada",
    cell: (key) => formatDateTime(key.createdAt),
    exportValue: (key) => formatDateTime(key.createdAt),
    sortValue: (key) => new Date(key.createdAt),
  },
  ...(canManage
    ? [
        {
          header: "Acciones",
          cell: (key: ApiKeyRow) => (
            <DeleteButton
              description={`Revoca la API key "${key.name}". Las integraciones que la usen dejarán de funcionar.`}
              successMessage="API key revocada correctamente."
              title="Revocar API key"
              url={`/api/api-keys/${key.id}`}
            />
          ),
          className: "text-right",
        },
      ]
    : []),
];

export function ApiKeyManager({ canManage, rows }: ApiKeyManagerProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [plainKey, setPlainKey] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function createKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setPlainKey(null);
    try {
      const response = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json().catch(() => null)) as { message?: string; plainKey?: string } | null;
      if (!response.ok || !payload?.plainKey) throw new Error(payload?.message ?? "No se pudo crear la API key.");
      setName("");
      setPlainKey(payload.plainKey);
      toast.success("API key creada. Copia la clave ahora; no se volverá a mostrar.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error inesperado.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copyPlainKey() {
    if (!plainKey) return;
    await navigator.clipboard.writeText(plainKey);
    toast.success("API key copiada.");
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
            {isSubmitting ? "Creando..." : "Crear API key"}
          </Button>
        </form>
      ) : (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Tu rol actual es de solo lectura para API keys.</p>
      )}

      {plainKey ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">
          <p className="text-sm font-medium">Clave visible una sola vez</p>
          <div className="mt-2 flex gap-2">
            <Input readOnly value={plainKey} />
            <Button onClick={copyPlainKey} type="button" variant="outline">
              <Copy aria-hidden="true" />
              Copiar
            </Button>
          </div>
        </div>
      ) : null}

      <ResourceList
        columns={columns(canManage)}
        emptyDescription="Crea una API key para conectar integraciones externas con este tenant."
        emptyTitle="No hay API keys activas."
        exportFileName="api-keys.csv"
        getRowId={(key) => key.id}
        getSearchText={(key) => [key.name, formatDateTime(key.createdAt)].join(" ")}
        items={rows}
        searchPlaceholder="Buscar API key"
        testId="api-keys-list"
        title="API keys activas"
      />
    </div>
  );
}
