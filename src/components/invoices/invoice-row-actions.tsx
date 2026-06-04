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
  return (
    <div className="flex gap-2" data-testid={`invoice-row-actions-${id}`}>
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} data-testid={`invoice-view-${id}`} href={`/invoices/${id}`}>
        Ver
      </Link>
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} data-testid={`invoice-edit-${id}`} href={`/invoices/${id}/edit`}>
        Editar
      </Link>
      <RegisterInvoicePaymentDialog
        invoice={{ id, number, paymentStatus, totalAmount, totalAmountLabel }}
        paymentMethods={paymentMethods}
        triggerSize="sm"
      />
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/api/invoices/${id}/pdf`} target="_blank">
        PDF
      </Link>
      <DeleteButton
        url={`/api/invoices/${id}`}
        title={`Eliminar factura ${number}`}
        description={`Esta acción eliminará la factura ${number} y no se puede deshacer.`}
        successMessage={`Factura ${number} eliminada correctamente.`}
      />
    </div>
  );
}
