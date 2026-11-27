/**
 * Régimen especial del criterio de caja del IVA (RECC, arts. 163 decies a 163 sexiesdecies LIVA).
 * Módulo puro: reparte cada operación en «tramos» según sus cobros o pagos.
 *
 * REGLAS APLICADAS
 * 1. Devengo (art. 163 terdecies): el IVA repercutido se devenga en el momento del cobro, total o
 *    parcial, por los importes efectivamente percibidos; si no se ha cobrado, el 31 de diciembre del
 *    año inmediato posterior a aquel en que se realizó la operación.
 * 2. Deducción (art. 163 quaterdecies): quien está en el régimen deduce el IVA soportado en el
 *    momento del pago, con el mismo límite del 31 de diciembre del año siguiente.
 * 3. Destinatarios (art. 163 quinquiesdecies): quien NO está en el régimen pero recibe una factura
 *    de un proveedor acogido a él también deduce al pagar (marca `supplierCashAccounting`).
 * 4. Operaciones excluidas (art. 163 duodecies.Dos), que siguen la regla general de devengo:
 *    a) las acogidas a los regímenes simplificado, de la agricultura, ganadería y pesca, del recargo
 *       de equivalencia, del oro de inversión, de ventanilla única y del grupo de entidades;
 *    b) las entregas exentas de los arts. 21 a 25 (exportaciones y entregas intracomunitarias);
 *    c) las adquisiciones intracomunitarias de bienes;
 *    d) aquellas en que el sujeto pasivo es el destinatario (inversión del sujeto pasivo);
 *    e) las importaciones y operaciones asimiladas;
 *    f) los autoconsumos (arts. 9.1.º y 12).
 *    En el programa: solo entran en el régimen las facturas con tratamiento de IVA «nacional»
 *    (DOMESTIC). Intracomunitarias, exportaciones, inversión del sujeto pasivo, importaciones y no
 *    sujetas van por la regla general. El recargo de equivalencia que se repercute a un cliente
 *    minorista acompaña al IVA de esa misma entrega y se devenga con él (lo excluido en la letra a
 *    son las operaciones del propio régimen del recargo, no la repercusión del recargo).
 * 5. Rectificativas: una factura rectificativa (importe negativo) se imputa en su propia fecha y,
 *    si rectifica una factura conocida, cuenta además como «cobro» de esa factura por su importe
 *    (la deuda se extingue por compensación). Así el abono de una factura sin cobrar se anula con el
 *    devengo de la parte abonada en el mismo periodo, y lo que queda se devenga al cobrarlo.
 * 6. El límite se calcula en hora local: el tramo no cobrado se imputa al 31 de diciembre del año
 *    siguiente al de la operación; los cobros posteriores a esa fecha ya no mueven nada.
 */
import { fiscalCivilDate, localMidnightInstant } from "@/lib/fiscal-spain";

/** Tramo de un importe: de la fracción `from` a la fracción `to` (0 a 1) del total del documento. */
export type CashPortion = { from: number; to: number };

export type CashAccrualEvent = CashPortion & {
  date: Date;
  /** `payment`: cobro o pago; `deadline`: 31 de diciembre del año siguiente; `general`: regla general. */
  reason: "payment" | "deadline" | "general";
};

export type CashMovement = { date: Date; amount: string | number };

/** Parte de un importe en céntimos que corresponde a un tramo. Los tramos de 0 a 1 suman el importe exacto. */
export function portionCents(cents: number, portion: CashPortion | null | undefined) {
  if (!portion) return cents;
  return Math.round(cents * portion.to) - Math.round(cents * portion.from);
}

/** 31 de diciembre del año siguiente al de la operación (medianoche local) y primer instante ya fuera de plazo. */
export function cashAccountingDeadline(operationDate: Date, timeZone: string) {
  const { year } = fiscalCivilDate(operationDate, timeZone);
  return { date: localMidnightInstant(year + 1, 11, 31, timeZone), cutoff: localMidnightInstant(year + 2, 0, 1, timeZone) };
}

