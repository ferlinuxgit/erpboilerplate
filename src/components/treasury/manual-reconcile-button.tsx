import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { UndoReconciliationButton } from "@/components/treasury/undo-reconciliation-button";

/**
 * Acción de conciliación de un movimiento: los pendientes se abren en la mesa de conciliación
 * (propuestas, reparto entre facturas y asignación a cuenta); los conciliados se pueden deshacer.
 */
export function ManualReconcileButton({ reconciled, transactionId }: { currencyCode?: string; reconciled: boolean; transactionId: string }) {
  if (reconciled) return <UndoReconciliationButton transactionId={transactionId} />;
  return (
    <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/treasury/reconciliation?focus=${encodeURIComponent(transactionId)}#movement-${transactionId}`}>
      Conciliar
    </Link>
  );
}
