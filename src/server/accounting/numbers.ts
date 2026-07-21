import { sql } from "drizzle-orm";

import { journalEntryNumberSequence } from "@/db/schema";
import type { DbClient } from "@/lib/db";
import { formatJournalEntryNumber } from "@/lib/journal-entry-number";

export async function reserveJournalEntryNumber(dbClient: DbClient, companyId: string) {
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
  return formatJournalEntryNumber(sequence.nextNumber - 1);
}
