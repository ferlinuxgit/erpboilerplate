"use client";

import Link from "next/link";

import { DeleteButton } from "@/components/delete-button";
import { RegisterSupplierPaymentButton } from "@/components/purchases/register-supplier-payment-button";
import { buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuLinkItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

type SupplierRowActionsProps = {
  id: string;
  name: string;
  currencyCode: string;
  outstandingBalance: number;
};

export function SupplierRowActions({ currencyCode, id, name, outstandingBalance }: SupplierRowActionsProps) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {/* Opens its own dialog, so it stays a primary (visible) action. */}
      <RegisterSupplierPaymentButton compact currencyCode={currencyCode} outstandingAmount={outstandingBalance} supplierId={id} />
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/suppliers/${id}`}>
        Abrir
      </Link>
      <DropdownMenu label={`Más acciones de ${name}`} trigger="Más">
        <DropdownMenuLinkItem href={`/suppliers/${id}/edit`}>Editar</DropdownMenuLinkItem>
        <DropdownMenuSeparator />
        <DeleteButton
          asMenuItem
          url={`/api/suppliers/${id}`}
          title={`Eliminar proveedor ${name}`}
          description={`Esta acción desactivará el rol de proveedor de ${name}. Los históricos contables se conservan.`}
          successMessage={`Proveedor ${name} eliminado correctamente.`}
        />
      </DropdownMenu>
    </div>
  );
}
