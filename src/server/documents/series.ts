import { and, asc, eq, sql } from "drizzle-orm";

import { documentSeries, fiscalYear } from "@/db/schema";
import type { DbClient } from "@/lib/db";
import { defaultSeriesFormat, formatSeriesNumber } from "@/lib/document-series-format";
import { HttpError } from "@/lib/http";

export type ReservableSeriesType =
  | "SALES_QUOTE"
  | "SALES_ORDER"
  | "DELIVERY_NOTE"
  | "SALES_INVOICE"
  | "CREDIT_NOTE"
  | "PURCHASE_ORDER"
  | "GOODS_RECEIPT"
  | "SUPPLIER_INVOICE"
  | "PAYMENT"
  | "RECEIPT";

/** Series fiscales: su número depende legalmente del ejercicio de la fecha de expedición. */
const STRICT_FISCAL_SERIES = new Set<ReservableSeriesType>(["SALES_INVOICE", "CREDIT_NOTE"]);

export type ReserveSeriesInput = {
  companyId: string;
  type: ReservableSeriesType;
  /** Fecha del documento: determina el ejercicio (y la serie) de la numeración. */
  referenceDate?: Date | string | null;
  /**
   * Ejercicio de respaldo (p. ej. el activo en la sesión) cuando no hay fecha o su ejercicio no
   * tiene serie. Nunca se usa para facturas emitidas ni rectificativas.
   */
  fiscalYearId?: string | null;
  /** Crea la serie en el ejercicio de la fecha si no existe (p. ej. rectificativas en empresas antiguas). */
  createIfMissing?: { prefix: string; format?: string };
};

function toValidDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Ejercicio de la empresa que contiene la fecha (fin inclusivo: `endsAt` es el último día a las 00:00 UTC). */
export async function findFiscalYearForDate(client: DbClient, companyId: string, date: Date) {
  const [year] = await client
    .select({ id: fiscalYear.id, code: fiscalYear.code, isClosed: fiscalYear.isClosed })
    .from(fiscalYear)
    .where(and(
      eq(fiscalYear.companyId, companyId),
      sql`${date} >= ${fiscalYear.startsAt}`,
      sql`${date} < (${fiscalYear.endsAt} + interval '1 day')`,
    ))
    .orderBy(asc(fiscalYear.startsAt))
    .limit(1);
  return year ?? null;
}

/**
 * Reserva el siguiente número de una serie de forma atómica (bloqueo `FOR UPDATE`).
 *
 * - El ejercicio se resuelve por la fecha del documento, no por el ejercicio seleccionado en la
 *   sesión ni por el primero de la empresa (llamadas con API key).
 * - La numeración es correlativa entre ejercicios del mismo tipo (se toma el máximo de todas las
 *   series del tipo), así que nunca se reutiliza un número aunque se cambie de ejercicio.
 */
export async function reserveSeriesNumber(client: DbClient, input: ReserveSeriesInput) {
  const referenceDate = toValidDate(input.referenceDate);
  const strict = STRICT_FISCAL_SERIES.has(input.type);
  const dateYear = referenceDate ? await findFiscalYearForDate(client, input.companyId, referenceDate) : null;
  if (strict && !dateYear) {
    throw new HttpError(
      422,
      "La fecha de emisión no pertenece a ningún ejercicio de la empresa. Abre el ejercicio correspondiente en Contabilidad.",
    );
  }

  const seriesRows = await client
    .select()
    .from(documentSeries)
    .where(and(eq(documentSeries.companyId, input.companyId), eq(documentSeries.type, input.type)))
    .orderBy(documentSeries.id)
    .for("update");

  let series = dateYear ? seriesRows.find((candidate) => candidate.fiscalYearId === dateYear.id) : undefined;
  if (!series && dateYear && input.createIfMissing) {
    const [created] = await client
      .insert(documentSeries)
      .values({
        companyId: input.companyId,
        fiscalYearId: dateYear.id,
        type: input.type,
        prefix: input.createIfMissing.prefix,
        format: input.createIfMissing.format ?? defaultSeriesFormat,
        nextNumber: 1,
      })
      .onConflictDoNothing()
      .returning();
    series = created;
  }
  if (!series && !strict && input.fiscalYearId) {
    series = seriesRows.find((candidate) => candidate.fiscalYearId === input.fiscalYearId);
  }
  if (!series) {
    throw new HttpError(
      422,
      dateYear
        ? `No existe serie de numeración para ${input.type} en el ejercicio ${dateYear.code}. Créala en Configuración > Maestros.`
        : `No existe serie para ${input.type}.`,
    );
  }

  const nextNumber = Math.max(series.nextNumber, ...seriesRows.map((candidate) => candidate.nextNumber));
  const [reserved] = await client
    .update(documentSeries)
    .set({ nextNumber: nextNumber + 1 })
    .where(eq(documentSeries.id, series.id))
    .returning({ format: documentSeries.format, prefix: documentSeries.prefix });

  if (!reserved) {
    throw new HttpError(409, `No se pudo reservar serie para ${input.type}.`);
  }

  return formatSeriesNumber({
    format: reserved.format,
    nextNumber,
    prefix: reserved.prefix,
    referenceDate: referenceDate ?? input.referenceDate,
  });
}
