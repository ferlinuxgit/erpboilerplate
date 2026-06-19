import Link from "next/link";

import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";

export function AccountRowActions({ id }: { id: string }) {
  return (
    <div className="flex gap-2">
      <Link href={`/accounting/accounts/${id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>Editar</Link>
      <DeleteButton
        description="La cuenta quedará inactiva en el plan contable, pero no se borrará del catálogo ni de los movimientos existentes."
        label="Desactivar"
        successMessage="Cuenta desactivada correctamente."
        title="Desactivar cuenta"
        url={`/api/accounts/${id}`}
      />
    </div>
  );
}
