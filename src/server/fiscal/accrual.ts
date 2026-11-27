/**
 * Devengo de las facturas emitidas (módulo puro): qué fecha decide el periodo del 303, 390, 349 y 130.
 *
 * REGLA
 * 1. Sin fecha de operación, o con fecha de operación igual o posterior a la de expedición, manda la
 *    fecha de expedición. (Una factura expedida antes de la operación suele documentar un pago
 *    anticipado, que devenga al cobrarse; usar la expedición nunca retrasa el ingreso del IVA.)
 * 2. Con fecha de operación anterior a la de expedición, manda la fecha de operación (art. 75 LIVA:
 *    el IVA se devenga cuando se realiza la operación, no cuando se factura).
 * 3. EXCEPCIÓN DE SEGURIDAD — periodo ya presentado. Si la fecha de operación cae en un periodo de
 *    IVA presentado que no contiene la fecha de expedición, y la factura no pudo entrar en esa
 *    presentación, se imputa al periodo de expedición y se avisa (lo correcto sería una
 *    autoliquidación complementaria del periodo de la operación). «No pudo entrar» significa:
 *      a) el modelo se presentó antes de que el programa guardase la foto de lo presentado
 *         (`snapshotAt` nulo): entonces se calculaba por fecha de expedición y se conserva ese criterio;
 *      b) o la factura se emitió después de tomarse la foto.
 *    Así un modelo presentado nunca cambia en silencio por una factura posterior.
 */

export type FiledVatPeriod = {
  code: string;
  period: string;
  /** Límites del periodo como instantes reales (medianoche local). */
  start: Date;
  endExclusive: Date;
  /** Momento en que se guardó la foto de lo presentado; null en presentaciones antiguas sin foto. */
  snapshotAt: Date | null;
};

export type AccrualBasis = "issue" | "operation" | "issue-filed-period";

export type AccrualResolution = {
  date: Date;
  basis: AccrualBasis;
  /** Periodo presentado que impide imputar por fecha de operación (solo con `issue-filed-period`). */
  filedPeriod?: { code: string; period: string };
};

export type AccrualInvoice = {
  issueDate: Date;
  operationDate?: Date | null;
  /** Momento real de la emisión; si falta (facturas antiguas) se usa la fecha de expedición. */
  issuedAt?: Date | null;
};

/** Modelos de IVA/IGIC cuya presentación fija el devengo de un periodo. */
export const ACCRUAL_LOCKING_MODEL_CODES: ReadonlySet<string> = new Set(["303", "390", "420", "425"]);

function contains(period: FiledVatPeriod, date: Date) {
  return date >= period.start && date < period.endExclusive;
}

export function resolveAccrualDate(invoice: AccrualInvoice, filedPeriods: FiledVatPeriod[] = []): AccrualResolution {
  const { issueDate, operationDate } = invoice;
  if (!operationDate || Number.isNaN(operationDate.getTime()) || operationDate >= issueDate) return { date: issueDate, basis: "issue" };

  const issuedAt = invoice.issuedAt ?? issueDate;
  for (const period of filedPeriods) {
    if (!contains(period, operationDate) || contains(period, issueDate)) continue;
    if (period.snapshotAt === null || issuedAt > period.snapshotAt) {
      return { date: issueDate, basis: "issue-filed-period", filedPeriod: { code: period.code, period: period.period } };
    }
  }
  return { date: operationDate, basis: "operation" };
}
