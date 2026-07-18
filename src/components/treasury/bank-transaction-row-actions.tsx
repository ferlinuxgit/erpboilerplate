import Link from "next/link";

import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";

type AccountOption = { id: string; bankName: string; iban: string };
type Transaction = { id: string; bankAccountId: string; amount: string; description: string; postedAt: Date | string; reconciliationStatus: string };

export function BankTransactionRowActions({ transaction }: { accounts: AccountOption[]; transaction: Transaction }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href={`/treasury/bank-transactions/${transaction.id}`}>
        Ver
      </Link>
      {transaction.reconciliationStatus !== "RECONCILED" ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/treasury/bank-transactions/${transaction.id}/edit`}>Editar</Link> : null}
      {transaction.reconciliationStatus !== "RECONCILED" ? <DeleteButton url={`/api/bank-transactions/${transaction.id}`} /> : null}
    </div>
  );
}
