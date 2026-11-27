/**
 * Lista de comprobaciones antes de cerrar un ejercicio (función pura, testeable).
 *
 * - "blocking": el cierre fallaría o dejaría la contabilidad mal (libro descuadrado). No admite excepción.
 * - "pending": conviene resolverlo antes; se puede cerrar igualmente indicando un motivo (queda auditado).
 * - "review": recordatorio que el sistema no puede comprobar (inmovilizado en el balance sin fichas de bienes). No bloquea.
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
  /** Inmovilizado y amortizaciones (módulo de bienes). */
  depreciation: {
    /** Bienes registrados en Contabilidad › Inmovilizado. */
    assets: number;
    /** Bienes con dotaciones del ejercicio (o anteriores) sin contabilizar, y su importe. */
    pendingAssets: number;
    pendingCents: number;
    /** Saldo de los grupos 20, 21 y 22 al cierre: si hay saldo pero ningún bien registrado, se recuerda. */
    fixedAssetBalanceCents: number;
  };
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

  const depreciation = facts.depreciation;
  if (depreciation.pendingAssets > 0) {
    items.push({
      id: "depreciation",
      title: "Amortizaciones del año contabilizadas",
      status: "pending",
      detail: `Quedan ${euros(depreciation.pendingCents)} de amortización sin contabilizar en ${plural(depreciation.pendingAssets, "bien", "bienes")} hasta el cierre de ${facts.yearCode}. Contabilízalas desde Inmovilizado antes de cerrar.`,
      href: "/accounting/assets",
      actionLabel: "Contabilizar amortizaciones",
    });
  } else if (depreciation.assets > 0) {
    items.push({
      id: "depreciation",
      title: "Amortizaciones del año contabilizadas",
      status: "ok",
      detail: `Las amortizaciones de ${plural(depreciation.assets, "bien registrado", "bienes registrados")} están contabilizadas hasta el cierre de ${facts.yearCode}.`,
      href: "/accounting/assets",
      actionLabel: "Ver inmovilizado",
    });
  } else if (depreciation.fixedAssetBalanceCents !== 0) {
    items.push({
      id: "depreciation",
      title: "Amortizaciones del año contabilizadas",
      status: "review",
      detail: `El balance tiene ${euros(depreciation.fixedAssetBalanceCents)} de inmovilizado (grupos 20, 21 y 22) pero no hay ningún bien registrado. Da de alta los bienes en Inmovilizado para que el programa calcule y contabilice su amortización, o regístrala con un asiento manual.`,
      href: "/accounting/assets/new",
      actionLabel: "Registrar un bien",
    });
  } else {
    items.push({
      id: "depreciation",
      title: "Amortizaciones del año contabilizadas",
      status: "ok",
      detail: "No hay bienes de inmovilizado registrados ni saldo en las cuentas de inmovilizado: no hay nada que amortizar.",
      href: "/accounting/assets",
      actionLabel: "Ver inmovilizado",
    });
  }

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
