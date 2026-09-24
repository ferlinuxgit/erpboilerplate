import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cobertura de auditoría: cada mutación de negocio debe llamar a `recordAudit`
 * con la acción `<entidad>.<verbo>` y el cliente de la MISMA transacción.
 */

type Call = { op: string; method: string; args: unknown[] };

const mocks = vi.hoisted(() => {
  const calls: Call[] = [];
  const queues: Record<string, unknown[][]> = { select: [], insert: [], update: [], delete: [] };
  const dbQueues: Record<string, unknown[][]> = { select: [] };

  function chain(op: string, queue: unknown[][]) {
    let result: unknown[] | undefined;
    const resolveResult = () => {
      if (result === undefined) result = queue.shift() ?? [];
      return result;
    };
    const proxy: unknown = new Proxy(() => undefined, {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
            Promise.resolve(resolveResult()).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          calls.push({ op, method: String(prop), args });
          return proxy;
        };
      },
    });
    return proxy;
  }

  const tx = {
    select: vi.fn((...args: unknown[]) => { calls.push({ op: "select", method: "select", args }); return chain("select", queues.select); }),
    insert: vi.fn((...args: unknown[]) => { calls.push({ op: "insert", method: "insert", args }); return chain("insert", queues.insert); }),
    update: vi.fn((...args: unknown[]) => { calls.push({ op: "update", method: "update", args }); return chain("update", queues.update); }),
    delete: vi.fn((...args: unknown[]) => { calls.push({ op: "delete", method: "delete", args }); return chain("delete", queues.delete); }),
  };

  return {
    calls,
    queues,
    dbQueues,
    tx,
    db: {
      select: vi.fn(() => chain("db.select", dbQueues.select)),
      transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    },
    recordAudit: vi.fn(),
    getUserSession: vi.fn(),
    ensureUserTenant: vi.fn(),
    requireContext: vi.fn(),
    requirePermission: vi.fn(),
    can: vi.fn(),
    authenticateApiActor: vi.fn(),
    reserveSeriesNumber: vi.fn(),
    refreshStockLocation: vi.fn(),
    rejectForeignItems: vi.fn(),
    createCustomerWithPartner: vi.fn(),
    updateCustomerWithPartner: vi.fn(),
    createSupplierWithPartner: vi.fn(),
    updateSupplierWithPartner: vi.fn(),
    removeSupplierRole: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/server/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/current-user", () => ({ getUserSession: mocks.getUserSession }));
vi.mock("@/lib/tenant", () => ({ ensureUserTenant: mocks.ensureUserTenant }));
vi.mock("@/lib/current-context", () => ({ requireContext: mocks.requireContext }));
vi.mock("@/lib/rbac", () => ({ can: mocks.can }));
vi.mock("@/lib/rbac-server", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/integration-auth", () => ({
  authenticateApiActor: mocks.authenticateApiActor,
  hasApiActorPermission: () => true,
  isAuthError: () => false,
}));
vi.mock("@/server/documents/series", () => ({ reserveSeriesNumber: mocks.reserveSeriesNumber }));
vi.mock("@/server/inventory/stock-location", () => ({ refreshStockLocation: mocks.refreshStockLocation }));
vi.mock("@/server/inventory/ownership", () => ({ rejectForeignItems: mocks.rejectForeignItems }));
vi.mock("@/server/accounting/auto-post", () => ({ postSalesInvoice: vi.fn() }));
vi.mock("@/server/customers/service", () => ({
  createCustomerWithPartner: mocks.createCustomerWithPartner,
  updateCustomerWithPartner: mocks.updateCustomerWithPartner,
}));
vi.mock("@/server/suppliers/service", () => ({
  createSupplierWithPartner: mocks.createSupplierWithPartner,
  updateSupplierWithPartner: mocks.updateSupplierWithPartner,
  removeSupplierRole: mocks.removeSupplierRole,
  getSupplier: vi.fn(),
  listSuppliers: vi.fn(),
}));

const session = { user: { id: "user_1", name: "Owner", email: "owner@example.com" } };
const ctx = {
  tenant: { id: "tenant_1", name: "Tenant", slug: "tenant" },
  company: { id: "company_1", name: "Company", baseCurrencyCode: "EUR", countryCode: "ES" },
  fiscalYear: { id: "fy_1", code: "2026" },
  membership: { id: "membership_1", role: "OWNER" },
  user: { id: "user_1" },
};

