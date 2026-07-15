import { DeleteButton } from "@/components/delete-button";
import { EditBankAccountDialog } from "@/components/treasury/bank-dialogs";

export function BankAccountRowActions({ account }: { account: { id: string; bankName: string; iban: string } }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <EditBankAccountDialog account={account} />
      <DeleteButton url={`/api/bank-accounts/${account.id}`} />
    </div>
  );
}
