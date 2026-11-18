"use client";

import { DownloadSimple, Trash, WarningCircle } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/page";
import { Input } from "@/components/ui/input";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate } from "@/lib/format";

type Props = {
  canExport: boolean;
  canClose: boolean;
  deletionGraceDays: number;
  deletionRequestedAt: string | null;
  section: "export" | "close" | "user";
  soleOwnerOf: string[];
  tenantName: string;
};

async function call(url: string, method: "POST" | "DELETE", body?: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: body ? JSON.stringify(body) : undefined });
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new Error(payload.message ?? "No se pudo completar la acción.");
}

/** Exportar datos, dar de baja el espacio o borrar el usuario (cada sección pinta su parte). */
export function AccountDataPanel({ canClose, canExport, deletionGraceDays, deletionRequestedAt, section, soleOwnerOf, tenantName }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const run = async (work: () => Promise<void>, success: string, after?: () => void) => {
    setBusy(true);
    try {
      await work();
      toast.success(success);
      if (after) after();
      else router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  };

  if (section === "export") {
    return canExport ? (
      <a className={buttonVariants({ variant: "outline" })} data-testid="tenant-export" download href="/api/tenant/export">
        <DownloadSimple aria-hidden="true" />
        Descargar todos los datos (ZIP)
      </a>
    ) : <p className="text-sm text-muted-foreground">Solo un administrador del espacio puede descargar la exportación completa.</p>;
  }

  if (section === "close") {
    if (!canClose) return <p className="text-sm text-muted-foreground">Solo el propietario puede dar de baja el espacio.</p>;
    if (deletionRequestedAt) {
      const purgeAt = new Date(new Date(deletionRequestedAt).getTime() + deletionGraceDays * 86_400_000).toISOString();
      return (
        <div className="space-y-2">
          <InlineAlert title="Baja solicitada" tone="warning">
            Pediste la baja el {formatDate(deletionRequestedAt)}. Los datos se borrarán a partir del {formatDate(purgeAt)}. Descárgalos antes si los necesitas.
          </InlineAlert>
          <Button disabled={busy} onClick={() => void run(() => call("/api/tenant/deletion", "DELETE"), "Baja anulada: todo sigue como antes.")} type="button" variant="outline">Anular la baja</Button>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        <InlineAlert tone="warning">
          <WarningCircle aria-hidden="true" className="mr-1 inline" />
          Si tienes que conservar facturas y libros (lo exige la ley 4-6 años), descárgalos antes: después del borrado no se pueden recuperar.
        </InlineAlert>
        <Button
          data-testid="tenant-close"
          disabled={busy}
          onClick={() => { if (window.confirm(`¿Dar de baja «${tenantName}»? Tendrás ${deletionGraceDays} días para arrepentirte.`)) void run(() => call("/api/tenant/deletion", "POST"), "Baja solicitada."); }}
          type="button"
          variant="outline"
        >
          Dar de baja el espacio
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {soleOwnerOf.length ? (
        <InlineAlert tone="info">
          Eres el único propietario de {soleOwnerOf.map((name) => `«${name}»`).join(", ")}: antes de borrar tu usuario, pasa la propiedad a otra persona en Equipo o da de baja el espacio.
        </InlineAlert>
      ) : null}
      <label className="block max-w-xs space-y-1 text-sm" htmlFor="delete-user-confirm">
        <span>Escribe <strong>BORRAR</strong> para confirmar</span>
        <Input autoComplete="off" id="delete-user-confirm" onChange={(event) => setConfirmText(event.target.value)} value={confirmText} />
      </label>
      <Button
        disabled={busy || confirmText !== "BORRAR"}
        onClick={() => void run(() => call("/api/account", "DELETE", { confirm: "BORRAR" }), "Tu usuario se ha borrado.", () => { router.push("/"); router.refresh(); })}
        type="button"
        variant="outline"
      >
        <Trash aria-hidden="true" />
        Borrar mi usuario
      </Button>
    </div>
  );
}
