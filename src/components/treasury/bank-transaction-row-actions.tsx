import Link from "next/link";

import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";
import { ManualReconcileButton } from "@/components/treasury/manual-reconcile-button";

type Transaction = { id: string; bankAccountId: string; amount: string; description: string; postedAt: Date | string; reconciliationStatus: string };

export function BankTransactionRowActions({ currencyCode, transaction }: { currencyCode: string; transaction: Transaction }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href={`/treasury/bank-transactions/${transaction.id}`}>
        Ver
      </Link>
      <ManualReconcileButton currencyCode={currencyCode} reconciled={transaction.reconciliationStatus === "RECONCILED"} transactionId={transaction.id} />
      {transaction.reconciliationStatus !== "RECONCILED" ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/treasury/bank-transactions/${transaction.id}/edit`}>Editar</Link> : null}
      {transaction.reconciliationStatus !== "RECONCILED" ? <DeleteButton url={`/api/bank-transactions/${transaction.id}`} /> : null}
    </div>
  );
}