function request(method: string, body?: unknown) {
  return new Request("https://erp.example.com/api/test", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function expectAudit(action: string, extra: Record<string, unknown> = {}) {
  expect(mocks.recordAudit).toHaveBeenCalledWith(
    expect.objectContaining({ tenantId: "tenant_1", companyId: "company_1", action, ...extra }),
    mocks.tx,
  );
}

function valuesPassedTo(op: string) {
  const index = mocks.calls.findIndex((call) => call.op === op && call.method === "values");
  return index === -1 ? undefined : mocks.calls[index].args[0];
}

const partyPayload = {
  name: "Cliente Francés",
  taxId: "FR12345678901",
  address: "Rue de Paris 1",
  postalCode: "75001",
  city: "Paris",
  province: "Paris",
  countryCode: "FR",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.splice(0, mocks.calls.length);
  for (const queue of Object.values(mocks.queues)) queue.splice(0, queue.length);
  mocks.dbQueues.select.splice(0, mocks.dbQueues.select.length);
  mocks.recordAudit.mockResolvedValue(undefined);
  mocks.getUserSession.mockResolvedValue(session);
  mocks.ensureUserTenant.mockResolvedValue(ctx);
  mocks.requireContext.mockResolvedValue(ctx);
  mocks.requirePermission.mockResolvedValue({ ctx, user: session.user });
  mocks.can.mockReturnValue(true);
  mocks.authenticateApiActor.mockResolvedValue({ context: ctx, actorUserId: "user_1" });
  mocks.reserveSeriesNumber.mockResolvedValue("AUTO-1");
  mocks.refreshStockLocation.mockResolvedValue(undefined);
  mocks.rejectForeignItems.mockResolvedValue(null);
});

describe("customers", () => {
  it("audits creation inside the transaction", async () => {
    mocks.createCustomerWithPartner.mockResolvedValue({ id: "cust_1", number: "C-1", partnerId: "partner_1" });
    const { POST } = await import("@/app/api/customers/route");

    const response = await POST(request("POST", partyPayload));

    expect(response.status).toBe(201);
    expect(mocks.createCustomerWithPartner).toHaveBeenCalledWith(mocks.tx, "company_1", expect.any(Object));
    expectAudit("customer.create", { entityName: "customer", entityId: "cust_1", actorUserId: "user_1" });
  });

  it("audits update and delete inside the transaction", async () => {
    mocks.dbQueues.select.push([{ id: "cust_1", partnerId: "partner_1" }]);
    mocks.updateCustomerWithPartner.mockResolvedValue({ id: "cust_1" });
    const route = await import("@/app/api/customers/[id]/route");

    expect((await route.PATCH(request("PATCH", partyPayload), params("cust_1"))).status).toBe(200);
    expectAudit("customer.update", { entityId: "cust_1" });

    mocks.queues.delete.push([{ id: "cust_1", name: "Cliente", partnerId: "partner_1" }]);
    expect((await route.DELETE(request("DELETE"), params("cust_1"))).status).toBe(200);
    expectAudit("customer.delete", { entityId: "cust_1" });
  });

  it("does not audit when the customer does not exist", async () => {
    mocks.queues.delete.push([]);
    const route = await import("@/app/api/customers/[id]/route");

    expect((await route.DELETE(request("DELETE"), params("missing"))).status).toBe(404);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });
});

describe("suppliers", () => {
  it("audits creation, update and removal inside the transaction", async () => {
    mocks.createSupplierWithPartner.mockResolvedValue({ id: "partner_1", number: "P-1" });
    mocks.updateSupplierWithPartner.mockResolvedValue({ id: "partner_1" });
    mocks.removeSupplierRole.mockResolvedValue({ id: "partner_1" });
    const collection = await import("@/app/api/suppliers/route");
    const single = await import("@/app/api/suppliers/[id]/route");

    expect((await collection.POST(request("POST", partyPayload))).status).toBe(201);
    expectAudit("supplier.create", { entityName: "partner", entityId: "partner_1" });

    expect((await single.PATCH(request("PATCH", partyPayload), params("partner_1"))).status).toBe(200);
    expectAudit("supplier.update", { entityId: "partner_1" });

    expect((await single.DELETE(request("DELETE"), params("partner_1"))).status).toBe(200);
    expectAudit("supplier.delete", { entityId: "partner_1" });
    expect(mocks.removeSupplierRole).toHaveBeenCalledWith(mocks.tx, "company_1", "partner_1");
  });
});

describe("taxes", () => {
  it("audits creation", async () => {
    mocks.queues.insert.push([{ id: "tax_1", name: "IVA 21%", rate: "21.000", kind: "VAT", operation: "ADD", isDefault: false, isActive: true }]);
    const { POST } = await import("@/app/api/taxes/route");

    const response = await POST(request("POST", { name: "IVA 21%", rate: 21 }));

    expect(response.status).toBe(201);
    expectAudit("tax.create", { entityName: "tax", entityId: "tax_1", actorUserId: "user_1" });
  });

  it("audits update and archive", async () => {
    const route = await import("@/app/api/taxes/[id]/route");
    mocks.dbQueues.select.push([{ id: "tax_1", name: "IVA", rate: "21.000", kind: "VAT", operation: "ADD", isDefault: false, isActive: true }]);
    mocks.queues.update.push([{ id: "tax_1", rate: "10.000" }]);

    expect((await route.PATCH(request("PATCH", { rate: 10 }), params("tax_1")))!.status).toBe(200);
    expectAudit("tax.update", { entityId: "tax_1" });

    mocks.dbQueues.select.push([{ id: "tax_1", name: "IVA", rate: "10.000", kind: "VAT" }]);
    mocks.queues.select.push([{ count: 3 }]);
    mocks.queues.update.push([{ id: "tax_1", isActive: false }]);
    const response = (await route.DELETE(request("DELETE"), params("tax_1")))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ archived: true });
    expectAudit("tax.archive", { entityId: "tax_1" });
  });

  it("audits hard deletion of unused taxes", async () => {
    const route = await import("@/app/api/taxes/[id]/route");
    mocks.dbQueues.select.push([{ id: "tax_2", name: "Otro", rate: "5.000", kind: "OTHER" }]);
    mocks.queues.select.push([{ count: 0 }]);

    const response = (await route.DELETE(request("DELETE"), params("tax_2")))!;

    await expect(response.json()).resolves.toMatchObject({ deleted: true, archived: false });
    expectAudit("tax.delete", { entityId: "tax_2" });
  });
});

