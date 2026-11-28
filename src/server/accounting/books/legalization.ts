import { and, desc, eq, inArray } from "drizzle-orm";

import { fiscalYear, officialBookSubmission } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { AccountingRuleError } from "@/server/accounting/errors";

import { legalizedBooksWarning, type LegalizedBooksNotice, type LegalizedYearView } from "@/server/accounting/books/legalization-model";

export { legalizedBooksWarning, legalizedYearForDate, type LegalizedBooksNotice, type LegalizedYearView } from "@/server/accounting/books/legalization-model";

/** Consultas del aviso de ejercicio legalizado (ver `legalization-model.ts`). */

/** Presentaciones vigentes (estado «presentado») de los ejercicios indicados; una por ejercicio (la última). */
export async function findLegalizedBooks(client: Pick<DbClient, "select">, companyId: string, fiscalYearIds: Array<string | null | undefined>): Promise<LegalizedBooksNotice[]> {
  const ids = [...new Set(fiscalYearIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return [];
  const rows = await client
    .select({
      fiscalYearId: officialBookSubmission.fiscalYearId,
      yearCode: fiscalYear.code,
      submissionId: officialBookSubmission.id,
      submittedAt: officialBookSubmission.submittedAt,
      registryName: officialBookSubmission.registryName,
    })
    .from(officialBookSubmission)
    .innerJoin(fiscalYear, eq(fiscalYear.id, officialBookSubmission.fiscalYearId))
    .where(and(eq(officialBookSubmission.companyId, companyId), eq(officialBookSubmission.status, "submitted"), inArray(officialBookSubmission.fiscalYearId, ids)))
    .orderBy(desc(officialBookSubmission.submittedAt));
  const byYear = new Map<string, LegalizedBooksNotice>();
  for (const row of rows) if (!byYear.has(row.fiscalYearId)) byYear.set(row.fiscalYearId, row);
  return ids.flatMap((id) => byYear.get(id) ?? []);
}

/**
 * Si alguno de los ejercicios tiene los libros presentados y no se ha confirmado, corta con un 409
 * que explica el motivo. Devuelve los avisos aceptados para anotarlos en la auditoría.
 */
export async function requireLegalizedBooksConfirmation(
  client: Pick<DbClient, "select">,
  companyId: string,
  fiscalYearIds: Array<string | null | undefined>,
  acknowledged: boolean | undefined,
): Promise<LegalizedBooksNotice[]> {
  const notices = await findLegalizedBooks(client, companyId, fiscalYearIds);
  if (notices.length > 0 && !acknowledged) {
    throw new AccountingRuleError(409, "LEGALIZED_BOOKS_CONFIRMATION", `${notices.map(legalizedBooksWarning).join(" ")} Marca la confirmación para continuar igualmente.`);
  }
  return notices;
}

/** Ejercicios de la empresa con libros presentados (para los avisos de los formularios y listados). */
export async function listLegalizedYears(companyId: string, client: Pick<DbClient, "select"> = db): Promise<LegalizedYearView[]> {
  const rows = await client
    .select({
      fiscalYearId: officialBookSubmission.fiscalYearId,
      code: fiscalYear.code,
      startsAt: fiscalYear.startsAt,
      endsAt: fiscalYear.endsAt,
      submittedAt: officialBookSubmission.submittedAt,
      registryName: officialBookSubmission.registryName,
    })
    .from(officialBookSubmission)
    .innerJoin(fiscalYear, eq(fiscalYear.id, officialBookSubmission.fiscalYearId))
    .where(and(eq(officialBookSubmission.companyId, companyId), eq(officialBookSubmission.status, "submitted")))
    .orderBy(desc(officialBookSubmission.submittedAt));
  const byYear = new Map<string, LegalizedYearView>();
  for (const row of rows) {
    if (byYear.has(row.fiscalYearId)) continue;
    byYear.set(row.fiscalYearId, {
      fiscalYearId: row.fiscalYearId,
      code: row.code,
      from: row.startsAt.toISOString().slice(0, 10),
      to: row.endsAt.toISOString().slice(0, 10),
      submittedAt: row.submittedAt,
      registryName: row.registryName,
    });
  }
  return [...byYear.values()];
}
