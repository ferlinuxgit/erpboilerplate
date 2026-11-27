/**
 * Estados de la factura electrónica entre empresas (art. 10 del Real Decreto 238/2026 y art. 7 de
 * la Orden HAC/1028/2026). El DESTINATARIO debe comunicar al emisor:
 *   a) la aceptación o el rechazo comercial de la factura y su fecha, y
 *   b) el pago efectivo completo y su fecha,
 * en un máximo de cuatro días naturales sin contar sábados, domingos ni festivos nacionales
 * (art. 10.3). A la solución pública de la AEAT se comunican el rechazo y el pago (art. 12); sin
 * rechazo ni rectificativa posterior, la factura se presume aceptada (art. 12.1).
 *
 * Aquí se lleva el REGISTRO de esos estados para las facturas emitidas (lo que el cliente nos
 * comunica, más el envío y la recepción). El intercambio automático con la solución pública o con
 * plataformas privadas no existe todavía: los estados se anotan a mano. Código puro.
 */

export const EINVOICE_STATUSES = ["SENT", "RECEIVED", "ACCEPTED", "REJECTED", "PAID"] as const;
export type EInvoiceStatus = (typeof EINVOICE_STATUSES)[number];

export const einvoiceStatusLabels: Record<EInvoiceStatus, string> = {
  SENT: "Enviada",
  RECEIVED: "Recibida por el cliente",
  ACCEPTED: "Aceptada",
  REJECTED: "Rechazada",
  PAID: "Pagada",
};

/** Motivos de rechazo de la lista L1 del anexo II de la Orden HAC/1028/2026. */
export const EINVOICE_REJECTION_CODES = ["01", "02"] as const;
export type EInvoiceRejectionCode = (typeof EINVOICE_REJECTION_CODES)[number];
export const einvoiceRejectionLabels: Record<EInvoiceRejectionCode, string> = {
  "01": "Rechazo comercial",
  "02": "Consumo particular o no afecto a la actividad",
};

export type EInvoiceStatusEvent = {
  status: EInvoiceStatus;
  /** Fecha en que se produjo el estado (AAAA-MM-DD). */
  effectiveDate: string;
  rejectionCode?: string | null;
  reason?: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isEInvoiceStatus(value: unknown): value is EInvoiceStatus {
  return typeof value === "string" && (EINVOICE_STATUSES as readonly string[]).includes(value);
}

function validDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export type EInvoiceStatusSummary = {
  sentOn: string | null;
  receivedOn: string | null;
  /** Último pronunciamiento del cliente: aceptada o rechazada. null = sin pronunciarse (se presume aceptada). */
  commercial: { status: "ACCEPTED" | "REJECTED"; date: string; reason: string | null; rejectionCode: string | null } | null;
  paidOn: string | null;
  /** Estado que resume la situación, para la etiqueta de la ficha. */
  current: EInvoiceStatus | null;
};

/** Situación actual a partir del historial (en el orden en que se anotaron). */
export function summarizeEInvoiceStatus(events: EInvoiceStatusEvent[]): EInvoiceStatusSummary {
  const summary: EInvoiceStatusSummary = { sentOn: null, receivedOn: null, commercial: null, paidOn: null, current: null };
  for (const event of events) {
    if (event.status === "SENT") summary.sentOn = event.effectiveDate;
    if (event.status === "RECEIVED") summary.receivedOn = event.effectiveDate;
    if (event.status === "ACCEPTED" || event.status === "REJECTED") {
      summary.commercial = { status: event.status, date: event.effectiveDate, reason: event.reason?.trim() || null, rejectionCode: event.rejectionCode ?? null };
      // Un rechazo posterior al pago anotado no borra el pago: son hechos distintos; se muestran ambos.
    }
    if (event.status === "PAID") summary.paidOn = event.effectiveDate;
  }
  summary.current = summary.commercial?.status === "REJECTED"
    ? "REJECTED"
    : summary.paidOn
      ? "PAID"
      : summary.commercial?.status === "ACCEPTED"
        ? "ACCEPTED"
        : summary.receivedOn
          ? "RECEIVED"
          : summary.sentOn
            ? "SENT"
            : null;
  return summary;
}

/**
 * ¿Se puede anotar este estado? Devuelve el motivo si no. Reglas mínimas, las que se deducen de la
 * norma: fecha válida y no futura ni anterior a la factura; el rechazo lleva su motivo; no se paga
 * una factura rechazada sin que antes conste su aceptación; no se repite el pago completo.
 */
export function einvoiceStatusProblem(
  event: EInvoiceStatusEvent,
  context: { history: EInvoiceStatusEvent[]; issueDate: string; today: string },
): string | null {
  if (!isEInvoiceStatus(event.status)) return "El estado no es válido.";
  if (!validDate(event.effectiveDate)) return "Indica la fecha en que se produjo el estado.";
  if (event.effectiveDate > context.today) return "La fecha del estado no puede ser futura.";
  if (event.status !== "PAID" && event.effectiveDate < context.issueDate) return "La fecha del estado no puede ser anterior a la de la factura.";
  const summary = summarizeEInvoiceStatus(context.history);
  if (event.status === "REJECTED") {
    if (!event.reason?.trim()) return "Indica el motivo del rechazo: es lo que el cliente debe comunicar junto con la fecha.";
    if (event.rejectionCode && !(EINVOICE_REJECTION_CODES as readonly string[]).includes(event.rejectionCode)) return "El tipo de rechazo no es válido.";
  }
  if (event.status === "PAID") {
    if (summary.paidOn) return "El pago completo de esta factura ya está anotado.";
    if (summary.commercial?.status === "REJECTED") return "La factura consta como rechazada: anota antes su aceptación (o emite la rectificativa que corresponda).";
  }
  if (event.status === "ACCEPTED" && summary.commercial?.status === "ACCEPTED") return "La factura ya consta como aceptada.";
  if (event.status === "SENT" && summary.sentOn) return "El envío ya está anotado.";
  if (event.status === "RECEIVED" && summary.receivedOn) return "La recepción ya está anotada.";
  return null;
}

/**
 * Último día para comunicar un estado: cuatro días contados desde la fecha del estado, sin sábados
 * ni domingos (art. 10.3 del RD 238/2026). Los festivos nacionales también se excluyen según la
 * norma, pero la aplicación no tiene calendario de festivos: el plazo real puede ser algo mayor.
 */
export function statusCommunicationDeadline(effectiveDate: string, days = 4): string | null {
  if (!validDate(effectiveDate)) return null;
  const date = new Date(`${effectiveDate}T00:00:00Z`);
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
}
