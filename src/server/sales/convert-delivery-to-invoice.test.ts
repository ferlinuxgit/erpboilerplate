import { getTableName, type Table } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Albarán → factura por el flujo único de emisión (`issueInvoiceInTransaction`), con una base de
 * datos en memoria mínima: se extraen los parámetros de las condiciones `where` para filtrar filas.
 */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  tables: new Map<string, Row[]>(),
  recordAudit: vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined),
  postSalesInvoice: vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined),
  postCreditNote: vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined),
  reserveSeriesNumber: vi.fn(async () => "FAC-000007"),
  assertFiscalPeriodOpen: vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined),
  registerIssuedInvoiceRecord: vi.fn<(...args: unknown[]) => Promise<{ id: string; hash: string }>>(async () => ({ id: "vf-1", hash: "abc" })),
  customerSnapshot: { name: "Cliente S.L.", taxId: "B12345674", address: "Calle 2", addressLine2: null, postalCode: "28002", city: "Madrid", province: "Madrid", countryCode: "ES" },
  db: null as unknown,
}));

function sqlParams(expression: unknown): unknown[] {
  const seen = new Set<unknown>();
  const out: unknown[] = [];
  const walk = (value: unknown) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const record = value as Record<string, unknown> & { constructor?: { name?: string } };
    if (record.constructor?.name === "Param") {
      const paramValue = record.value;
      if (Array.isArray(paramValue)) out.push(...paramValue);
      else out.push(paramValue);
    }
    for (const key of Object.keys(record)) {
      if (key === "table" || key === "config") continue;
      walk(record[key]);
    }
  };
  walk(expression);
  return out;
}

function rows(table: string) {
  const existing = mocks.tables.get(table);
  if (existing) return existing;
  const created: Row[] = [];
  mocks.tables.set(table, created);
  return created;
}

function cents(value: unknown) {
  return Math.round(Number(value) * 100);
}

function resolveSelect(table: string, fields: Row | undefined, where: unknown): Row[] {
  const params = sqlParams(where);
  const has = (value: unknown) => value !== undefined && value !== null && params.includes(value);
  switch (table) {
    case "delivery_note":
      return rows(table).filter((row) => has(row.id) || has(row.salesOrderId));
    case "sales_order":
      return rows(table).filter((row) => has(row.id));
    case "delivery_note_line":
      return rows(table).filter((row) => has(row.deliveryNoteId));
    case "sales_order_line":
      return rows(table).filter((row) => has(row.salesOrderId));
    case "tax":
    case "company_settings":
      return rows(table).filter((row) => has(row.companyId));
    case "payment_method":
      return fields && Object.keys(fields).length === 1 && params.includes(true)
        ? rows(table).filter((row) => has(row.companyId) && row.isDefault)
        : rows(table).filter((row) => has(row.id));
    case "invoice": {
      if (fields && "amount" in fields) {
        const credited = rows("invoice").filter((row) => has(row.rectifiedInvoiceId) && row.invoiceType === "CREDIT_NOTE" && row.issuedAt);
        return [{ amount: (credited.reduce((sum, row) => sum + cents(row.totalAmount), 0) / 100).toFixed(2) }];
      }
      return rows(table).filter((row) => has(row.id) || has(row.deliveryNoteId));
    }
    case "invoice_payment":
      return [{ amount: "0.00" }];
    case "invoice_line":
      return rows(table).filter((row) => has(row.invoiceId));
    case "invoice_line_tax":
      return rows(table).filter((row) => has(row.invoiceLineId));
    case "customer":
      return rows(table).filter((row) => has(row.id));
    default:
      return [];
  }
}

