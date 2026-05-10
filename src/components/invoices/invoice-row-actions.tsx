import Link from "next/link";

import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";

type InvoiceRowActionsProps = {
  id: string;
  number: string;
};

export function InvoiceRowActions({ id, number }: InvoiceRowActionsProps) {
  return (
    <div className="flex gap-2" data-testid={`invoice-row-actions-${id}`}>
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} data-testid={`invoice-edit-${id}`} href={`/invoices/${id}/edit`}>
        Editar
      </Link>
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/treasury?invoiceId=${id}`}>
        Registrar cobro
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
