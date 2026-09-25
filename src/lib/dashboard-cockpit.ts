import type { BusinessType } from "@/lib/company-readiness";

type CustomerInput = {
  status: string;
};

type SalesDocumentInput = {
  status: string;
};

type InvoiceInput = {
  id?: string;
  dueDate: Date | null;
  paymentStatus: string;
  totalAmount: string | number;
  /** Lifecycle fields (optional for older callers): drafts and credit notes are not receivables. */
  number?: string;
  status?: string;
  issuedAt?: Date | string | null;
  invoiceType?: string;
  /** Credit notes: invoice they rectify (their negative total reduces its outstanding). */
  rectifiedInvoiceId?: string | null;
};

type InvoicePaymentInput = {
  invoiceId: string;
  amountApplied: string | number;
};

type LowStockAlertInput = {
  itemName: string;
  itemSku: string;
  quantity: string | number;
  minimumStock: string | number;
};

export type DashboardCockpitInput = {
  now?: Date;
  customers: CustomerInput[];
  salesQuotes: SalesDocumentInput[];
  salesOrders: SalesDocumentInput[];
  deliveryNotes: SalesDocumentInput[];
  invoices: InvoiceInput[];
  invoicePayments?: InvoicePaymentInput[];
  lowStockAlerts: LowStockAlertInput[];
  inventoryItemsCount?: number;
  currencyCode?: string;
};

/** Counts behind the cockpit, computed with SQL aggregates in `src/server/reporting/dashboard.ts`. */
export type DashboardCockpitSummary = {
  activeCustomers: number;
  salesInProgress: number;
  invoiceCount: number;
  unpaidInvoices: number;
  overdueInvoices: number;
  receivablesAmount: number;
  lowStockAlerts: number;
  hasRecordedPayment: boolean;
  inventoryItemsCount: number;
};

export type DashboardAction = {
  title: string;
  description: string;
  href: string;
  eyebrow: string;
};

export type DashboardAlert = {
  title: string;
  description: string;
  href: string;
  tone: "warning" | "critical";
};

export type DashboardMetric = {
  label: string;
  value: string;
  helper: string;
  href: string;
  tone: "neutral" | "warning" | "danger";
};

/** Datos de configuración (fuera del resumen operativo) que alimentan la puesta en marcha. */
export type DashboardSetupInput = {
  /** Etiquetas de los datos fiscales que faltan para facturar (vacío = lista para facturar). */
  missingCompanyFields: string[];
  hasInvoiceSeries: boolean;
  hasBankAccount: boolean;
};

export type SetupStepKey = "company" | "series" | "bank" | "customer" | "invoice";

export type SetupChecklistStep = {
  key: SetupStepKey;
  title: string;
  description: string;
  href: string;
  actionLabel: string;
  completed: boolean;
  isNext: boolean;
};

export type SetupChecklist = {
  steps: SetupChecklistStep[];
  completedCount: number;
  total: number;
  complete: boolean;
};

export type DashboardCockpit = {
  stateLabel: "Primeros pasos" | "Datos iniciales" | "Operación real";
  metrics: {
    activeCustomers: number;
    salesInProgress: number;
    unpaidInvoices: number;
    overdueInvoices: number;
    receivablesAmount: number;
    lowStockAlerts: number;
  };
  metricCards: DashboardMetric[];
  primaryActions: DashboardAction[];
  alerts: DashboardAlert[];
  /** Lista única de puesta en marcha: se muestra primero hasta completarla. */
  setupChecklist: SetupChecklist;
};

export type DashboardCockpitOptions = {
  currencyCode?: string;
  businessType?: BusinessType;
  setup?: DashboardSetupInput;
};

/**
 * Pasos para pasar de "cuenta nueva" a "lista para facturar", con enlace directo a la
 * pantalla que resuelve cada uno.
 */