describe("company settings and profile", () => {
  const settingsPayload = {
    paymentTermsDays: 30,
    fiscalRegime: "general",
    prorrataPct: 80,
    defaultCustomerAccountCode: "430000",
    defaultSupplierAccountCode: "400000",
    defaultSalesAccountCode: "700000",
    defaultPurchaseAccountCode: "600000",
    defaultBankAccountCode: "572000",
  };

  it("audits the first save as creation and later saves as update", async () => {
    const { PUT } = await import("@/app/api/company-settings/route");
    mocks.queues.select.push([]);
    mocks.queues.insert.push([{ id: "settings_1" }]);

    expect((await PUT(request("PUT", settingsPayload))).status).toBe(201);
    expectAudit("companySettings.create", { entityName: "companySettings", entityId: "settings_1" });

    mocks.queues.select.push([{ id: "settings_1" }]);
    mocks.queues.update.push([{ id: "settings_1" }]);
    expect((await PUT(request("PUT", settingsPayload))).status).toBe(200);
    expectAudit("companySettings.update", {
      entityId: "settings_1",
      payload: expect.objectContaining({ prorrataPct: "80.000", fiscalRegime: "general" }),
    });
  });

  it("audits profile and PDF settings updates", async () => {
    const profile = await import("@/app/api/company/profile/route");
    mocks.queues.update.push([{ id: "company_1", name: "Nueva" }]);

    const response = (await profile.PUT(
      request("PUT", { name: "Nueva", countryCode: "FR", timezone: "Europe/Paris", baseCurrencyCode: "EUR" }),
    ))!;
    expect(response.status).toBe(200);
    expectAudit("company.profile.update", { entityName: "company", entityId: "company_1" });

    const pdf = await import("@/app/api/company/pdf-settings/route");
    mocks.queues.insert.push([{ id: "settings_1" }]);
    const pdfPayload = {
      showLogo: true,
      showEmail: true,
      showPhone: false,
      showWebsite: false,
      showCustomerNumber: true,
      showPaymentMethod: true,
      showTaxBreakdown: true,
    };
    expect((await pdf.PUT(request("PUT", pdfPayload)))!.status).toBe(200);
    expectAudit("company.pdf_settings.update", { entityName: "companySettings", entityId: "settings_1" });
  });
});

