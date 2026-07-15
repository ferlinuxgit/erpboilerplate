import { DeleteButton } from "@/components/delete-button";
import { EditBankTransactionDialog } from "@/components/treasury/bank-dialogs";

type AccountOption = { id: string; bankName: string; iban: string };
type Transaction = { id: string; bankAccountId: string; amount: string; description: string; postedAt: Date | string };

export function BankTransactionRowActions({ accounts, transaction }: { accounts: AccountOption[]; transaction: Transaction }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <EditBankTransactionDialog accounts={accounts} transaction={transaction} />
      <DeleteButton url={`/api/bank-transactions/${transaction.id}`} />
    </div>
  );
}