function createFakeDb() {
  const client = {
    select: (fields?: Row) => {
      let table = "";
      let where: unknown = null;
      const builder = {
        from: (value: Table) => { table = getTableName(value); return builder; },
        where: (value: unknown) => { where = value; return builder; },
        leftJoin: () => builder,
        innerJoin: () => builder,
        orderBy: () => builder,
        for: () => builder,
        groupBy: () => builder,
        limit: async () => resolveSelect(table, fields, where),
        then: (resolve: (value: Row[]) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(resolveSelect(table, fields, where)).then(resolve, reject),
      };
      return builder;
    },
    insert: (value: Table) => {
      const table = getTableName(value);
      return {
        values: (input: Row | Row[]) => {
          const inserted = (Array.isArray(input) ? input : [input]).map((entry) => ({
            ...(table === "invoice" ? { invoiceType: "INVOICE", issuedAt: null, paymentStatus: "PENDING", rectifiedInvoiceId: null } : {}),
            id: entry.id ?? `${table}-${rows(table).length + 1}`,
            ...entry,
          }));
          rows(table).push(...inserted);
          return Object.assign(Promise.resolve(inserted), { returning: async () => inserted });
        },
      };
    },
    update: (value: Table) => {
      const table = getTableName(value);
      return {
        set: (patch: Row) => ({
          where: (where: unknown) => {
            const params = sqlParams(where);
            const updated = rows(table).filter((row) => params.includes(row.id));
            for (const row of updated) Object.assign(row, patch);
            return Object.assign(Promise.resolve(updated), { returning: async () => updated });
          },
        }),
      };
    },
    delete: (value: Table) => {
      const table = getTableName(value);
      return {
        where: async (where: unknown) => {
          const params = sqlParams(where);
          mocks.tables.set(table, rows(table).filter((row) => !params.includes(row.invoiceId) && !params.includes(row.id)));
        },
      };
    },
    transaction: async <T,>(callback: (tx: unknown) => Promise<T>) => callback(client),
  };
  return client;
}

vi.mock("@/lib/db", () => {
  mocks.db = createFakeDb();
  return { db: mocks.db };
});
vi.mock("@/server/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/server/accounting/auto-post", () => ({ postSalesInvoice: mocks.postSalesInvoice, postCreditNote: mocks.postCreditNote }));
vi.mock("@/server/documents/series", () => ({ reserveSeriesNumber: mocks.reserveSeriesNumber }));
vi.mock("@/server/fiscal/locks", () => ({ assertFiscalPeriodOpen: mocks.assertFiscalPeriodOpen }));
vi.mock("@/server/company/defaults", () => ({ getCompanyDefaultsStatus: vi.fn(async () => ({ ready: true, groups: [] })) }));
vi.mock("@/server/seeds/apply", () => ({ applyCompanyTemplate: vi.fn(async () => undefined) }));
vi.mock("@/server/inventory/stock-location", () => ({ refreshStockLocation: vi.fn(async () => undefined) }));
vi.mock("@/server/inventory/ownership", () => ({ assertItemsBelongToCompany: vi.fn(async () => undefined) }));
vi.mock("@/server/verifactu/hooks", () => ({
  registerIssuedInvoiceRecord: mocks.registerIssuedInvoiceRecord,
  registerInvoiceAnnulmentRecord: vi.fn(async () => null),
}));
vi.mock("@/server/invoices/snapshot", () => ({
  loadIssuerSnapshot: vi.fn(async () => ({ name: "Empresa S.L.", taxId: "B00000000", address: "Calle 1", addressLine2: null, postalCode: "28001", city: "Madrid", province: "Madrid", countryCode: "ES" })),
  loadCustomerSnapshot: vi.fn(async () => mocks.customerSnapshot),
}));

import { convertDeliveryToInvoice, mapSalesLineTaxes } from "@/server/sales/service";

const actor = {
  tenantId: "tenant-1",
  companyId: "company-1",
  actorUserId: "user-1",
  countryCode: "ES",
  activeFiscalYearId: "fy-1",
};

const VAT_21 = "tax-vat-21";
const VAT_10 = "tax-vat-10";
const IRPF_15 = "tax-irpf-15";

function seed(options: { customerTerms?: number | null; customerTreatment?: string | null } = {}) {
  mocks.tables.clear();
  rows("customer").push({
    id: "customer-1",
    companyId: "company-1",
    status: "ACTIVE",
    countryCode: "ES",
    paymentTermsDays: options.customerTerms ?? null,
    paymentMethodId: null,
    defaultVatTreatment: options.customerTreatment ?? null,
    defaultRetentionRate: null,
    equivalenceSurcharge: false,
  });
  rows("company_settings").push({ companyId: "company-1", paymentTermsDays: 30 });
  rows("payment_method").push({ id: "pm-1", companyId: "company-1", name: "Transferencia", type: "BANK_TRANSFER", bankAccountNumber: "ES12", isDefault: true });
  rows("tax").push(
    { id: VAT_21, companyId: "company-1", name: "IVA general 21%", rate: "21.000", kind: "VAT", operation: "ADD", isDefault: false, isActive: true },
    { id: VAT_10, companyId: "company-1", name: "IVA reducido 10%", rate: "10.000", kind: "VAT", operation: "ADD", isDefault: false, isActive: true },
    { id: IRPF_15, companyId: "company-1", name: "IRPF 15%", rate: "15.000", kind: "WITHHOLDING", operation: "SUBTRACT", isDefault: false, isActive: true },
  );
  rows("sales_order").push({ id: "order-1", companyId: "company-1", customerId: "customer-1", number: "PED-1", salesQuoteId: null, status: "DELIVERED" });
  rows("sales_order_line").push(
    { id: "ol-1", salesOrderId: "order-1", itemId: "item-1", description: "Widget", quantity: "2.000", unitPrice: "100.00", discountPct: "10.000", taxRate: "21.000", retentionRate: "0.000" },
    { id: "ol-2", salesOrderId: "order-1", itemId: "item-2", description: "Servicio", quantity: "1.000", unitPrice: "30.00", discountPct: "0.000", taxRate: "10.000", retentionRate: "15.000" },
  );
  rows("delivery_note").push({ id: "delivery-1", companyId: "company-1", customerId: "customer-1", salesOrderId: "order-1", number: "ALB-1", status: "DELIVERED" });
  rows("delivery_note_line").push(
    { id: "dl-1", deliveryNoteId: "delivery-1", salesOrderLineId: "ol-1", itemId: "item-1", description: "Widget", quantity: "1.500" },
    { id: "dl-2", deliveryNoteId: "delivery-1", salesOrderLineId: "ol-2", itemId: "item-2", description: "Servicio", quantity: "1.000" },
  );
}

beforeEach(() => {
  seed();
  vi.clearAllMocks();
  mocks.customerSnapshot = { ...mocks.customerSnapshot, countryCode: "ES", taxId: "B12345674" };
});

describe("convertDeliveryToInvoice (flujo único de emisión)", () => {
  it("emite con número de la serie, snapshot, asiento, VERI*FACTU, vencimiento y formas de pago del cliente", async () => {
    const created = await convertDeliveryToInvoice({ ...actor, deliveryNoteId: "delivery-1" });

    expect(created).toMatchObject({ number: "FAC-000007", status: "SENT", alreadyInvoiced: false });
    const stored = rows("invoice").find((row) => row.id === created.id)!;
    // 1,5 × 100 × 0,9 = 135 (+21 % = 28,35) + 30 (+10 % = 3 − 15 % IRPF = 4,50) = 191,85
    expect(stored).toMatchObject({ totalAmount: "191.85", status: "SENT", deliveryNoteId: "delivery-1", salesOrderId: "order-1", vatTreatment: "DOMESTIC", paymentMethodId: "pm-1" });
    expect(stored.issuedAt).toBeInstanceOf(Date);
    expect(stored.customerSnapshot).toMatchObject({ name: "Cliente S.L." });
    // Vencimiento: emisión + 30 días (plazo de la empresa, el cliente no tiene).
    const days = ((stored.dueDate as Date).getTime() - (stored.issueDate as Date).getTime()) / 86_400_000;
    expect(days).toBe(30);
    expect(mocks.reserveSeriesNumber).toHaveBeenCalledWith(mocks.db, expect.objectContaining({ type: "SALES_INVOICE" }));
    expect(mocks.postSalesInvoice).toHaveBeenCalledWith(expect.objectContaining({ subtotal: 165, taxAmount: 31.35, retentionAmount: 4.5, totalAmount: 191.85, reference: "Factura FAC-000007" }));
    expect(mocks.registerIssuedInvoiceRecord).toHaveBeenCalledWith(mocks.db, expect.objectContaining({ number: "FAC-000007", vatTreatment: "DOMESTIC" }));
    // Impuestos congelados como impuestos configurados de la empresa.
    expect(rows("invoice_line_tax").map((row) => row.taxId)).toEqual([VAT_21, VAT_10, IRPF_15]);
    expect(rows("invoice_payment_method")).toHaveLength(1);
    expect(rows("delivery_note")[0]?.status).toBe("INVOICED");
    expect(rows("sales_order")[0]?.status).toBe("INVOICED");
    const actions = mocks.recordAudit.mock.calls.map((call) => (call[0] as { action: string }).action);
    expect(actions).toEqual(["invoice.create", "invoice.issue", "sales.delivery.invoice"]);
  });

  it("usa los días de pago del cliente", async () => {
    seed({ customerTerms: 60 });
    const created = await convertDeliveryToInvoice({ ...actor, deliveryNoteId: "delivery-1" });
    const stored = rows("invoice").find((row) => row.id === created.id)!;
    expect(((stored.dueDate as Date).getTime() - (stored.issueDate as Date).getTime()) / 86_400_000).toBe(60);
  });

  it("valida el tratamiento de IVA: cliente intracomunitario con IVA en las líneas → 422 y nada queda facturado", async () => {
    seed({ customerTreatment: "INTRA_EU" });
    await expect(convertDeliveryToInvoice({ ...actor, deliveryNoteId: "delivery-1" })).rejects.toMatchObject({ status: 422 });
    expect(mocks.postSalesInvoice).not.toHaveBeenCalled();
    expect(mocks.registerIssuedInvoiceRecord).not.toHaveBeenCalled();
  });

  it("es idempotente: un albarán ya facturado devuelve su factura sin volver a emitir", async () => {
    const first = await convertDeliveryToInvoice({ ...actor, deliveryNoteId: "delivery-1" });
    vi.clearAllMocks();
    const again = await convertDeliveryToInvoice({ ...actor, deliveryNoteId: "delivery-1" });
    expect(again).toMatchObject({ id: first.id, number: "FAC-000007", alreadyInvoiced: true });
    expect(mocks.reserveSeriesNumber).not.toHaveBeenCalled();
    expect(mocks.postSalesInvoice).not.toHaveBeenCalled();
  });

  it("rechaza albaranes sin pedido de origen", async () => {
    rows("delivery_note")[0]!.salesOrderId = null;
    await expect(convertDeliveryToInvoice({ ...actor, deliveryNoteId: "delivery-1" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("mapSalesLineTaxes", () => {
  const taxes = [
    { id: VAT_21, name: "IVA general", rate: "21.000", kind: "VAT", operation: "ADD", isDefault: false, isActive: true },
    { id: IRPF_15, name: "IRPF 15%", rate: "15.000", kind: "WITHHOLDING", operation: "SUBTRACT", isDefault: false, isActive: true },
  ];

  it("convierte tipos guardados en los impuestos configurados de la empresa", () => {
    expect(mapSalesLineTaxes({ taxRate: 21, retentionRate: 15 }, taxes)).toEqual([
      expect.objectContaining({ id: VAT_21, rate: 21, kind: "VAT", operation: "ADD" }),
      expect.objectContaining({ id: IRPF_15, rate: 15, kind: "WITHHOLDING", operation: "SUBTRACT" }),
    ]);
  });

  it("congela un impuesto equivalente si la empresa no tiene ese tipo", () => {
    expect(mapSalesLineTaxes({ taxRate: 4, retentionRate: 7 }, taxes)).toEqual([
      { id: null, name: "IVA 4 %", rate: 4, kind: "VAT", operation: "ADD" },
      { id: null, name: "Retención IRPF 7 %", rate: 7, kind: "WITHHOLDING", operation: "SUBTRACT" },
    ]);
    expect(mapSalesLineTaxes({ taxRate: 0, retentionRate: 0 }, taxes)).toEqual([]);
  });
});
