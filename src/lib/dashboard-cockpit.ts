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

export type DashboardEmptyState = {
  title: string;
  description: string;
  href: string;
  actionLabel: string;
};

export type DashboardAlert = {
  title: string;
  description: string;
  href: string;
  tone: "warning" | "critical";
};

export type DashboardGuidedDemoStep = {
  step: number;
  title: string;
  description: string;
  href: string;
  actionLabel: string;
  completed: boolean;
  isNext: boolean;
};

export type DashboardMetric = {
  label: string;
  value: string;
  helper: string;
  href: string;
  tone: "neutral" | "warning" | "danger";
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
  guidedDemoSteps: DashboardGuidedDemoStep[];
  emptyStates: DashboardEmptyState[];
  alerts: DashboardAlert[];
};

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

function buildMetricCards(cockpit: DashboardCockpit["metrics"], currencyCode: string): DashboardMetric[] {
  const receivables = cockpit.receivablesAmount.toLocaleString("es-ES", { style: "currency", currency: currencyCode });
  const overdue = cockpit.overdueInvoices > 0 ? ` · ${formatCount(cockpit.overdueInvoices, "vencida", "vencidas")}` : "";
  return [
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
}

type GuidedDemoProgress = {
  hasCustomer: boolean;
  hasSalesDocument: boolean;
  hasInvoice: boolean;
  hasRecordedPayment: boolean;
  hasInventorySignal: boolean;
};

function buildGuidedDemoSteps(progress: GuidedDemoProgress): DashboardGuidedDemoStep[] {
  const steps = [
    {
      step: 1,
      title: "Crea la base comercial",
      description: "Da de alta un cliente real o de demo para activar presupuestos, pedidos y facturas.",
      href: "/customers",
      actionLabel: "Crear cliente",
      completed: progress.hasCustomer,
    },
    {
      step: 2,
      title: "Prepara la primera venta",
      description: "Recorre presupuesto o pedido y valida que cada transición pide el dato correcto.",
      href: "/sales",
      actionLabel: "Crear presupuesto/pedido",
      completed: progress.hasSalesDocument,
    },
    {
      step: 3,
      title: "Emite la factura",
      description: "Convierte trabajo entregado en una factura lista para seguimiento de cobro.",
      href: "/invoices",
      actionLabel: "Emitir factura",
      completed: progress.hasInvoice,
    },
    {
      step: 4,
      title: "Registra el cobro",
      description: "Marca pagos parciales o totales desde tesorería para que los KPIs reflejen caja real.",
      href: "/treasury",
      actionLabel: "Registrar cobro",
      completed: progress.hasRecordedPayment,
    },
    {
      step: 5,
      title: "Revisa inventario",
      description: "Comprueba stock y mínimos para detectar roturas antes de comprometer entregas.",
      href: "/inventory",
      actionLabel: "Revisar inventario",
      completed: progress.hasInventorySignal,
    },
  ];
  const nextStep = steps.find((step) => !step.completed)?.step;

  return steps.map((step) => ({
    ...step,
    isNext: step.step === nextStep,
  }));
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

export function buildDashboardCockpit(input: DashboardCockpitInput): DashboardCockpit {
  return buildDashboardCockpitFromSummary(summarizeDashboardInput(input), input.currencyCode);
}

export function buildDashboardCockpitFromSummary(summary: DashboardCockpitSummary, currencyCode = "EUR"): DashboardCockpit {
  const { activeCustomers, salesInProgress, overdueInvoices, lowStockAlerts, hasRecordedPayment } = summary;
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

  const emptyStates: DashboardEmptyState[] = [];
  if (activeCustomers === 0) {
    emptyStates.push({
      title: "Sin clientes todavía",
      description: "Empieza creando un cliente para habilitar presupuestos, pedidos y facturas reales.",
      href: "/customers",
      actionLabel: "Crear cliente",
    });
  }
  if (salesInProgress === 0) {
    emptyStates.push({
      title: "Sin documentos de venta",
      description: "Registra presupuestos, pedidos o albaranes desde sus secciones independientes.",
      href: "/sales",
      actionLabel: "Abrir ventas",
    });
  }
  if (lowStockAlerts === 0) {
    emptyStates.push({
      title: "Inventario sin alertas",
      description: "Revisa el stock inicial y mínimos para que el cockpit detecte roturas antes de vender.",
      href: "/inventory",
      actionLabel: "Revisar inventario",
    });
  }

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
      title: activeCustomers === 0 ? "Crea tu primer cliente" : "Mantén clientes activos",
      description: "Centraliza datos comerciales antes de presupuestar o facturar.",
      href: "/customers",
      eyebrow: "1",
    },
    {
      title: "Prepara una oferta o pedido",
      description: "Crea un presupuesto o registra directamente un pedido confirmado.",
      href: "/sales",
      eyebrow: "2",
    },
    {
      title: salesInProgress > 0 ? "Emite la siguiente factura" : "Revisa inventario y servicios",
      description: salesInProgress > 0 ? "Convierte entregas en factura y deja listo el cobro." : "Valida stock, servicios y mínimos antes de vender.",
      href: salesInProgress > 0 ? "/invoices" : "/inventory",
      eyebrow: "3",
    },
  );

  const guidedDemoSteps = buildGuidedDemoSteps({
    hasCustomer: activeCustomers > 0,
    hasSalesDocument: salesInProgress > 0 || summary.invoiceCount > 0,
    hasInvoice: summary.invoiceCount > 0,
    hasRecordedPayment,
    hasInventorySignal: summary.inventoryItemsCount > 0 || lowStockAlerts > 0,
  });

  return {
    stateLabel,
    metrics,
    metricCards: buildMetricCards(metrics, currencyCode),
    primaryActions: primaryActions.slice(0, 4),
    guidedDemoSteps,
    emptyStates,
    alerts,
  };
}
