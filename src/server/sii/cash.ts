/**
 * Cobros y pagos del régimen especial del criterio de caja para el SII (libros
 * `SuministroLRCobrosEmitidas` y `SuministroLRPagosRecibidas`). Código puro.
 *
 * Qué se suministra de cada factura con clave de régimen 07 (mismo criterio que el cálculo del 303
 * del programa, `@/server/fiscal/cash-accounting`):
 * - cada cobro o pago aplicado, con su fecha, importe y medio, hasta completar el total de la
 *   factura (lo que exceda del total no se declara);
 * - el abono de una rectificativa que compensa la factura, como cobro por «otros medios» (04) en la
 *   fecha de la rectificativa; y la propia rectificativa (importe negativo), entera en su fecha;
 * - lo que siga sin cobrar el 31 de diciembre del año siguiente al de la operación, con el medio
 *   03 («no se cobra / paga») y esa fecha, que es la única que la AEAT admite con ese medio
 *   (error 1151). Los cobros posteriores a esa fecha ya no se suministran.
 *
 * CONTRASTADO con el esquema (DatosPagoCobroType, lista de medios), con las validaciones 3.1.7 y
 * 3.1.8 del documento de la AEAT y con sus preguntas frecuentes del SII, apartado 8: fecha 31 de
 * diciembre y medio 03 cuando no se cobra o paga, sin anotar los cobros posteriores (8.2 y 8.3); un
 * cobro o pago erróneo se anula enviándolo con importe negativo, porque no hay modificación (A1)
 * ni baja (8.6); plazo de cuatro días (8.7).
 * NO CONTRASTADO: el tratamiento de los abonos por compensación y de las rectificativas (las
 * preguntas frecuentes no lo tratan; es el criterio propio del programa en el 303).
 *
 * PLAZO: cuatro días hábiles desde el cobro o pago (art. 69 bis.1 RIVA), sin el tope del día 15.
 */
import { fiscalCivilDate } from "@/lib/fiscal-spain";
import { cashAccountingDeadline } from "@/server/fiscal/cash-accounting";
import type { SiiCashMovement, SiiPaymentMethodCode } from "@/server/sii/types";
import { formatAeatAmount, formatAeatDate } from "@/server/verifactu/format";

/** Medio del SII según el tipo de forma de pago del programa: transferencia, domiciliación u otros (tarjeta, efectivo, sin indicar). */
export function siiPaymentMethodCode(type: string | null | undefined): SiiPaymentMethodCode {
  if (type === "BANK_TRANSFER") return "01";
  if (type === "DIRECT_DEBIT") return "05";
  return "04";
}

export type CashSourceMovement = {
  /** Identificador estable del movimiento (id de la aplicación del cobro o pago, o del abono). */
  id: string;
  date: Date;
  amountCents: number;
  method: SiiPaymentMethodCode;
  account?: string | null;
};

export type PlannedCashMovement = { sourceId: string; date: Date; movement: SiiCashMovement };

const amount = (cents: number) => formatAeatAmount(cents / 100);

/**
 * Movimientos que hay que suministrar de una factura en criterio de caja.
 * - `totalCents`: importe total de la factura (lo que se cobra o se paga). Negativo en rectificativas.
 * - `notBefore`: recibidas, fecha de registro de la factura (ningún pago se declara antes).
 * - `now`: para saber si ya ha llegado el 31 de diciembre del año siguiente.
 */
export function planCashMovements(input: {
  invoiceId: string;
  operationDate: Date;
  totalCents: number;
  movements: CashSourceMovement[];
  timeZone: string;
  now: Date;
  notBefore?: Date | null;
}): PlannedCashMovement[] {
  const clamp = (date: Date) => (input.notBefore && date < input.notBefore ? input.notBefore : date);
  const toSii = (date: Date, cents: number, method: SiiPaymentMethodCode, account?: string | null): SiiCashMovement => ({
    date: formatAeatDate(date, input.timeZone),
    amount: amount(cents),
    method,
    ...(account && method !== "03" ? { account: account.replace(/\s+/g, "").slice(0, 34) } : {}),
  });

  if (input.totalCents === 0) return [];
  if (input.totalCents < 0) {
    // Rectificativa: se imputa entera en su propia fecha (regla 5 del módulo de criterio de caja).
    const date = clamp(input.operationDate);
    return [{ sourceId: `${input.invoiceId}:propio`, date, movement: toSii(date, input.totalCents, "04") }];
  }

  const deadline = cashAccountingDeadline(input.operationDate, input.timeZone);
  const planned: PlannedCashMovement[] = [];
  let collected = 0;
  const ordered = [...input.movements]
    .filter((movement) => movement.amountCents > 0 && movement.date < deadline.cutoff)
    .sort((left, right) => left.date.getTime() - right.date.getTime() || left.id.localeCompare(right.id));
  for (const movement of ordered) {
    const cents = Math.min(movement.amountCents, input.totalCents - collected);
    if (cents <= 0) break;
    collected += cents;
    const date = clamp(movement.date);
    planned.push({ sourceId: movement.id, date, movement: toSii(date, cents, movement.method, movement.account) });
  }
  if (collected < input.totalCents && input.now >= deadline.date) {
    planned.push({ sourceId: `${input.invoiceId}:limite`, date: deadline.date, movement: toSii(deadline.date, input.totalCents - collected, "03") });
  }
  return planned;
}

const sameMovement = (left: SiiCashMovement, right: SiiCashMovement) => (
  left.date === right.date && left.amount === right.amount && left.method === right.method && (left.account ?? "") === (right.account ?? "")
);

export function sameCashMovements(left: SiiCashMovement[], right: SiiCashMovement[]) {
  return left.length === right.length && left.every((movement, index) => sameMovement(movement, right[index]));
}

/** El mismo movimiento con el importe cambiado de signo: es como se anula un cobro o pago ya suministrado. */
export function reverseCashMovement(movement: SiiCashMovement): SiiCashMovement {
  const cents = Math.round(Number(movement.amount) * 100);
  return { ...movement, amount: amount(-cents) };
}

/**
 * Qué enviar para que lo declarado en la AEAT pase de `declared` a `target`: nada si coincide; si
 * no, la anulación de lo declarado (en negativo) seguida de lo nuevo.
 */
export function cashMovementsToSend(declared: SiiCashMovement[], target: SiiCashMovement[]): SiiCashMovement[] {
  if (sameCashMovements(declared, target)) return [];
  return [...declared.map(reverseCashMovement), ...target];
}

/** Periodo (año y mes) en el que cae un cobro o pago: solo para mostrarlo y ordenarlo en pantalla. */
export function cashPeriodOf(date: Date, timeZone: string) {
  const civil = fiscalCivilDate(date, timeZone);
  return { year: String(civil.year), period: String(civil.month).padStart(2, "0") };
}
