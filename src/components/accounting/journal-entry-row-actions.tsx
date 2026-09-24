import Link from "next/link";

import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";

export type JournalEntryState = {
  isAutomatic?: boolean;
  reversedAt?: Date | string | null;
  reversesEntryId?: string | null;
};

/** Solo los asientos manuales vigentes se editan o revierten desde aquí. */
export function journalEntryLockReason(entry: JournalEntryState) {
  if (entry.isAutomatic) return "Asiento automático: corrige el documento de origen (factura, cobro, movimiento).";
  if (entry.reversedAt) return "Asiento ya revertido.";
  if (entry.reversesEntryId) return "Es un contraasiento de reversión.";
  return null;
}

export function JournalEntryRowActions({ id, entry = {} }: { id: string; entry?: JournalEntryState }) {
  const lockReason = journalEntryLockReason(entry);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Link href={`/accounting/entries/${id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>Ver</Link>
      {lockReason ? (
        <span className="max-w-56 text-right text-xs text-muted-foreground">{lockReason}</span>
      ) : (
        <>
          <Link href={`/accounting/entries/${id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>Editar</Link>
          <DeleteButton
            description="No se borra nada: se crea un contraasiento con fecha de hoy y el original queda marcado como revertido."
            label="Revertir"
            successMessage="Asiento revertido mediante contraasiento."
            title="Revertir asiento"
            url={`/api/journal-entries/${id}`}
          />
        </>
      )}
    </div>
  );
}
