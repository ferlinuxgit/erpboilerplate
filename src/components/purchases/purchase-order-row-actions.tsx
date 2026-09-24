"use client";

import Link from "next/link";

import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuLinkItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

type PurchaseOrderRowActionsProps = {
  id: string;
  number?: string;
};

export function PurchaseOrderRowActions({ id, number }: PurchaseOrderRowActionsProps) {
  const reference = number ? `pedido ${number}` : "pedido de compra";
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/purchases/orders/${id}`}>
        Ver pedido
      </Link>
      <DropdownMenu label={`Más acciones de ${number ?? "pedido"}`} trigger="Más">
        <DropdownMenuLinkItem href={`/purchases/orders/${id}/edit`}>Editar</DropdownMenuLinkItem>
        <DropdownMenuSeparator />
        <DeleteButton
          asMenuItem
          url={`/api/purchases/${id}`}
          title={`Eliminar ${reference}`}
          description={`Esta acción eliminará el ${reference} y no se puede deshacer.`}
          successMessage={`${reference.charAt(0).toLocaleUpperCase()}${reference.slice(1)} eliminado correctamente.`}
        />
      </DropdownMenu>
    </div>
  );
}
