import { and, eq, sql } from "drizzle-orm";

import { fiscalYear, journalEntryNumberSequence } from "@/db/schema";
import type { DbClient } from "@/lib/db";
import { formatFiscalYearJournalEntryNumber, formatJournalEntryNumber } from "@/lib/journal-entry-number";

export type ReservedJournalEntryNumber = { number: string; fiscalYearId: string | null };

/**
 * Reserva el número del asiento según su fecha: correlativo dentro del ejercicio que contiene
 * `postedAt` (AS-2026/000001…). El contador vive en la fila del ejercicio y se incrementa con un
 * UPDATE atómico, así que dos transacciones concurrentes nunca obtienen el mismo número.
 * Sin ejercicio para la fecha (planes antiguos) se usa la numeración global AS000001.
 */
export async function reserveJournalEntryNumber(dbClient: DbClient, companyId: string, postedAt: Date): Promise<ReservedJournalEntryNumber> {
  const [year] = await dbClient
    .update(fiscalYear)
    .set({ nextJournalEntryNumber: sql`${fiscalYear.nextJournalEntryNumber} + 1` })
    .where(and(
      eq(fiscalYear.companyId, companyId),
      sql`${fiscalYear.id} = (
        select fy."id" from "fiscal_year" fy
        where fy."companyId" = ${companyId}
          and ${postedAt} >= fy."startsAt"
          and ${postedAt} < (fy."endsAt" + interval '1 day')
        order by fy."startsAt" desc
        limit 1
      )`,
    ))
    .returning({ id: fiscalYear.id, code: fiscalYear.code, next: fiscalYear.nextJournalEntryNumber });
  if (year) {
    return { number: formatFiscalYearJournalEntryNumber(year.code, year.next - 1), fiscalYearId: year.id };
  }

  const [sequence] = await dbClient
    .insert(journalEntryNumberSequence)
    .values({ companyId, nextNumber: 2 })
    .onConflictDoUpdate({
      target: journalEntryNumberSequence.companyId,
      set: {
        nextNumber: sql<number>`${journalEntryNumberSequence.nextNumber} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ nextNumber: journalEntryNumberSequence.nextNumber });

  if (!sequence) throw new Error("No se pudo reservar el número de asiento.");
  return { number: formatJournalEntryNumber(sequence.nextNumber - 1), fiscalYearId: null };
}
