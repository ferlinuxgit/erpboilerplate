import { describe, expect, it } from "vitest";

import { buildDashboardCockpit, buildSetupChecklist } from "./dashboard-cockpit";

describe("dashboard cockpit model", () => {
  it("guides first-run users through the first three ERP actions without fake metrics", () => {
    const cockpit = buildDashboardCockpit({
      now: new Date("2026-05-09T12:00:00.000Z"),
      customers: [],
      salesQuotes: [],
      salesOrders: [],
      deliveryNotes: [],
      invoices: [],
      lowStockAlerts: [],
    });

    expect(cockpit.stateLabel).toBe("Primeros pasos");
    expect(cockpit.metrics).toMatchObject({
      activeCustomers: 0,
      salesInProgress: 0,
      unpaidInvoices: 0,
      overdueInvoices: 0,
      lowStockAlerts: 0,
    });
    expect(cockpit.primaryActions.map((action) => action.title).slice(0, 3)).toEqual([
      "Crea tu primer cliente",
      "Haz una factura",
      "Registra un gasto",
    ]);
    expect(cockpit.primaryActions.every((action) => action.href.endsWith("/new"))).toBe(true);
    // Without setup data the company is assumed configured: only customer and invoice remain.
    expect(cockpit.setupChecklist).toMatchObject({ completedCount: 3, total: 5, complete: false });
    expect(cockpit.setupChecklist.steps.find((step) => step.isNext)).toMatchObject({ key: "customer", href: "/customers/new" });
  });

  it("labels initial seeded customer data separately from daily operations", () => {
    const cockpit = buildDashboardCockpit({
      now: new Date("2026-05-09T12:00:00.000Z"),
      customers: [{ status: "ACTIVE" }],
      salesQuotes: [],
      salesOrders: [],
      deliveryNotes: [],
      invoices: [],
      lowStockAlerts: [],
    });

    expect(cockpit.stateLabel).toBe("Datos iniciales");
    expect(cockpit.primaryActions[0]).toMatchObject({ title: "Da de alta un cliente", href: "/customers/new" });
    expect(cockpit.setupChecklist.steps.find((step) => step.isNext)).toMatchObject({ key: "invoice", href: "/invoices/new" });
  });

  it("treats delivered delivery notes as actionable sales work before invoicing", () => {
    const cockpit = buildDashboardCockpit({
      now: new Date("2026-05-09T12:00:00.000Z"),
      customers: [{ status: "ACTIVE" }],
      salesQuotes: [],
      salesOrders: [],
      deliveryNotes: [{ status: "DELIVERED" }],
      invoices: [],
      lowStockAlerts: [],
    });

    expect(cockpit.stateLabel).toBe("Operación real");
    expect(cockpit.metrics.salesInProgress).toBe(1);
    expect(cockpit.primaryActions.find((action) => action.href === "/invoices/new")?.description).toContain("ventas en curso");
  });

  it("subtracts registered invoice payments from partial receivables", () => {
    const cockpit = buildDashboardCockpit({
      now: new Date("2026-05-09T12:00:00.000Z"),
      customers: [{ status: "ACTIVE" }],
      salesQuotes: [],
      salesOrders: [],
      deliveryNotes: [],
      invoices: [{ id: "invoice-1", dueDate: null, paymentStatus: "PARTIAL", totalAmount: "100.00" }],
      invoicePayments: [{ invoiceId: "invoice-1", amountApplied: "35.50" }],
      lowStockAlerts: [],
    });

    expect(cockpit.metrics.receivablesAmount).toBe(64.5);
    expect(cockpit.metricCards.find((metric) => metric.label === "Facturas por cobrar")?.helper).toContain("64,50");
  });

  it("summarizes real operational state and prioritizes cash collection when invoices are due", () => {
    const cockpit = buildDashboardCockpit({
      now: new Date("2026-05-09T12:00:00.000Z"),
      customers: [{ status: "ACTIVE" }, { status: "INACTIVE" }],
      salesQuotes: [{ status: "SENT" }, { status: "VOID" }],
      salesOrders: [{ status: "CONFIRMED" }],
      deliveryNotes: [{ status: "INVOICED" }],
      invoices: [
        { dueDate: new Date("2026-05-01T00:00:00.000Z"), paymentStatus: "PENDING", totalAmount: "121.00" },
        { dueDate: new Date("2026-06-01T00:00:00.000Z"), paymentStatus: "PAID", totalAmount: "50.00" },
        { dueDate: null, paymentStatus: "PARTIAL", totalAmount: "25.50" },
      ],
      lowStockAlerts: [{ itemName: "Toner", itemSku: "TON", quantity: "1", minimumStock: "2" }],
    });

    expect(cockpit.stateLabel).toBe("Operación real");
    expect(cockpit.metrics).toMatchObject({
      activeCustomers: 1,
      salesInProgress: 2,
      unpaidInvoices: 2,
      overdueInvoices: 1,
      receivablesAmount: 146.5,
      lowStockAlerts: 1,
    });
    expect(cockpit.primaryActions[0]).toMatchObject({ title: "Registra o concilia cobros", href: "/treasury" });
    expect(cockpit.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tone: "warning", title: "1 factura vencida" }),
        expect.objectContaining({ tone: "critical", title: "1 alerta de stock" }),
      ]),
    );
  });

  it("builds the setup checklist in order with direct links and the first pending step as next", () => {
    const checklist = buildSetupChecklist({
      missingCompanyFields: ["CIF/NIF", "Dirección fiscal"],
      hasInvoiceSeries: false,
      hasBankAccount: false,
      hasCustomer: false,
      hasInvoice: false,
    });

    expect(checklist.steps.map((step) => step.key)).toEqual(["company", "series", "bank", "customer", "invoice"]);
    expect(checklist.steps.map((step) => step.href)).toEqual(["/settings/company", "/onboarding", "/treasury/bank-accounts/new", "/customers/new", "/invoices/new"]);
    expect(checklist.steps[0]).toMatchObject({ completed: false, isNext: true });
    expect(checklist.steps[0].description).toContain("CIF/NIF, Dirección fiscal");
    expect(checklist.steps.filter((step) => step.isNext)).toHaveLength(1);
    expect(checklist).toMatchObject({ completedCount: 0, complete: false });
  });

  it("marks the checklist complete only when every step is done", () => {
    const partial = buildSetupChecklist({ missingCompanyFields: [], hasInvoiceSeries: true, hasBankAccount: false, hasCustomer: true, hasInvoice: true });
    expect(partial.steps.find((step) => step.isNext)?.key).toBe("bank");
    expect(partial.complete).toBe(false);

    const done = buildSetupChecklist({ missingCompanyFields: [], hasInvoiceSeries: true, hasBankAccount: true, hasCustomer: true, hasInvoice: true });
    expect(done).toMatchObject({ completedCount: 5, total: 5, complete: true });
    expect(done.steps.some((step) => step.isNext)).toBe(false);
  });

  it("feeds real setup data into the dashboard checklist", () => {
    const cockpit = buildDashboardCockpit(emptyInput, {
      setup: { missingCompanyFields: ["Razón social"], hasInvoiceSeries: false, hasBankAccount: false },
    });
    expect(cockpit.setupChecklist.completedCount).toBe(0);
    expect(cockpit.setupChecklist.steps[0]).toMatchObject({ key: "company", isNext: true });
  });

  it("hides stock nudges for service businesses but keeps real stock alerts", () => {
    const services = buildDashboardCockpit(emptyInput, { businessType: "services" });
    expect(services.metricCards.some((card) => card.href === "/inventory")).toBe(false);
    expect(services.primaryActions.some((action) => action.href.startsWith("/inventory"))).toBe(false);

    const products = buildDashboardCockpit(emptyInput, { businessType: "products" });
    expect(products.metricCards.some((card) => card.href === "/inventory")).toBe(true);
    expect(products.primaryActions.some((action) => action.href === "/inventory/items/new")).toBe(true);

    const servicesWithAlerts = buildDashboardCockpit(
      { ...emptyInput, lowStockAlerts: [{ itemName: "Toner", itemSku: "TON", quantity: "1", minimumStock: "2" }] },
      { businessType: "services" },
    );
    expect(servicesWithAlerts.metricCards.some((card) => card.href === "/inventory")).toBe(true);
  });
});

const emptyInput = {
  now: new Date("2026-05-09T12:00:00.000Z"),
  customers: [],
  salesQuotes: [],
  salesOrders: [],
  deliveryNotes: [],
  invoices: [],
  lowStockAlerts: [],
};
