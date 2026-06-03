import Link from "next/link";

import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";

type SupplierRowActionsProps = {
  id: string;
  name: string;
};

export function SupplierRowActions({ id, name }: SupplierRowActionsProps) {
  return (
    <div className="flex gap-2">
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/suppliers/${id}`}>
        Abrir
      </Link>
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/suppliers/${id}/edit`}>
        Editar
      </Link>
      <DeleteButton
        url={`/api/suppliers/${id}`}
        title={`Eliminar proveedor ${name}`}
        description={`Esta acción desactivará el rol de proveedor de ${name}. Los históricos contables se conservan.`}
        successMessage={`Proveedor ${name} eliminado correctamente.`}
      />
    </div>
  );
}