export function buildSetupChecklist(input: DashboardSetupInput & { hasCustomer: boolean; hasInvoice: boolean }): SetupChecklist {
  const missing = input.missingCompanyFields;
  const steps: Array<Omit<SetupChecklistStep, "isNext">> = [
    {
      key: "company",
      title: "Completa los datos fiscales",
      description: missing.length > 0 ? `Falta: ${missing.join(", ")}. Sin ellos la factura no es válida.` : "Razón social, NIF y domicilio fiscal completos.",
      href: "/settings/company",
      actionLabel: "Completar datos fiscales",
      completed: missing.length === 0,
    },
    {
      key: "series",
      title: "Elige la serie de tus facturas",
      description: "El prefijo con el que se numeran (por ejemplo FA000001).",
      href: "/onboarding",
      actionLabel: "Configurar la serie",
      completed: input.hasInvoiceSeries,
    },
    {
      key: "bank",
      title: "Añade tu cuenta bancaria",
      description: "Aparece en las facturas para que te paguen por transferencia.",
      href: "/treasury/bank-accounts/new",
      actionLabel: "Añadir cuenta bancaria",
      completed: input.hasBankAccount,
    },
    {
      key: "customer",
      title: "Da de alta tu primer cliente",
      description: "Nombre, NIF y dirección de a quién vas a facturar.",
      href: "/customers/new",
      actionLabel: "Crear cliente",
      completed: input.hasCustomer,
    },
    {
      key: "invoice",
      title: "Haz tu primera factura",
      description: "Se guarda como borrador hasta que decidas emitirla.",
      href: "/invoices/new",
      actionLabel: "Crear factura",
      completed: input.hasInvoice,
    },
  ];
  const nextKey = steps.find((step) => !step.completed)?.key;
  const completedCount = steps.filter((step) => step.completed).length;
  return {
    steps: steps.map((step) => ({ ...step, isNext: step.key === nextKey })),
    completedCount,
    total: steps.length,
    complete: completedCount === steps.length,
  };
}

const inactiveSalesStatuses = new Set(["VOID", "PAID", "INVOICED"]);
const closedInvoiceStatuses = new Set(["PAID", "VOID"]);

function toNumber(value: string | number) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const DRAFT_NUMBER_PREFIX = "BORRADOR-";

/** Same rule as `invoiceLifecycle`: provisional number and never issued. */
function isDraftInvoice(invoice: InvoiceInput) {
  return !invoice.issuedAt && Boolean(invoice.number?.startsWith(DRAFT_NUMBER_PREFIX));
}

function isCreditNote(invoice: InvoiceInput) {
  return invoice.invoiceType === "CREDIT_NOTE";
}

/** Issued credit note that counts against its original invoice (as in `getInvoiceBalance`). */
function isAppliedCreditNote(invoice: InvoiceInput) {
  return isCreditNote(invoice) && Boolean(invoice.issuedAt) && invoice.status !== "VOID";
}

function isUnpaidInvoice(invoice: InvoiceInput) {
  return (
    !closedInvoiceStatuses.has(invoice.paymentStatus) &&
    invoice.status !== "VOID" &&
    !isDraftInvoice(invoice) &&
    !isCreditNote(invoice)
  );
}

function isOverdue(invoice: InvoiceInput, now: Date) {
  if (!isUnpaidInvoice(invoice)) return false;
  if (invoice.paymentStatus === "OVERDUE") return true;
  return invoice.dueDate ? invoice.dueDate.getTime() < now.getTime() : false;
}

