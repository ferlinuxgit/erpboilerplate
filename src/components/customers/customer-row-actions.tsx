import Link from "next/link";

import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";

type CustomerRowActionsProps = {
  id: string;
  name: string;
};

export function CustomerRowActions({ id, name }: CustomerRowActionsProps) {
  return (
    <div className="flex gap-2">
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/sales?customerId=${id}`}>
        Crear presupuesto
      </Link>
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/customers/${id}/edit`}>
        Editar
      </Link>
      <DeleteButton
        url={`/api/customers/${id}`}
        title={`Eliminar cliente ${name}`}
        description={`Esta acción eliminará el cliente ${name} y no se puede deshacer.`}
        successMessage={`Cliente ${name} eliminado correctamente.`}
      />
    </div>
  );
}
