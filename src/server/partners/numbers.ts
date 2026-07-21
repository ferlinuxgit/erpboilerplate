import { sql } from "drizzle-orm";

import { partnerNumberSequence } from "@/db/schema";
import type { DbClient } from "@/lib/db";
import { formatPartnerNumber } from "@/lib/partner-number";

export async function reservePartnerNumber(dbClient: DbClient, companyId: string) {
  const [sequence] = await dbClient
    .insert(partnerNumberSequence)
    .values({ companyId, nextNumber: 2 })
    .onConflictDoUpdate({
      target: partnerNumberSequence.companyId,
      set: {
        nextNumber: sql<number>`${partnerNumberSequence.nextNumber} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ nextNumber: partnerNumberSequence.nextNumber });

  if (!sequence) throw new Error("No se pudo reservar el número de tercero.");
  return formatPartnerNumber(sequence.nextNumber - 1);
}
