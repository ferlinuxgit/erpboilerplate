import Link from "next/link";

import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";

export function AccountRowActions({ id }: { id: string }) {
  return (
    <div className="flex gap-2">
      <Link href={`/accounting/accounts/${id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>Editar</Link>
      <DeleteButton url={`/api/accounts/${id}`} />
    </div>
  );
}
