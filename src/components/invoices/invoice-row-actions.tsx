import Link from "next/link";

import { DeleteButton } from "@/components/delete-button";
import { RegisterInvoicePaymentDialog } from "@/components/invoices/register-invoice-payment-dialog";
import { buttonVariants } from "@/components/ui/button";

type InvoiceRowActionsProps = {
  id: string;
  number: string;
  paymentStatus: string;
  paymentMethods: Array<{ id: string; name: string }>;
  totalAmount: number;
  totalAmountLabel: string;
};

export function InvoiceRowActions({ id, number, paymentMethods, paymentStatus, totalAmount, totalAmountLabel }: InvoiceRowActionsProps) {
  const isVoided = paymentStatus === "VOID";
  return (
    <div className="flex gap-2" data-testid={`invoice-row-actions-${id}`}>
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} data-testid={`invoice-view-${id}`} href={`/invoices/${id}`}>
        Ver
      </Link>
      {!isVoided ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} data-testid={`invoice-edit-${id}`} href={`/invoices/${id}/edit`}>Editar</Link> : null}
      {!isVoided ? <RegisterInvoicePaymentDialog
          invoice={{ id, number, paymentStatus, totalAmount, totalAmountLabel }}
          paymentMethods={paymentMethods}
          triggerSize="sm"
        /> : null}
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/api/invoices/${id}/pdf`} target="_blank">
        PDF
      </Link>
      {!isVoided ? <DeleteButton
        url={`/api/invoices/${id}`}
        label="Anular"
        title={`Anular factura ${number}`}
        description={`Se conservará la factura ${number} y se generará la reversión contable correspondiente. Esta acción no elimina su trazabilidad.`}
        successMessage={`Factura ${number} anulada correctamente.`}
      /> : null}
    </div>
  );
}