describe("sales documents", () => {
  const line = { description: "Consultoría", quantity: 2, unitPrice: 50, taxRate: 21 };

  it("audits quote creation and reserves the number by issue date", async () => {
    mocks.dbQueues.select.push([{ id: "customer_1" }]);
    mocks.queues.insert.push([{ id: "quote_1", number: "AUTO-1", customerId: "customer_1", totalAmount: "121.00" }]);
    const { POST } = await import("@/app/api/sales-quotes/route");

    const response = await POST(request("POST", { customerId: "customer_1", issueDate: "2026-03-10", lines: [line] }));

    expect(response.status).toBe(201);
    expect(mocks.reserveSeriesNumber).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ companyId: "company_1", type: "SALES_QUOTE", referenceDate: new Date("2026-03-10") }),
    );
    expectAudit("salesQuote.create", { entityName: "salesQuote", entityId: "quote_1" });
  });

  it("audits quote updates", async () => {
    mocks.dbQueues.select.push([{ id: "quote_1", status: "DRAFT" }], [{ id: "customer_1" }]);
    mocks.queues.update.push([{ id: "quote_1", number: "P-1", totalAmount: "121.00" }]);
    const { PATCH } = await import("@/app/api/sales-quotes/[id]/route");

    const response = await PATCH(
      request("PATCH", { customerId: "customer_1", number: "P-1", issueDate: "2026-03-10", lines: [line] }),
      params("quote_1"),
    );

    expect(response.status).toBe(200);
    expectAudit("salesQuote.update", { entityId: "quote_1" });
  });

  it("ignores a client-supplied sales order number and audits the creation", async () => {
    mocks.dbQueues.select.push([{ id: "customer_1" }]);
    mocks.queues.insert.push([{ id: "order_1", number: "AUTO-1", totalAmount: "121.00" }]);
    const { POST } = await import("@/app/api/sales-orders/route");

    const response = await POST(
      request("POST", { customerId: "customer_1", number: "HACKED-999", issueDate: "2026-04-02", lines: [line] }),
    );

    expect(response.status).toBe(201);
    expect(mocks.reserveSeriesNumber).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ type: "SALES_ORDER", referenceDate: new Date("2026-04-02") }),
    );
    expect(valuesPassedTo("insert")).toMatchObject({ number: "AUTO-1" });
    expectAudit("salesOrder.create", { entityName: "salesOrder", entityId: "order_1" });
  });

  it("audits quote to order conversion", async () => {
    mocks.queues.select.push(
      [{ id: "quote_1", number: "P-1", customerId: "customer_1", status: "SENT", subtotal: "100.00", taxAmount: "21.00", retentionAmount: "0.00", totalAmount: "121.00" }],
      [],
    );
    mocks.queues.insert.push([{ id: "order_1", number: "AUTO-1", totalAmount: "121.00" }]);
    const { POST } = await import("@/app/api/sales-quotes/[id]/to-order/route");

    const response = await POST(request("POST"), params("quote_1"));

    expect(response.status).toBe(201);
    expectAudit("salesQuote.convert", {
      entityName: "salesQuote",
      entityId: "quote_1",
      actorUserId: "user_1",
      payload: expect.objectContaining({ salesOrderId: "order_1" }),
    });
  });

  it("audits delivery note creation from an order", async () => {
    mocks.queues.select.push(
      [{ id: "order_1", number: "PV-1", customerId: "customer_1", status: "CONFIRMED" }],
      [{ id: "warehouse_1" }],
      [{ id: "order_line_1", itemId: "item_1", description: "Consultoría", quantity: "2" }],
      [],
      [{ currentQuantity: "10.000" }],
    );
    mocks.queues.insert.push([{ id: "delivery_1", number: "AUTO-1", salesOrderId: "order_1" }], [{ itemId: "item_1", quantity: "2.000", description: "Consultoría" }]);
    const { POST } = await import("@/app/api/sales-orders/[id]/to-delivery/route");

    const response = await POST(request("POST"), params("order_1"));

    expect(response.status).toBe(201);
    expectAudit("deliveryNote.create", { entityName: "deliveryNote", entityId: "delivery_1", actorUserId: "user_1" });
  });

  it("returns a safe 404 when the order does not exist", async () => {
    mocks.queues.select.push([]);
    const { POST } = await import("@/app/api/delivery-notes/route");

    const response = await POST(request("POST", { customerId: "customer_1", salesOrderId: "missing", issuedAt: "2026-04-02" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ message: "Pedido no encontrado." });
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });
});

