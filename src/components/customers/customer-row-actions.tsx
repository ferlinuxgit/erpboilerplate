"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { DestructiveActionDialog } from "@/components/ui/destructive-action-dialog";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuItem, DropdownMenuLinkItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { InlineAlert } from "@/components/ui/page";
import { getCsrfHeader } from "@/lib/csrf-client";

type CustomerRowActionsProps = {
  id: string;
  name: string;
  status?: "ACTIVE" | "INACTIVE";
  /** Tiene facturas, presupuestos, pedidos o albaranes: no se puede eliminar, solo desactivar. */
  hasDocuments?: boolean;
};

const HAS_DOCUMENTS_REASON = "Tiene documentos; márcalo como Inactivo para que deje de aparecer al facturar.";

/** Eliminar / marcar como inactivo un cliente, con la alternativa explicada si tiene documentos. */
export function useCustomerRemoval({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

  async function remove() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/customers/${id}`, { method: "DELETE", headers: getCsrfHeader() });
      if (response.status === 409) {
        // Tiene documentos: se ofrece la acción correcta en lugar de un error.
        setBlockedReason(await readApiError(response, HAS_DOCUMENTS_REASON));
        setDeleteOpen(false);
        setDeactivateOpen(true);
        return;
      }
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo eliminar el cliente."));
      setDeleteOpen(false);
      toast.success(`Cliente ${name} eliminado.`);
      router.refresh();
    } catch (removeError) {
      const message = errorMessage(removeError, "No se pudo eliminar el cliente.");
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  async function deactivate() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/customers/${id}/deactivate`, { method: "POST", headers: { "Content-Type": "application/json", ...getCsrfHeader() } });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo marcar el cliente como inactivo."));
      setDeactivateOpen(false);
      toast.success(`${name} marcado como inactivo. Ya no aparecerá al crear facturas.`);
      router.refresh();
    } catch (deactivateError) {
      const message = errorMessage(deactivateError, "No se pudo marcar el cliente como inactivo.");
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  const dialogs = (
    <>
      <DestructiveActionDialog
        confirmLabel="Eliminar"
        description={`Se eliminará el cliente ${name}. No tiene documentos, así que no se pierde ningún historial. Esta acción no se puede deshacer.`}
        errorMessage={error}
        isSubmitting={pending}
        onCancel={() => { if (!pending) setDeleteOpen(false); }}
        onConfirm={() => void remove()}
        open={deleteOpen}
        title={`Eliminar cliente ${name}`}
      />
      <Dialog
        description="Un cliente inactivo deja de aparecer al crear facturas y presupuestos, pero conserva sus documentos e historial. Puedes reactivarlo cuando quieras desde Editar."
        initialFocusId={`customer-deactivate-cancel-${id}`}
        onClose={() => { if (!pending) setDeactivateOpen(false); }}
        open={deactivateOpen}
        size="sm"
        title={`Marcar ${name} como inactivo`}
      >
        {blockedReason ? <InlineAlert data-testid="customer-delete-blocked" tone="info">{blockedReason}</InlineAlert> : null}
        {error ? <InlineAlert role="alert" tone="danger">{error}</InlineAlert> : null}
        <DialogFooter>
          <Button disabled={pending} id={`customer-deactivate-cancel-${id}`} onClick={() => setDeactivateOpen(false)} type="button" variant="outline">
            Cancelar
          </Button>
          <SubmitButton data-testid="customer-deactivate-confirm" onClick={() => void deactivate()} pending={pending} pendingLabel="Guardando…" type="button">
            Marcar como inactivo
          </SubmitButton>
        </DialogFooter>
      </Dialog>
    </>
  );

  return {
    openDelete: () => { setError(null); setDeleteOpen(true); },
    openDeactivate: (reason?: string) => { setError(null); setBlockedReason(reason ?? null); setDeactivateOpen(true); },
    dialogs,
  };
}

export function CustomerRowActions({ hasDocuments = false, id, name, status = "ACTIVE" }: CustomerRowActionsProps) {
  const removal = useCustomerRemoval({ id, name });
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/invoices/new?customerId=${id}`}>
        Nueva factura
      </Link>
      <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href={`/sales/new?customerId=${id}`}>
        Crear presupuesto
      </Link>
      <DropdownMenu label={`Más acciones de ${name}`} trigger="Más">
        <DropdownMenuLinkItem href={`/customers/${id}`}>Ver ficha</DropdownMenuLinkItem>
        <DropdownMenuLinkItem href={`/customers/${id}/edit`}>Editar</DropdownMenuLinkItem>
        <DropdownMenuSeparator />
        {status === "ACTIVE" ? (
          <DropdownMenuItem data-testid={`customer-deactivate-${id}`} onClick={() => removal.openDeactivate()}>
            Marcar como inactivo…
          </DropdownMenuItem>
        ) : null}
        {hasDocuments ? (
          <DropdownMenuItem aria-disabled="true" className="cursor-not-allowed opacity-60" data-testid={`customer-delete-disabled-${id}`} onClick={() => removal.openDeactivate(HAS_DOCUMENTS_REASON)} title={HAS_DOCUMENTS_REASON}>
            No se puede eliminar: tiene documentos
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem data-testid={`customer-delete-${id}`} destructive onClick={removal.openDelete}>
            Eliminar…
          </DropdownMenuItem>
        )}
      </DropdownMenu>
      {removal.dialogs}
    </div>
  );
}