function movementCents(amount: string | number) {
  const parsed = Number(amount);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

/**
 * Tramos en que se devenga (o se deduce) una operación en criterio de caja.
 * - `operationDate`: fecha de la operación según la regla general (fija el año del límite).
 * - `totalCents`: importe total del documento (lo que se cobra o se paga).
 * - `movements`: cobros o pagos aplicados al documento (y abonos que lo compensan).
 * - `notBefore`: ningún tramo se imputa antes (recibidas: la fecha de registro de la factura).
 * Un documento sin importe a cobrar o negativo (rectificativa) va entero en `operationDate`.
 * Devuelve todos los tramos, también los futuros (el límite): quien llama filtra por periodo.
 */
export function resolveCashAccrualEvents(input: {
  operationDate: Date;
  totalCents: number;
  movements: CashMovement[];
  timeZone: string;
  notBefore?: Date | null;
}): CashAccrualEvent[] {
  const clampDate = (date: Date) => (input.notBefore && date < input.notBefore ? input.notBefore : date);
  if (input.totalCents <= 0) return [{ date: clampDate(input.operationDate), from: 0, to: 1, reason: "general" }];

  const deadline = cashAccountingDeadline(input.operationDate, input.timeZone);
  const events: CashAccrualEvent[] = [];
  let collected = 0;
  let reached = 0;
  const ordered = [...input.movements]
    .filter((movement) => movement.date < deadline.cutoff)
    .sort((left, right) => left.date.getTime() - right.date.getTime());
  for (const movement of ordered) {
    collected += movementCents(movement.amount);
    const to = Math.min(1, Math.max(0, collected / input.totalCents));
    if (to <= reached) continue;
    events.push({ date: clampDate(movement.date), from: reached, to, reason: "payment" });
    reached = to;
    if (reached >= 1) break;
  }
  if (reached < 1) events.push({ date: clampDate(deadline.date), from: reached, to: 1, reason: "deadline" });
  return events;
}

type CashDocumentLine = {
  invoiceId: string;
  totalAmount: string | number;
};

export type CashExpansion<T> = T & {
  /** Tramo del documento que se imputa en esta fila. */
  portion: CashPortion;
  cashAccounting: true;
  /** Por qué se imputa en esa fecha. */
  cashReason: CashAccrualEvent["reason"];
};

/**
 * Abonos que compensan una factura: importe absoluto de cada rectificativa, en su fecha, agrupado
 * por la factura rectificada. Se añaden a los cobros o pagos de esa factura (regla 5).
 */
export function creditMovementsByOriginal(documents: Array<{ rectifiedInvoiceId?: string | null; totalAmount: string | number; date: Date; id: string }>) {
  const result = new Map<string, CashMovement[]>();
  const seen = new Set<string>();
  for (const document of documents) {
    if (!document.rectifiedInvoiceId || seen.has(document.id)) continue;
    seen.add(document.id);
    const cents = movementCents(document.totalAmount);
    if (cents >= 0) continue;
    result.set(document.rectifiedInvoiceId, [...(result.get(document.rectifiedInvoiceId) ?? []), { date: document.date, amount: -cents / 100 }]);
  }
  return result;
}

/**
 * Facturas emitidas en criterio de caja: cada línea elegible se sustituye por una fila por tramo,
 * con la fecha de devengo del tramo. Las no elegibles se devuelven tal cual.
 */
export function expandIssuedLinesForCash<T extends CashDocumentLine & { accrualDate: Date; invoiceType?: string | null; rectifiedInvoiceId?: string | null }>(
  lines: T[],
  options: { movements: Map<string, CashMovement[]>; timeZone: string; isEligible: (line: T) => boolean },
): Array<T | CashExpansion<T>> {
  const credits = creditMovementsByOriginal(lines.map((line) => ({ id: line.invoiceId, rectifiedInvoiceId: line.rectifiedInvoiceId, totalAmount: line.totalAmount, date: line.accrualDate })));
  const eventsByInvoice = new Map<string, CashAccrualEvent[]>();
  return lines.flatMap((line) => {
    if (!options.isEligible(line)) return [line];
    let events = eventsByInvoice.get(line.invoiceId);
    if (!events) {
      events = resolveCashAccrualEvents({
        operationDate: line.accrualDate,
        totalCents: movementCents(line.totalAmount),
        movements: [...(options.movements.get(line.invoiceId) ?? []), ...(credits.get(line.invoiceId) ?? [])],
        timeZone: options.timeZone,
      });
      eventsByInvoice.set(line.invoiceId, events);
    }
    return events.map((event) => ({ ...line, accrualDate: event.date, portion: { from: event.from, to: event.to }, cashAccounting: true as const, cashReason: event.reason }));
  });
}

type SupplierCashLine = CashDocumentLine & {
  issueDate: Date;
  operationDate?: Date | null;
  accountingDate?: Date;
  voidedAt?: Date | null;
  sign?: 1 | -1;
  documentKind?: string | null;
  rectifiedInvoiceId?: string | null;
};

/**
 * Facturas recibidas que se deducen al pago (empresa en el régimen o proveedor acogido a él): cada
 * línea elegible se sustituye por una fila por tramo, con `deductionDate` = fecha del pago (nunca
 * antes del registro de la factura). Una factura anulada deja de generar tramos desde la anulación,
 * y su fila de anulación (sign −1) resta solo lo que ya se había deducido hasta entonces.
 */
export function expandSupplierLinesForCash<T extends SupplierCashLine>(
  lines: T[],
  options: { movements: Map<string, CashMovement[]>; timeZone: string; isEligible: (line: T) => boolean },
): Array<T | (CashExpansion<T> & { deductionDate: Date })> {
  const credits = creditMovementsByOriginal(lines.filter((line) => (line.sign ?? 1) === 1).map((line) => ({
    id: line.invoiceId,
    rectifiedInvoiceId: line.rectifiedInvoiceId,
    totalAmount: line.totalAmount,
    date: line.accountingDate ?? line.issueDate,
  })));
  const eventsByInvoice = new Map<string, CashAccrualEvent[]>();
  return lines.flatMap((line) => {
    if (!options.isEligible(line)) return [line];
    let events = eventsByInvoice.get(line.invoiceId);
    if (!events) {
      events = resolveCashAccrualEvents({
        operationDate: line.operationDate ?? line.issueDate,
        totalCents: movementCents(line.totalAmount),
        movements: [...(options.movements.get(line.invoiceId) ?? []), ...(credits.get(line.invoiceId) ?? [])],
        timeZone: options.timeZone,
        notBefore: line.accountingDate ?? line.issueDate,
      });
      eventsByInvoice.set(line.invoiceId, events);
    }
    const voidedAt = line.voidedAt ?? null;
    const live = voidedAt ? events.filter((event) => event.date < voidedAt) : events;
    if ((line.sign ?? 1) === -1) {
      const deducted = live.length > 0 ? live[live.length - 1].to : 0;
      if (!voidedAt || deducted <= 0) return [];
      return [{ ...line, deductionDate: voidedAt, portion: { from: 0, to: deducted }, cashAccounting: true as const, cashReason: "general" as const }];
    }
    return live.map((event) => ({ ...line, deductionDate: event.date, portion: { from: event.from, to: event.to }, cashAccounting: true as const, cashReason: event.reason }));
  });
}
