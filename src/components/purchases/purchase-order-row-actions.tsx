import Link from "next/link";

import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";

export function PurchaseOrderRowActions({ id }: { id: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href={`/purchases/orders/${id}`}>
        Ver pedido
      </Link>
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/purchases/orders/${id}/edit`}>
        Editar
      </Link>
      <DeleteButton url={`/api/purchases/${id}`} />
    </div>
  );
}
