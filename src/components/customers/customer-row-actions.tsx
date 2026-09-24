"use client";

import Link from "next/link";

import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuLinkItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

type CustomerRowActionsProps = {
  id: string;
  name: string;
};

export function CustomerRowActions({ id, name }: CustomerRowActionsProps) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/sales/new?customerId=${id}`}>
        Crear presupuesto
      </Link>
      <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href={`/customers/${id}`}>
        Ver ficha
      </Link>
      <DropdownMenu label={`Más acciones de ${name}`} trigger="Más">
        <DropdownMenuLinkItem href={`/customers/${id}/edit`}>Editar</DropdownMenuLinkItem>
        <DropdownMenuSeparator />
        <DeleteButton
          asMenuItem
          url={`/api/customers/${id}`}
          title={`Eliminar cliente ${name}`}
          description={`Esta acción eliminará el cliente ${name} y no se puede deshacer.`}
          successMessage={`Cliente ${name} eliminado correctamente.`}
        />
      </DropdownMenu>
    </div>
  );
}
