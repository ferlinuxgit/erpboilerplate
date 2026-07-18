import Link from "next/link";

import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";

export function AccountRowActions({ account }: { account: { id: string; code: string; name: string; type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE" | "MIXED" } }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/accounting/accounts/${account.id}/edit`}>
        Editar
      </Link>
      <DeleteButton
        description="La cuenta quedará inactiva en el plan contable, pero no se borrará del catálogo ni de los movimientos existentes."
        label="Desactivar"
        successMessage="Cuenta desactivada correctamente."
        title="Desactivar cuenta"
        url={`/api/accounts/${account.id}`}
      />
    </div>
  );
}
