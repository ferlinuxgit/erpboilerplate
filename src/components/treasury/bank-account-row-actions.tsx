import Link from "next/link";

import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";

export function BankAccountRowActions({ account }: { account: { id: string; bankName: string; iban: string } }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/treasury/bank-accounts/${account.id}/edit`}>
        Editar
      </Link>
      <DeleteButton url={`/api/bank-accounts/${account.id}`} />
    </div>
  );
}
