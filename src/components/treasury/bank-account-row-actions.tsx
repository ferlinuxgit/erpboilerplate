import Link from "next/link";

import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";

export function BankAccountRowActions({ id }: { id: string }) {
  return (
    <div className="flex gap-2">
      <Link href={`/treasury/bank-accounts/${id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>Editar</Link>
      <DeleteButton url={`/api/bank-accounts/${id}`} />
    </div>
  );
}
