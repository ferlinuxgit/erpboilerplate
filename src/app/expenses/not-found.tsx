import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageShell } from "@/components/ui/page";

export default function ExpensesNotFound() {
  return (
    <PageShell>
      <EmptyState
        action={<Link className={buttonVariants()} href="/expenses">Volver a facturas de proveedor</Link>}
        description="La factura solicitada no existe o no pertenece a la empresa activa."
        title="Factura de proveedor no encontrada"
      />
    </PageShell>
  );
}
