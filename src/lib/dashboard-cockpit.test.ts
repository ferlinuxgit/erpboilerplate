import { describe, expect, it } from "vitest";

import { buildDashboardCockpit } from "./dashboard-cockpit";

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
      "Prepara una oferta o pedido",
      "Revisa inventario y servicios",
    ]);
    expect(cockpit.emptyStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Sin clientes todavía", href: "/customers" }),
        expect.objectContaining({ title: "Sin documentos de venta", href: "/sales" }),
      ]),
    );
    expect("guidedDemoSteps" in cockpit).toBe(true);
    expect((cockpit as unknown as { guidedDemoSteps: Array<{ actionLabel: string; completed: boolean; isNext: boolean }> }).guidedDemoSteps).toMatchObject([
      { actionLabel: "Crear cliente", completed: false, isNext: true },
      { actionLabel: "Crear presupuesto/pedido", completed: false, isNext: false },
      { actionLabel: "Emitir factura", completed: false, isNext: false },
      { actionLabel: "Registrar cobro", completed: false, isNext: false },
      { actionLabel: "Revisar inventario", completed: false, isNext: false },
    ]);
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
    expect(cockpit.primaryActions.map((action) => action.title).slice(0, 3)).toEqual([
      "Mantén clientes activos",
      "Prepara una oferta o pedido",
      "Revisa inventario y servicios",
    ]);
    expect(cockpit.emptyStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Sin documentos de venta", href: "/sales" }),
        expect.objectContaining({ title: "Inventario sin alertas", href: "/inventory" }),
      ]),
    );
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
    expect(cockpit.emptyStates).not.toEqual(expect.arrayContaining([expect.objectContaining({ title: "Sin documentos de venta" })]));
    expect(cockpit.primaryActions[2]).toMatchObject({ title: "Emite la siguiente factura", href: "/invoices" });
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
});
