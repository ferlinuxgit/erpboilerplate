import Link from "next/link";

import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";
import { legalizedBooksWarning, type LegalizedYearView } from "@/server/accounting/books/legalization-model";

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

/**
 * Ejercicio con libros presentados a legalizar al que afecta revertir un asiento: el suyo o el
 * ejercicio en curso (donde se anota el contraasiento, con fecha de hoy). Función pura.
 */
export function legalizedYearForReversal(years: readonly LegalizedYearView[], entryFiscalYearId: string | null | undefined, todayKey: string) {
  return years.find((year) => year.fiscalYearId === entryFiscalYearId) ?? years.find((year) => todayKey >= year.from && todayKey <= year.to) ?? null;
}

/**
 * Texto y dirección de la confirmación de «Revertir». Con libros legalizados, el diálogo enseña el
 * aviso y al confirmar se envía la confirmación expresa que exige el servidor.
 */
export function reverseEntryConfirmation(id: string, baseDescription: string, legalized?: LegalizedYearView | null) {
  if (!legalized) return { url: `/api/journal-entries/${id}`, description: baseDescription, label: "Revertir" };
  return {
    url: `/api/journal-entries/${id}?acknowledgeLegalizedBooks=1`,
    description: `ATENCIÓN: ${legalizedBooksWarning({ yearCode: legalized.code, submittedAt: legalized.submittedAt, registryName: legalized.registryName })} ${baseDescription} Al confirmar aceptas continuar igualmente; queda anotado en la auditoría.`,
    label: "Revertir igualmente",
  };
}

export function JournalEntryRowActions({ id, entry = {}, legalized }: { id: string; entry?: JournalEntryState; legalized?: LegalizedYearView | null }) {
  const lockReason = journalEntryLockReason(entry);
  const reverse = reverseEntryConfirmation(id, "No se borra nada: se crea un contraasiento con fecha de hoy y el original queda marcado como revertido.", legalized);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Link href={`/accounting/entries/${id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>Ver</Link>
      {lockReason ? (
        <span className="max-w-56 text-right text-xs text-muted-foreground">{lockReason}</span>
      ) : (
        <>
          <Link href={`/accounting/entries/${id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>Editar</Link>
          <DeleteButton
            description={reverse.description}
            label={reverse.label}
            successMessage="Asiento revertido mediante contraasiento."
            title="Revertir asiento"
            url={reverse.url}
          />
        </>
      )}
    </div>
  );
}