function formatCount(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function buildMetricCards(cockpit: DashboardCockpit["metrics"], currencyCode: string, businessType: BusinessType): DashboardMetric[] {
  const receivables = cockpit.receivablesAmount.toLocaleString("es-ES", { style: "currency", currency: currencyCode });
  const overdue = cockpit.overdueInvoices > 0 ? ` · ${formatCount(cockpit.overdueInvoices, "vencida", "vencidas")}` : "";
  const cards: DashboardMetric[] = [
    {
      label: "Clientes activos",
      value: String(cockpit.activeCustomers),
      helper: "Base comercial disponible para presupuestos, pedidos y facturas.",
      href: "/customers",
      tone: "neutral",
    },
    {
      label: "Ventas en curso",
      value: String(cockpit.salesInProgress),
      helper: "Presupuestos, pedidos o albaranes pendientes de completar.",
      href: "/sales/quotes",
      tone: "neutral",
    },
    {
      label: "Facturas por cobrar",
      value: String(cockpit.unpaidInvoices),
      helper: `${receivables} pendiente de cobro${overdue}.`,
      href: "/invoices",
      tone: cockpit.overdueInvoices > 0 ? "warning" : "neutral",
    },
    {
      label: "Alertas de stock",
      value: String(cockpit.lowStockAlerts),
      helper: "Artículos por debajo del mínimo configurado.",
      href: "/inventory",
      tone: cockpit.lowStockAlerts > 0 ? "danger" : "neutral",
    },
  ];
  // Empresas de servicios: sin stock que vigilar (salvo que ya tengan alertas reales).
  return businessType === "services" && cockpit.lowStockAlerts === 0 ? cards.filter((card) => card.href !== "/inventory") : cards;
}

/** Row-level input → summary (kept for callers and tests that already have the rows). */
export function summarizeDashboardInput(input: DashboardCockpitInput): DashboardCockpitSummary {
  const now = input.now ?? new Date();
  const appliedPaymentsByInvoiceId = (input.invoicePayments ?? []).reduce<Record<string, number>>((totals, payment) => {
    totals[payment.invoiceId] = (totals[payment.invoiceId] ?? 0) + toNumber(payment.amountApplied);
    return totals;
  }, {});
  const activeCustomers = input.customers.filter((customer) => customer.status === "ACTIVE").length;
  const salesInProgress = [...input.salesQuotes, ...input.salesOrders, ...input.deliveryNotes].filter(
    (document) => !inactiveSalesStatuses.has(document.status),
  ).length;
  const creditedByInvoiceId = input.invoices.filter(isAppliedCreditNote).reduce<Record<string, number>>((totals, note) => {
    if (note.rectifiedInvoiceId) totals[note.rectifiedInvoiceId] = (totals[note.rectifiedInvoiceId] ?? 0) + toNumber(note.totalAmount);
    return totals;
  }, {});
  const netOutstanding = (invoice: InvoiceInput) => {
    const paidAmount = invoice.id ? (appliedPaymentsByInvoiceId[invoice.id] ?? 0) : 0;
    const creditedAmount = invoice.id ? (creditedByInvoiceId[invoice.id] ?? 0) : 0;
    return Math.max(toNumber(invoice.totalAmount) + creditedAmount - paidAmount, 0);
  };
  const unpaidInvoices = input.invoices.filter((invoice) => isUnpaidInvoice(invoice) && netOutstanding(invoice) > 0);
  const overdueInvoices = unpaidInvoices.filter((invoice) => isOverdue(invoice, now)).length;
  const receivablesAmount = Math.round(unpaidInvoices.reduce((total, invoice) => total + netOutstanding(invoice) * 100, 0)) / 100;
  const lowStockAlerts = input.lowStockAlerts.length;
  const hasRecordedPayment = input.invoices.some((invoice) => !isCreditNote(invoice) && (invoice.paymentStatus === "PARTIAL" || invoice.paymentStatus === "PAID")) ||
    (input.invoicePayments ?? []).length > 0;

  return {
    activeCustomers,
    salesInProgress,
    invoiceCount: input.invoices.length,
    unpaidInvoices: unpaidInvoices.length,
    overdueInvoices,
    receivablesAmount,
    lowStockAlerts,
    hasRecordedPayment,
    inventoryItemsCount: input.inventoryItemsCount ?? 0,
  };
}

export function buildDashboardCockpit(input: DashboardCockpitInput, options: Omit<DashboardCockpitOptions, "currencyCode"> = {}): DashboardCockpit {
  return buildDashboardCockpitFromSummary(summarizeDashboardInput(input), { ...options, currencyCode: input.currencyCode });
}

export function buildDashboardCockpitFromSummary(summary: DashboardCockpitSummary, options: DashboardCockpitOptions = {}): DashboardCockpit {
  const currencyCode = options.currencyCode ?? "EUR";
  const businessType = options.businessType ?? "both";
  const sellsProducts = businessType !== "services";
  const { activeCustomers, salesInProgress, overdueInvoices, lowStockAlerts } = summary;
  const metrics = {
    activeCustomers,
    salesInProgress,
    unpaidInvoices: summary.unpaidInvoices,
    overdueInvoices,
    receivablesAmount: summary.receivablesAmount,
    lowStockAlerts,
  };

  const hasOperationalSignals = salesInProgress > 0 || metrics.unpaidInvoices > 0 || lowStockAlerts > 0;
  const stateLabel =
    activeCustomers === 0 && !hasOperationalSignals ? "Primeros pasos" : hasOperationalSignals ? "Operación real" : "Datos iniciales";

  const alerts: DashboardAlert[] = [];
  if (overdueInvoices > 0) {
    alerts.push({
      title: formatCount(overdueInvoices, "factura vencida", "facturas vencidas"),
      description: "Prioriza cobros y conciliación para cerrar caja y tesorería.",
      href: "/treasury",
      tone: "warning",
    });
  }
  if (lowStockAlerts > 0) {
    alerts.push({
      title: formatCount(lowStockAlerts, "alerta de stock", "alertas de stock"),
      description: "Hay artículos por debajo del mínimo. Revisa compras o ajustes antes de comprometer entregas.",
      href: "/inventory",
      tone: "critical",
    });
  }

  const primaryActions: DashboardAction[] = [];
  if (overdueInvoices > 0 || metrics.unpaidInvoices > 0) {
    primaryActions.push({
      title: "Registra o concilia cobros",
      description: "Cierra facturas pendientes desde tesorería y mantén la caja al día.",
      href: "/treasury",
      eyebrow: "Caja",
    });
  }
  primaryActions.push(
    {
      title: activeCustomers === 0 ? "Crea tu primer cliente" : "Da de alta un cliente",
      description: "Nombre, NIF y dirección de a quién vas a facturar.",
      href: "/customers/new",
      eyebrow: "Clientes",
    },
    {
      title: "Haz una factura",
      description: salesInProgress > 0 ? "Tienes ventas en curso: conviértelas en factura y deja listo el cobro." : "Se guarda como borrador hasta que la emitas.",
      href: "/invoices/new",
      eyebrow: "Ventas",
    },
    {
      title: "Registra un gasto",
      description: "Sube el ticket o la factura del proveedor para deducir el IVA.",
      href: "/expenses/new",
      eyebrow: "Gastos",
    },
  );
  // El catálogo de productos y el stock solo se sugieren a quien vende productos.
  if (sellsProducts && summary.inventoryItemsCount === 0) {
    primaryActions.push({
      title: "Da de alta tus productos",
      description: "Con precio e IVA, para no teclearlos en cada factura y controlar el stock.",
      href: "/inventory/items/new",
      eyebrow: "Catálogo",
    });
  }
  primaryActions.push({
    title: "Prepara un presupuesto",
    description: "Envía una oferta y conviértela en pedido o factura cuando la acepten.",
    href: "/sales/new",
    eyebrow: "Ventas",
  });

  const setup = options.setup ?? { missingCompanyFields: [], hasInvoiceSeries: true, hasBankAccount: true };
  const setupChecklist = buildSetupChecklist({ ...setup, hasCustomer: activeCustomers > 0, hasInvoice: summary.invoiceCount > 0 });

  return {
    stateLabel,
    metrics,
    metricCards: buildMetricCards(metrics, currencyCode, businessType),
    primaryActions: primaryActions.slice(0, 4),
    alerts,
    setupChecklist,
  };
}
