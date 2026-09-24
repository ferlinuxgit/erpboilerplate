import Link from "next/link";

import { DeleteButton } from "@/components/delete-button";
import { BankAccountArchiveButton } from "@/components/treasury/bank-account-archive-button";
import { buttonVariants } from "@/components/ui/button";

export function BankAccountRowActions({ account }: { account: { id: string; bankName: string; iban: string; isActive?: boolean } }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href={`/treasury/bank-accounts/${account.id}`}>
        Ver
      </Link>
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/treasury/bank-accounts/${account.id}/edit`}>
        Editar
      </Link>
      <BankAccountArchiveButton accountId={account.id} bankName={account.bankName} isActive={account.isActive !== false} />
      <DeleteButton
        description="Solo se pueden borrar cuentas sin movimientos. Si la cuenta tiene historial, archívala: dejará de admitir movimientos pero conservará sus asientos."
        successMessage={`Cuenta ${account.bankName} eliminada.`}
        title="Eliminar cuenta bancaria"
        url={`/api/bank-accounts/${account.id}`}
      />
    </div>
  );
}
