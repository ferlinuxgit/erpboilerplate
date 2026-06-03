import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageShell } from "@/components/ui/page";

export default function ExpensesNotFound() {
  return (
    <PageShell>
      <EmptyState
        action={<Link className={buttonVariants()} href="/expenses">Volver a gastos</Link>}
        description="El recurso de gastos solicitado no existe o no pertenece a la empresa activa."
        title="Gasto no encontrado"
      />
    </PageShell>
  );
}