describe("stock movements", () => {
  it("audits manual stock movements inside the movement transaction", async () => {
    mocks.dbQueues.select.push([{ id: "item_1" }], [{ id: "warehouse_1" }]);
    mocks.queues.select.push([]);
    mocks.queues.insert.push([{ id: "movement_1" }]);
    const { POST } = await import("@/app/api/stock-movements/route");

    const response = await POST(
      request("POST", {
        itemId: "item_1",
        warehouseId: "warehouse_1",
        movementType: "IN",
        quantity: 5,
        movedAt: "2026-04-02",
        reason: "Recuento",
        reference: "REF-1",
      }),
    );

    expect(response.status).toBe(201);
    expectAudit("stockMovement.create", { entityName: "stockMovement", entityId: "movement_1", actorUserId: "user_1" });
  });
});

describe("payment methods", () => {
  it("audits create, update and delete inside the transaction", async () => {
    const collection = await import("@/app/api/payment-methods/route");
    const single = await import("@/app/api/payment-methods/[id]/route");
    const payload = { code: "CASH", name: "Efectivo", type: "CASH" };

    mocks.queues.insert.push([{ id: "pm_1", code: "CASH", name: "Efectivo", type: "CASH", isDefault: false }]);
    expect((await collection.POST(request("POST", payload))).status).toBe(201);
    expectAudit("paymentMethod.create", { entityName: "paymentMethod", entityId: "pm_1" });

    mocks.dbQueues.select.push([{ id: "pm_1" }]);
    mocks.queues.update.push([{ id: "pm_1", code: "CASH", name: "Caja", type: "CASH", isDefault: false }]);
    expect((await single.PATCH(request("PATCH", { ...payload, name: "Caja" }), params("pm_1"))).status).toBe(200);
    expectAudit("paymentMethod.update", { entityId: "pm_1" });

    mocks.queues.delete.push([{ id: "pm_1", name: "Caja" }]);
    expect((await single.DELETE(request("DELETE"), params("pm_1"))).status).toBe(200);
    expectAudit("paymentMethod.delete", { entityId: "pm_1" });
  });
});

describe("items", () => {
  it("audits create, update and archive inside the transaction", async () => {
    const collection = await import("@/app/api/items/route");
    const single = await import("@/app/api/items/[id]/route");
    const payload = { name: "Tornillo", sku: "TOR-1", isService: false, salePrice: 1, costPrice: 0.5, minimumStock: 10 };

    mocks.queues.insert.push([{ id: "item_1" }]);
    expect((await collection.POST(request("POST", payload))).status).toBe(201);
    expectAudit("item.create", { entityName: "item", entityId: "item_1" });

    mocks.queues.update.push([{ id: "item_1" }]);
    expect((await single.PATCH(request("PATCH", payload), params("item_1"))).status).toBe(200);
    expectAudit("item.update", { entityId: "item_1" });

    mocks.queues.update.push([{ id: "item_1", name: "Tornillo", sku: "TOR-1" }]);
    expect((await single.DELETE(request("DELETE"), params("item_1"))).status).toBe(200);
    expectAudit("item.archive", { entityId: "item_1" });
  });
});

describe("warehouses", () => {
  it("audits create, update and archive inside the transaction", async () => {
    const collection = await import("@/app/api/warehouses/route");
    const single = await import("@/app/api/warehouses/[id]/route");

    mocks.queues.insert.push([{ id: "wh_1" }]);
    expect((await collection.POST(request("POST", { name: "Central", code: "CEN" }))).status).toBe(201);
    expectAudit("warehouse.create", { entityName: "warehouse", entityId: "wh_1" });

    mocks.queues.update.push([{ id: "wh_1" }]);
    expect((await single.PATCH(request("PATCH", { name: "Central 2", code: "CEN" }), params("wh_1"))).status).toBe(200);
    expectAudit("warehouse.update", { entityId: "wh_1" });

    mocks.queues.update.push([{ id: "wh_1", name: "Central 2", code: "CEN" }]);
    expect((await single.DELETE(request("DELETE"), params("wh_1"))).status).toBe(200);
    expectAudit("warehouse.archive", { entityId: "wh_1" });
  });

  it("does not audit when the warehouse is missing", async () => {
    const single = await import("@/app/api/warehouses/[id]/route");
    mocks.queues.update.push([]);

    expect((await single.DELETE(request("DELETE"), params("missing"))).status).toBe(404);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });
});
