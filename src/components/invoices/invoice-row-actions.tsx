"use client";

import Link from "next/link";

import { DeleteButton } from "@/components/delete-button";
import { RegisterInvoicePaymentDialog } from "@/components/invoices/register-invoice-payment-dialog";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

type InvoiceRowActionsProps = {
  id: string;
  number: string;
  paymentStatus: string;
  paymentMethods: Array<{ id: string; name: string }>;
  totalAmount: number;
  totalAmountLabel: string;
  /** Saldo pendiente para proponer en "Registrar cobro" (por defecto, el total). */
  outstandingAmount?: number;
  /**
   * Ciclo de vida (`invoiceLifecycle`). Si no se indica se mantiene el comportamiento histórico;
   * la API rechaza igualmente cobrar borradores o anular facturas emitidas con un mensaje claro.
   */
  lifecycle?: "DRAFT" | "ISSUED" | "VOID";
  invoiceType?: "INVOICE" | "CREDIT_NOTE" | string;
};

export function InvoiceRowActions({
  id,
  invoiceType = "INVOICE",
  lifecycle,
  number,
  outstandingAmount,
  paymentMethods,
  paymentStatus,
  totalAmount,
  totalAmountLabel,
}: InvoiceRowActionsProps) {
  const isVoided = paymentStatus === "VOID" || lifecycle === "VOID";
  const isCreditNote = invoiceType === "CREDIT_NOTE";
  const isDraft = lifecycle === "DRAFT";
  const isIssued = lifecycle === "ISSUED";
  const canCollect = !isVoided && !isDraft && !isCreditNote;
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5" data-testid={`invoice-row-actions-${id}`}>
      {canCollect ? (
        <RegisterInvoicePaymentDialog
          invoice={{ id, number, paymentStatus, totalAmount, totalAmountLabel, outstandingAmount }}
          paymentMethods={paymentMethods}
          triggerSize="sm"
        />
      ) : null}
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} data-testid={`invoice-view-${id}`} href={`/invoices/${id}`}>
        Ver
      </Link>
      <DropdownMenu label={`Más acciones de ${number}`} trigger="Más" triggerTestId={`invoice-more-${id}`}>
        {!isVoided ? (
          <DropdownMenuLinkItem data-testid={`invoice-edit-${id}`} href={`/invoices/${id}/edit`}>
            {isIssued ? "Editar notas" : "Editar"}
          </DropdownMenuLinkItem>
        ) : null}
        {isIssued && !isCreditNote ? (
          <DropdownMenuLinkItem data-testid={`invoice-rectify-${id}`} href={`/invoices/${id}/rectify`}>
            Crear rectificativa
          </DropdownMenuLinkItem>
        ) : null}
        <DropdownMenuLinkItem
          href={`/api/invoices/${id}/pdf`}
          prefetch={false}
          rel="noopener"
          target="_blank"
          title={`Abrir PDF de ${number} en una pestaña nueva`}
        >
          PDF
        </DropdownMenuLinkItem>
        {!isVoided && !isIssued ? (
          <>
            <DropdownMenuSeparator />
            <DeleteButton
              asMenuItem
              url={`/api/invoices/${id}`}
              label={isDraft ? "Anular borrador" : "Anular"}
              title={`Anular ${isDraft ? "borrador" : "factura"} ${number}`}
              description={isDraft
                ? `Se anulará el borrador ${number}. No consume número ni tiene efectos contables.`
                : `Solo se pueden anular borradores. Si ${number} ya está emitida, crea una factura rectificativa desde su ficha.`}
              successMessage={`${isDraft ? "Borrador" : "Factura"} ${number} anulado correctamente.`}
              testId={`invoice-void-${id}`}
            />
          </>
        ) : null}
      </DropdownMenu>
    </div>
  );
}
