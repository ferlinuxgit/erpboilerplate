import Link from "next/link";

import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";

export function CustomerRowActions({ id }: { id: string }) {
  return (
    <div className="flex gap-2">
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/customers/${id}/edit`}>
        Editar
      </Link>
      <DeleteButton url={`/api/customers/${id}`} />
    </div>
  );
}
