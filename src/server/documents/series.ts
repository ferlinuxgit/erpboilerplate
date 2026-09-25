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
  /**
   * Serie elegida por el usuario (de cualquier ejercicio). Se valida que sea de la empresa y del tipo
   * y se usa la serie con el mismo código en el ejercicio de la fecha. Sin ella, la serie por defecto.
   */
  seriesId?: string | null;
};

export type SeriesRow = typeof documentSeries.$inferSelect;
type SeriesLike = Pick<SeriesRow, "id" | "fiscalYearId" | "type" | "nextNumber"> & Partial<Pick<SeriesRow, "code" | "name" | "isDefault" | "isActive">>;

function isActiveSeries(row: SeriesLike) {
  return row.isActive !== false;
}

function codeOf(row: SeriesLike) {
  return row.code ?? "GEN";
}

/**
 * Serie de un ejercicio (función pura):
 * - con serie elegida, la del mismo código en ese ejercicio (aunque se eligiera en otro ejercicio);
 * - sin ella, la marcada por defecto y, si ninguna lo está, la primera activa por código.
 */
export function selectSeriesForYear<T extends SeriesLike>(rows: T[], fiscalYearId: string, requested?: SeriesLike | null): T | undefined {
  const inYear = rows.filter((row) => row.fiscalYearId === fiscalYearId);
  if (requested) return inYear.find((row) => codeOf(row) === codeOf(requested));
  return inYear.find((row) => row.isDefault && isActiveSeries(row))
    ?? [...inYear].filter(isActiveSeries).sort((left, right) => codeOf(left).localeCompare(codeOf(right)))[0];
}

/**
 * Siguiente número efectivo de una serie: el máximo de la misma serie (tipo + código) en todos los
 * ejercicios, para que la numeración siga siendo correlativa al cambiar de ejercicio.
 */
export function effectiveNextNumber(rows: SeriesLike[], series: SeriesLike) {
  return Math.max(series.nextNumber, ...rows.filter((row) => row.type === series.type && codeOf(row) === codeOf(series)).map((row) => row.nextNumber));
}

function seriesLabel(row: SeriesLike) {
  return row.name ? `«${row.name}»` : `«${codeOf(row)}»`;
}

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
 * - Cada serie (tipo + código) es correlativa entre ejercicios: se toma el máximo de esa serie en
 *   todos los ejercicios, así que nunca se reutiliza un número aunque se cambie de ejercicio.
 * - `seriesId` elige una serie concreta (p. ej. tickets); sin él se usa la serie por defecto.
 */
export async function reserveSeriesNumberDetailed(client: DbClient, input: ReserveSeriesInput): Promise<{ number: string; seriesId: string }> {
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

  // La serie elegida debe ser de la empresa y del tipo (las filas ya están filtradas por ambos).
  const requested = input.seriesId ? seriesRows.find((candidate) => candidate.id === input.seriesId) : null;
  if (input.seriesId && !requested) {
    throw new HttpError(422, "La serie de numeración elegida no existe en la empresa o no corresponde a este tipo de documento. Elige otra serie.");
  }

  let series = dateYear ? selectSeriesForYear(seriesRows, dateYear.id, requested) : undefined;
  const yearHasSeries = dateYear ? seriesRows.some((candidate) => candidate.fiscalYearId === dateYear.id) : false;
  if (!series && dateYear && input.createIfMissing && !requested && !yearHasSeries) {
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
    series = selectSeriesForYear(seriesRows, input.fiscalYearId, requested);
  }
  if (!series && !strict && !dateYear && requested) series = requested;
  if (!series) {
    if (requested && dateYear) {
      throw new HttpError(
        422,
        `La serie ${seriesLabel(requested)} no existe en el ejercicio ${dateYear.code}. Créala en Configuración > Maestros o elige otra serie.`,
      );
    }
    throw new HttpError(
      422,
      dateYear
        ? `No existe serie de numeración para ${input.type} en el ejercicio ${dateYear.code}. Créala en Configuración > Maestros.`
        : `No existe serie para ${input.type}.`,
    );
  }
  if (!isActiveSeries(series)) {
    throw new HttpError(422, `La serie ${seriesLabel(series)} está desactivada. Actívala en Configuración > Maestros o elige otra serie.`);
  }

  const nextNumber = effectiveNextNumber(seriesRows, series);
  const [reserved] = await client
    .update(documentSeries)
    .set({ nextNumber: nextNumber + 1 })
    .where(eq(documentSeries.id, series.id))
    .returning({ format: documentSeries.format, prefix: documentSeries.prefix });

  if (!reserved) {
    throw new HttpError(409, `No se pudo reservar serie para ${input.type}.`);
  }

  return {
    seriesId: series.id,
    number: formatSeriesNumber({
      format: reserved.format,
      nextNumber,
      prefix: reserved.prefix,
      referenceDate: referenceDate ?? input.referenceDate,
    }),
  };
}

/** Igual que `reserveSeriesNumberDetailed`, devolviendo solo el número formateado. */
export async function reserveSeriesNumber(client: DbClient, input: ReserveSeriesInput) {
  return (await reserveSeriesNumberDetailed(client, input)).number;
}

export type SelectableSeries = { id: string; code: string; name: string; prefix: string; format: string; nextNumber: number; isDefault: boolean };

/**
 * Series activas de un tipo en un ejercicio (por defecto primero), con el siguiente número efectivo
 * (correlativo entre ejercicios) para mostrar la vista previa del número.
 */
export async function listSelectableSeries(client: DbClient, companyId: string, fiscalYearId: string, type: ReservableSeriesType): Promise<SelectableSeries[]> {
  const rows = await client
    .select()
    .from(documentSeries)
    .where(and(eq(documentSeries.companyId, companyId), eq(documentSeries.type, type)));
  return rows
    .filter((row) => row.fiscalYearId === fiscalYearId && row.isActive)
    .sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.code.localeCompare(right.code))
    .map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      prefix: row.prefix,
      format: row.format,
      nextNumber: effectiveNextNumber(rows, row),
      isDefault: row.isDefault,
    }));
}

/**
 * Valida una serie elegida en un borrador: de la empresa, de uno de los tipos permitidos y activa.
 * El ejercicio se comprueba al emitir (la fecha del borrador puede cambiar).
 */
export async function assertSelectableSeries(client: DbClient, companyId: string, seriesId: string, types: readonly ReservableSeriesType[]) {
  const [row] = await client
    .select({ id: documentSeries.id, type: documentSeries.type, isActive: documentSeries.isActive, name: documentSeries.name })
    .from(documentSeries)
    .where(and(eq(documentSeries.id, seriesId), eq(documentSeries.companyId, companyId)))
    .limit(1);
  if (!row || !(types as readonly string[]).includes(row.type)) {
    throw new HttpError(400, "La serie de numeración elegida no existe o no corresponde a este tipo de documento.");
  }
  if (!row.isActive) throw new HttpError(400, `La serie «${row.name}» está desactivada. Elige otra serie.`);
  return row;
}
