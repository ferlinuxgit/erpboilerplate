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

function isUnpaidInvoice(invoice: InvoiceInput) {
  return !closedInvoiceStatuses.has(invoice.paymentStatus);
}

function isOverdue(invoice: InvoiceInput, now: Date) {
  if (!isUnpaidInvoice(invoice)) return false;
  if (invoice.paymentStatus === "OVERDUE") return true;
  return invoice.dueDate ? invoice.dueDate.getTime() < now.getTime() : false;
}

function formatCount(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function buildMetricCards(cockpit: DashboardCockpit["metrics"]): DashboardMetric[] {
  return [
    {
      label: "Clientes activos",
      value: String(cockpit.activeCustomers),
      helper: "Base comercial disponible para presupuestos, pedidos y facturas.",
      href: "/customers",
    },
    {
      label: "Ventas en curso",
      value: String(cockpit.salesInProgress),
      helper: "Presupuestos, pedidos o albaranes pendientes de completar.",
      href: "/sales",
    },
    {
      label: "Facturas por cobrar",
      value: String(cockpit.unpaidInvoices),
      helper: `${cockpit.receivablesAmount.toLocaleString("es-ES", { style: "currency", currency: "EUR" })} pendiente de cobro.`,
      href: "/invoices",
    },
    {
      label: "Alertas de stock",
      value: String(cockpit.lowStockAlerts),
      helper: "Artículos por debajo del mínimo configurado.",
      href: "/inventory",
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

export function buildDashboardCockpit(input: DashboardCockpitInput): DashboardCockpit {
  const now = input.now ?? new Date();
  const appliedPaymentsByInvoiceId = (input.invoicePayments ?? []).reduce<Record<string, number>>((totals, payment) => {
    totals[payment.invoiceId] = (totals[payment.invoiceId] ?? 0) + toNumber(payment.amountApplied);
    return totals;
  }, {});
  const activeCustomers = input.customers.filter((customer) => customer.status === "ACTIVE").length;
  const salesInProgress = [...input.salesQuotes, ...input.salesOrders, ...input.deliveryNotes].filter(
    (document) => !inactiveSalesStatuses.has(document.status),
  ).length;
  const unpaidInvoices = input.invoices.filter(isUnpaidInvoice);
  const overdueInvoices = unpaidInvoices.filter((invoice) => isOverdue(invoice, now)).length;
  const receivablesAmount = unpaidInvoices.reduce((total, invoice) => {
    const paidAmount = invoice.id ? (appliedPaymentsByInvoiceId[invoice.id] ?? 0) : 0;
    return total + Math.max(toNumber(invoice.totalAmount) - paidAmount, 0);
  }, 0);
  const lowStockAlerts = input.lowStockAlerts.length;
  const hasRecordedPayment = input.invoices.some((invoice) => invoice.paymentStatus === "PARTIAL" || invoice.paymentStatus === "PAID") ||
    (input.invoicePayments ?? []).length > 0;

  const metrics = {
    activeCustomers,
    salesInProgress,
    unpaidInvoices: unpaidInvoices.length,
    overdueInvoices,
    receivablesAmount,
    lowStockAlerts,
  };

  const hasOperationalSignals = salesInProgress > 0 || unpaidInvoices.length > 0 || lowStockAlerts > 0;
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
      description: "Crea una oferta guiada para recorrer presupuesto → pedido → albarán → factura.",
      href: "/sales",
      actionLabel: "Abrir ciclo de ventas",
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
  if (overdueInvoices > 0 || unpaidInvoices.length > 0) {
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
      description: "Sigue el flujo presupuesto → pedido → albarán con transiciones seguras.",
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
    hasSalesDocument: salesInProgress > 0 || input.invoices.length > 0,
    hasInvoice: input.invoices.length > 0,
    hasRecordedPayment,
    hasInventorySignal: (input.inventoryItemsCount ?? 0) > 0 || lowStockAlerts > 0,
  });

  return {
    stateLabel,
    metrics,
    metricCards: buildMetricCards(metrics),
    primaryActions: primaryActions.slice(0, 4),
    guidedDemoSteps,
    emptyStates,
    alerts,
  };
}
