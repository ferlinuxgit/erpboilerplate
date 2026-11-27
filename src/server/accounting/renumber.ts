import { and, eq, inArray, sql } from "drizzle-orm";

import { fiscalYear, journalEntry } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { findLegalizedBooks } from "@/server/accounting/books/legalization";
import { AccountingRuleError } from "@/server/accounting/errors";
import { loadCompanyTimeZone } from "@/server/accounting/fiscal-year-date";
import { planEntryRenumbering, type RenumberChange, type RenumberPlan } from "@/server/accounting/renumber-model";
import { recordAudit } from "@/server/audit";

/**
 * Renumeración de los asientos de un ejercicio por fecha (ver `renumber-model.ts`).
 * Solo en ejercicios abiertos y sin libros presentados a legalizar: en un ejercicio cerrado o
 * legalizado los números ya figuran en libros entregados y no se tocan.
 */

type Actor = { companyId: string; tenantId: string; actorUserId: string };

const PREVIEW_SAMPLE = 15;
const CHUNK = 500;

type YearRow = { id: string; code: string; isClosed: boolean };

async function loadYear(client: DbClient, companyId: string, fiscalYearId: string, lock: boolean): Promise<YearRow> {
  const query = client
    .select({ id: fiscalYear.id, code: fiscalYear.code, isClosed: fiscalYear.isClosed })
    .from(fiscalYear)
    .where(and(eq(fiscalYear.id, fiscalYearId), eq(fiscalYear.companyId, companyId)))
    .limit(1);
  // El bloqueo de la fila del ejercicio detiene también la numeración de asientos nuevos
  // (`reserveJournalEntryNumber` actualiza esa misma fila) hasta que termina la renumeración.
  const [year] = lock ? await query.for("update") : await query;
  if (!year) throw new AccountingRuleError(404, "FISCAL_YEAR_NOT_FOUND", "Ejercicio no encontrado.");
  return year;
}

/** Motivo por el que el ejercicio no se puede renumerar; null si se puede. */
async function blockedReason(client: DbClient, companyId: string, year: YearRow) {
  if (year.isClosed) return `El ejercicio ${year.code} está cerrado: sus asientos ya no se renumeran. Si de verdad lo necesitas, reábrelo antes.`;
  const [legalized] = await findLegalizedBooks(client, companyId, [year.id]);
  if (legalized) return `Los libros del ejercicio ${year.code} están presentados a legalizar: sus asientos ya no se renumeran, porque los números dejarían de coincidir con el Libro Diario entregado al Registro Mercantil.`;
  return null;
}

async function loadPlan(client: DbClient, companyId: string, year: YearRow): Promise<RenumberPlan> {
  const entries = await client
    .select({ id: journalEntry.id, number: journalEntry.number, postedAt: journalEntry.postedAt, sourceType: journalEntry.sourceType, reference: journalEntry.reference })
    .from(journalEntry)
    .where(and(eq(journalEntry.companyId, companyId), eq(journalEntry.fiscalYearId, year.id)));
  return planEntryRenumbering(entries, year.code, await loadCompanyTimeZone(client, companyId));
}

export type RenumberPreview = {
  fiscalYearId: string;
  yearCode: string;
  total: number;
  /** Asientos cuyo número cambiaría. */
  changes: number;
  /** Primeros cambios, para enseñarlos antes de confirmar. */
  sample: RenumberChange[];
  /** Si no es null, no se puede renumerar y este es el motivo. */
  blockedReason: string | null;
};

/** Vista previa (solo lectura): cuántos asientos cambiarían de número y los primeros cambios. */
export async function previewEntryRenumbering(companyId: string, fiscalYearId: string): Promise<RenumberPreview> {
  const year = await loadYear(db, companyId, fiscalYearId, false);
  const [plan, blocked] = await Promise.all([loadPlan(db, companyId, year), blockedReason(db, companyId, year)]);
  return { fiscalYearId: year.id, yearCode: year.code, total: plan.total, changes: plan.changes.length, sample: plan.changes.slice(0, PREVIEW_SAMPLE), blockedReason: blocked };
}

/**
 * Renumera los asientos del ejercicio por fecha en una sola transacción, con el ejercicio bloqueado.
 * Los números son únicos por empresa, así que se cambia en dos pasos (primero a un número
 * provisional y después al definitivo) para que ningún asiento choque con otro a mitad del cambio.
 * Deja el contador del ejercicio en el siguiente número libre y anota en la auditoría el mapa
 * número antiguo → número nuevo.
 */
export async function renumberFiscalYearEntries(input: Actor & { fiscalYearId: string }) {
  return db.transaction(async (tx) => {
    const year = await loadYear(tx, input.companyId, input.fiscalYearId, true);
    const blocked = await blockedReason(tx, input.companyId, year);
    if (blocked) throw new AccountingRuleError(409, "RENUMBER_NOT_ALLOWED", blocked);

    const plan = await loadPlan(tx, input.companyId, year);
    if (plan.changes.length > 0) {
      const changingIds = plan.changes.map((change) => change.id);
      const changing = new Set(changingIds);
      // Un número nuevo no puede estar ya en un asiento de fuera del ejercicio (dato anómalo: un
      // asiento con numeración de este ejercicio pero asignado a otro).
      const targets = plan.changes.map((change) => change.to);
      for (let start = 0; start < targets.length; start += CHUNK) {
        const clashes = await tx
          .select({ id: journalEntry.id, number: journalEntry.number })
          .from(journalEntry)
          .where(and(eq(journalEntry.companyId, input.companyId), inArray(journalEntry.number, targets.slice(start, start + CHUNK))));
        const outside = clashes.find((row) => !changing.has(row.id));
        if (outside) {
          throw new AccountingRuleError(409, "RENUMBER_NUMBER_TAKEN", `No se puede renumerar: el número ${outside.number} lo tiene un asiento que no es de este ejercicio. Revisa ese asiento antes de continuar.`);
        }
      }

      // Paso 1: número provisional (único: lleva el identificador del asiento).
      for (let start = 0; start < changingIds.length; start += CHUNK) {
        await tx
          .update(journalEntry)
          .set({ number: sql`'~RN~' || ${journalEntry.id}` })
          .where(and(eq(journalEntry.companyId, input.companyId), inArray(journalEntry.id, changingIds.slice(start, start + CHUNK))));
      }
      // Paso 2: número definitivo.
      for (let start = 0; start < plan.changes.length; start += CHUNK) {
        const values = sql.join(plan.changes.slice(start, start + CHUNK).map((change) => sql`(${change.id}, ${change.to})`), sql`, `);
        await tx.execute(sql`
          update "journal_entry" set "number" = v.new_number
          from (values ${values}) as v(entry_id, new_number)
          where "journal_entry"."id" = v.entry_id and "journal_entry"."companyId" = ${input.companyId}
        `);
      }
    }

    // El contador queda en el siguiente número libre (también si había huecos en la numeración).
    await tx.update(fiscalYear).set({ nextJournalEntryNumber: plan.nextNumber }).where(and(eq(fiscalYear.id, year.id), eq(fiscalYear.companyId, input.companyId)));

    await recordAudit({
      tenantId: input.tenantId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      action: "accounting.entries.renumber",
      entityName: "fiscalYear",
      entityId: year.id,
      payload: { code: year.code, total: plan.total, changed: plan.changes.length, nextNumber: plan.nextNumber, map: plan.changes.map((change) => ({ id: change.id, from: change.from, to: change.to })) },
    }, tx);

    return { fiscalYearId: year.id, yearCode: year.code, total: plan.total, changed: plan.changes.length, nextNumber: plan.nextNumber };
  });
}
