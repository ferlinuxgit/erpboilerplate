/**
 * Lista de comprobaciones antes de cerrar un ejercicio (función pura, testeable).
 *
 * - "blocking": el cierre fallaría o dejaría la contabilidad mal (libro descuadrado). No admite excepción.
 * - "pending": conviene resolverlo antes; se puede cerrar igualmente indicando un motivo (queda auditado).
 * - "review": recordatorio que el sistema no puede comprobar (amortizaciones). No bloquea.
 * - "ok": comprobado.
 */

export type CloseChecklistStatus = "ok" | "pending" | "blocking" | "review";

export type CloseChecklistItem = {
  id: "vat-q4-filed" | "draft-invoices" | "bank-555" | "ledger-balanced" | "depreciation";
  title: string;
  status: CloseChecklistStatus;
  detail: string;
  /** Dónde resolverlo. */
  href?: string;
  actionLabel?: string;
};

export type CloseChecklistFacts = {
  yearCode: string;
  /** null: la empresa no presenta 303 (recargo de equivalencia o exenta). */
  lastVatReturn: { period: string; label: string; reportId: string | null; filed: boolean } | null;
  draftSalesInvoices: number;
  account555Cents: number;
  pendingBankTransactions: number;
  ledgerDifferenceCents: number;
};

export type CloseChecklist = {
  items: CloseChecklistItem[];
  /** Hay algo que impide cerrar (sin excepción posible). */
  blocked: boolean;
  /** Hay avisos pendientes: cerrar exige indicar el motivo. */
  requiresOverride: boolean;
};

const euros = (cents: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Math.abs(cents) / 100);

const plural = (count: number, singular: string, pluralForm: string) => `${count} ${count === 1 ? singular : pluralForm}`;

export function evaluateCloseChecklist(facts: CloseChecklistFacts): CloseChecklist {
  const items: CloseChecklistItem[] = [];

  if (facts.lastVatReturn) {
    const vat = facts.lastVatReturn;
    items.push({
      id: "vat-q4-filed",
      title: `Modelo 303 del ${vat.label} presentado`,
      status: vat.filed ? "ok" : "pending",
      detail: vat.filed
        ? "El último IVA del ejercicio está marcado como presentado."
        : vat.reportId
          ? "El borrador existe pero no está marcado como presentado. Preséntalo en la AEAT y márcalo aquí con el justificante."
          : "No hay borrador del último 303 del ejercicio. Prepáralo y preséntalo antes de cerrar.",
      href: vat.reportId ? `/fiscal/${vat.reportId}` : `/fiscal/new?code=303&period=${vat.period}`,
      actionLabel: vat.reportId ? "Abrir el 303" : "Preparar el 303",
    });
  }

  items.push({
    id: "draft-invoices",
    title: "Sin facturas en borrador",
    status: facts.draftSalesInvoices === 0 ? "ok" : "pending",
    detail: facts.draftSalesInvoices === 0
      ? `No quedan facturas en borrador con fecha de ${facts.yearCode}.`
      : `Hay ${plural(facts.draftSalesInvoices, "factura", "facturas")} en borrador con fecha de ${facts.yearCode}. Emítelas o elimínalas: después del cierre no podrán llevar fecha de este ejercicio.`,
    href: "/invoices?type=draft",
    actionLabel: "Ver borradores",
  });

  const bankPending = facts.account555Cents !== 0 || facts.pendingBankTransactions > 0;
  items.push({
    id: "bank-555",
    title: "Banco conciliado (cuenta 555 a cero)",
    status: bankPending ? "pending" : "ok",
    detail: bankPending
      ? [
          facts.account555Cents !== 0 ? `La cuenta 555 tiene un saldo de ${euros(facts.account555Cents)} sin aplicar.` : null,
          facts.pendingBankTransactions > 0 ? `Quedan ${plural(facts.pendingBankTransactions, "movimiento bancario", "movimientos bancarios")} sin conciliar.` : null,
        ].filter(Boolean).join(" ")
      : "Todos los movimientos del banco están conciliados.",
    href: "/treasury",
    actionLabel: "Ir a conciliación",
  });

  items.push({
    id: "ledger-balanced",
    title: "Libro cuadrado (debe = haber)",
    status: facts.ledgerDifferenceCents === 0 ? "ok" : "blocking",
    detail: facts.ledgerDifferenceCents === 0
      ? "El total del debe coincide con el del haber."
      : `Descuadre de ${euros(facts.ledgerDifferenceCents)} entre debe y haber. Corrige los asientos manuales: con el libro descuadrado no se puede cerrar.`,
    href: "/accounting/reports",
    actionLabel: "Ver sumas y saldos",
  });

  items.push({
    id: "depreciation",
    title: "Amortizaciones del año registradas",
    status: "review",
    detail: "Si tienes ordenadores, vehículos, maquinaria o reformas, registra con un asiento manual la amortización del año (grupo 68 contra 281) antes de cerrar. Si no, ignora este punto.",
    href: "/accounting/entries/new",
    actionLabel: "Nuevo asiento",
  });

  return {
    items,
    blocked: items.some((item) => item.status === "blocking"),
    requiresOverride: items.some((item) => item.status === "pending"),
  };
}

export const CLOSE_OVERRIDE_REASON_MIN = 5;

/** ¿Se puede cerrar con esta lista y este motivo? Devuelve el mensaje de error o null. */
export function closeChecklistBlocker(checklist: CloseChecklist, overrideReason: string | null | undefined): string | null {
  if (checklist.blocked) {
    const blocking = checklist.items.filter((item) => item.status === "blocking").map((item) => item.title.toLowerCase());
    return `No se puede cerrar el ejercicio: ${blocking.join(", ")}.`;
  }
  if (checklist.requiresOverride && (overrideReason?.trim().length ?? 0) < CLOSE_OVERRIDE_REASON_MIN) {
    return "Quedan comprobaciones pendientes. Resuélvelas o indica el motivo para cerrar igualmente.";
  }
  return null;
}
