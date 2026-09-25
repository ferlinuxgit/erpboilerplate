import { getTableName, type Table } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests del ciclo de vida de facturas con una base de datos en memoria mínima: las condiciones
 * `where` de Drizzle se inspeccionan para extraer los ids (parámetros) y filtrar filas.
 */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  const state = {
    tables: new Map<string, Row[]>(),
  };
  return {
    state,
    recordAudit: vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined),
    postSalesInvoice: vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined),
    postCreditNote: vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined),
    reserveSeriesNumber: vi.fn(async (_client: unknown, input: { type: string }) => (input.type === "CREDIT_NOTE" ? "R-000001" : "FA000001")),
    assertFiscalPeriodOpen: vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined),
    db: null as unknown,
  };
});

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
  const existing = mocks.state.tables.get(table);
  if (existing) return existing;
  const created: Row[] = [];
  mocks.state.tables.set(table, created);
  return created;
}

const INVOICE_DEFAULTS: Row = {
  status: "DRAFT",
  paymentStatus: "PENDING",
  invoiceType: "INVOICE",
  issuedAt: null,
  vatTreatment: null,
  rectifiedInvoiceId: null,
  rectificationReason: null,
  rectificationType: null,
  rectificationDescription: null,
  issuerSnapshot: null,
  customerSnapshot: null,
  dueDate: null,
  notes: null,
};

function money(cents: number) {
  return (cents / 100).toFixed(2);
}

function resolveSelect(table: string, fields: Row | undefined, where: unknown): Row[] {
  const params = sqlParams(where);
  const has = (value: unknown) => params.includes(value);
  switch (table) {
    case "invoice": {
      if (fields && "amount" in fields) {
        const credited = rows("invoice").filter((row) =>
          has(row.rectifiedInvoiceId) && row.invoiceType === "CREDIT_NOTE" && row.issuedAt && row.status !== "VOID");
        return [{ amount: money(credited.reduce((sum, row) => sum + Math.round(Number(row.totalAmount) * 100), 0)) }];
      }
      return rows("invoice").filter((row) => has(row.id));
    }
    case "invoice_payment": {
      const paid = rows("invoice_payment").filter((row) => has(row.invoiceId));
      return [{ amount: money(paid.reduce((sum, row) => sum + Math.round(Number(row.amountApplied) * 100), 0)) }];
    }
    case "invoice_line":
      return rows("invoice_line").filter((row) => has(row.invoiceId));
    case "invoice_line_tax":
      return rows("invoice_line_tax").filter((row) => has(row.invoiceLineId));
    case "tax":
      return rows("tax").filter((row) => has(row.id));
    case "customer":
      return rows("customer").filter((row) => has(row.id));
    default:
      return rows(table).filter((row) => has(row.id) || has(row.invoiceId));
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
            ...(table === "invoice" ? INVOICE_DEFAULTS : {}),
            id: entry.id ?? `${table}-${rows(table).length + 1}`,
            ...entry,
          }));
          rows(table).push(...inserted);
          const result = Promise.resolve(inserted);
          return Object.assign(result, {
            returning: async () => inserted,
            onConflictDoNothing: () => ({ returning: async () => inserted }),
          });
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
            const result = Promise.resolve(updated);
            return Object.assign(result, { returning: async () => updated });
          },
        }),
      };
    },
    delete: (value: Table) => {
      const table = getTableName(value);
      return {
        where: async (where: unknown) => {
          const params = sqlParams(where);
          const remaining = rows(table).filter((row) => !params.includes(row.invoiceId) && !params.includes(row.id));
          mocks.state.tables.set(table, remaining);
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
vi.mock("@/server/customers/service", () => ({ createCustomerWithPartner: vi.fn() }));
vi.mock("@/server/inventory/ownership", () => ({ assertItemsBelongToCompany: vi.fn(async () => undefined) }));
vi.mock("@/server/invoices/snapshot", () => ({
  loadIssuerSnapshot: vi.fn(async () => ({ name: "Empresa S.L.", legalName: "Empresa S.L.", taxId: "B00000000", address: "Calle 1", addressLine2: null, postalCode: "28001", city: "Madrid", province: "Madrid", countryCode: "ES" })),
  loadCustomerSnapshot: vi.fn(async () => ({ name: "Cliente S.L.", taxId: "B12345674", address: "Calle 2", addressLine2: null, postalCode: "28002", city: "Madrid", province: "Madrid", countryCode: "ES" })),
}));

import { HttpError } from "@/lib/http";
import {
  createCreditNote,
  createInvoice,
  duplicateInvoice,
  issueInvoice,
  updateCreditNoteDraft,
  updateInvoice,
  voidInvoice,
  type InvoiceActor,
} from "@/server/invoices/service";
import { invoiceLifecycle } from "@/server/invoices/lifecycle";

const actor: InvoiceActor = {
  tenantId: "tenant-1",
  companyId: "company-1",
  actorUserId: "user-1",
  countryCode: "ES",
  activeFiscalYearId: "fy-2025",
  canCreateCustomer: true,
};

const VAT_21 = "00000000-0000-4000-8000-000000000021";
const VAT_10 = "00000000-0000-4000-8000-000000000010";

function seed() {
  mocks.state.tables.clear();
  rows("customer").push({ id: "customer-1", companyId: "company-1", status: "ACTIVE", countryCode: "ES" });
  rows("tax").push(
    { id: VAT_21, companyId: "company-1", name: "IVA general", rate: "21.000", kind: "VAT", operation: "ADD", isActive: true },
    { id: VAT_10, companyId: "company-1", name: "IVA reducido", rate: "10.000", kind: "VAT", operation: "ADD", isActive: true },
  );
}

const baseInput = {
  customerId: "customer-1",
  issueDate: "2026-05-09",
  dueDate: "2026-06-09",
  vatTreatment: "DOMESTIC" as const,
  lines: [
    { description: "Consultoría", quantity: 2, unitPrice: 100, taxIds: [VAT_21] },
    { description: "Soporte", quantity: 1.5, unitPrice: 80, taxIds: [VAT_10] },
  ],
};

function invoiceRow(id: string) {
  const row = rows("invoice").find((candidate) => candidate.id === id);
  if (!row) throw new Error(`invoice ${id} not found`);
  return row;
}

function auditActions() {
  return mocks.recordAudit.mock.calls.map((call) => (call[0] as { action: string }).action);
}

beforeEach(() => {
  seed();
  vi.clearAllMocks();
});

describe("createInvoice", () => {
  it("guarda un borrador con número provisional, sin reservar número ni contabilizar", async () => {
    const created = await createInvoice(actor, { ...baseInput, mode: "draft" });

    expect(created.lifecycle).toBe("DRAFT");
    expect(created.number).toMatch(/^BORRADOR-[0-9A-F]{8}$/);
    expect(mocks.reserveSeriesNumber).not.toHaveBeenCalled();
    expect(mocks.postSalesInvoice).not.toHaveBeenCalled();
    expect(invoiceRow(created.id)).toMatchObject({ status: "DRAFT", totalAmount: "374.00", issuedAt: null, vatTreatment: "DOMESTIC" });
    expect(rows("invoice_line")).toHaveLength(2);
    expect(auditActions()).toEqual(["invoice.create"]);
    // Auditoría dentro de la misma transacción (cliente de la transacción como 2º argumento).
    expect(mocks.recordAudit.mock.calls[0]?.[1]).toBe(mocks.db);
  });

  it("emite por defecto: número de la serie por fecha de emisión, snapshot, asiento y auditoría", async () => {
    const created = await createInvoice(actor, baseInput);

    expect(created).toMatchObject({ number: "FA000001", lifecycle: "ISSUED", status: "SENT" });
    const reserveInput = mocks.reserveSeriesNumber.mock.calls[0]?.[1] as { type: string; referenceDate: Date; fiscalYearId?: string };
    expect(reserveInput.type).toBe("SALES_INVOICE");
    expect(reserveInput.referenceDate.toISOString()).toBe("2026-05-09T00:00:00.000Z");
    // Nunca el ejercicio activo de la sesión para facturas.
    expect(reserveInput.fiscalYearId).toBeUndefined();
    const stored = invoiceRow(created.id);
    expect(stored.issuedAt).toBeInstanceOf(Date);
    expect(stored.customerSnapshot).toMatchObject({ name: "Cliente S.L.", taxId: "B12345674" });
    expect(stored.issuerSnapshot).toMatchObject({ name: "Empresa S.L.", taxId: "B00000000" });
    expect(mocks.postSalesInvoice).toHaveBeenCalledWith(expect.objectContaining({ subtotal: 320, taxAmount: 54, totalAmount: 374, retentionAmount: 0, reference: "Factura FA000001" }));
    expect(auditActions()).toEqual(["invoice.create", "invoice.issue"]);
  });

  it("sin vencimiento, al emitir se calcula emisión + días de pago (30 por defecto)", async () => {
    const created = await createInvoice(actor, { ...baseInput, dueDate: "" });
    expect((invoiceRow(created.id).dueDate as Date).toISOString()).toBe("2026-06-08T00:00:00.000Z");
  });

  it("usa los días de pago del cliente al emitir", async () => {
    rows("customer")[0]!.paymentTermsDays = 60;
    const created = await createInvoice(actor, { ...baseInput, dueDate: "" });
    expect((invoiceRow(created.id).dueDate as Date).toISOString()).toBe("2026-07-08T00:00:00.000Z");
  });

  it("un borrador sin vencimiento no lo fija hasta emitirse", async () => {
    const draft = await createInvoice(actor, { ...baseInput, dueDate: "", mode: "draft" });
    expect(invoiceRow(draft.id).dueDate).toBeNull();
  });

  it("rechaza importes cero o negativos en facturas ordinarias", async () => {
    await expect(createInvoice(actor, { ...baseInput, lines: [{ description: "Nada", quantity: 1, unitPrice: 0, taxIds: [] }] })).rejects.toBeInstanceOf(HttpError);
  });

  it("valida el tratamiento de IVA al emitir (intracomunitaria sin IVA)", async () => {
    await expect(createInvoice(actor, { ...baseInput, vatTreatment: "INTRA_EU" })).rejects.toMatchObject({ status: 422 });
    const draft = await createInvoice(actor, { ...baseInput, vatTreatment: "INTRA_EU", mode: "draft" });
    expect(invoiceLifecycle(invoiceRow(draft.id) as { status: string; number: string })).toBe("DRAFT");
  });
});

describe("inmutabilidad y ciclo de vida", () => {
  it("un borrador es totalmente editable y no genera asiento", async () => {
    const draft = await createInvoice(actor, { ...baseInput, mode: "draft" });
    vi.clearAllMocks();

    await updateInvoice(actor, draft.id, {
      issueDate: "2026-05-10",
      lines: [{ description: "Consultoría corregida", quantity: 1, unitPrice: 50, taxIds: [VAT_21] }],
    });

    expect(invoiceRow(draft.id)).toMatchObject({ totalAmount: "60.50" });
    expect(rows("invoice_line").filter((line) => line.invoiceId === draft.id)).toHaveLength(1);
    expect(mocks.postSalesInvoice).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(["invoice.update"]);
  });

  it("una factura emitida solo admite notas y formas de pago", async () => {
    const issued = await createInvoice(actor, baseInput);

    await expect(updateInvoice(actor, issued.id, { lines: baseInput.lines })).rejects.toMatchObject({ status: 409 });
    await expect(updateInvoice(actor, issued.id, { customerId: "customer-1" })).rejects.toMatchObject({ status: 409 });
    await expect(updateInvoice(actor, issued.id, { issueDate: "2026-05-12" })).rejects.toMatchObject({ status: 409 });

    await updateInvoice(actor, issued.id, { notes: "Pagar por transferencia" });
    expect(invoiceRow(issued.id)).toMatchObject({ notes: "Pagar por transferencia", totalAmount: "374.00", number: "FA000001" });
  });

  it("no se puede emitir dos veces", async () => {
    const issued = await createInvoice(actor, baseInput);
    await expect(issueInvoice(actor, issued.id)).rejects.toMatchObject({ status: 409 });
  });

  it("solo se anulan borradores; las emitidas se rectifican", async () => {
    const issued = await createInvoice(actor, baseInput);
    await expect(voidInvoice(actor, issued.id)).rejects.toMatchObject({ status: 409 });

    const draft = await createInvoice(actor, { ...baseInput, mode: "draft" });
    await voidInvoice(actor, draft.id);
    expect(invoiceRow(draft.id)).toMatchObject({ status: "VOID", paymentStatus: "VOID" });
    expect(auditActions()).toContain("invoice.void");
  });

  it("las facturas antiguas numeradas en estado DRAFT se tratan como emitidas", () => {
    expect(invoiceLifecycle({ status: "DRAFT", number: "FA000123", issuedAt: null })).toBe("ISSUED");
    expect(invoiceLifecycle({ status: "DRAFT", number: "BORRADOR-1A2B3C4D", issuedAt: null })).toBe("DRAFT");
    expect(invoiceLifecycle({ status: "VOID", number: "BORRADOR-1A2B3C4D", issuedAt: null })).toBe("VOID");
  });
});

describe("facturas rectificativas", () => {
  it("anulación total: líneas en negativo, serie de rectificativas, asiento inverso y saldo de la original", async () => {
    const original = await createInvoice(actor, baseInput);
    vi.clearAllMocks();

    const creditNote = await createCreditNote(actor, original.id, {
      reason: "R4",
      type: "DIFFERENCES",
      scope: "FULL",
      description: "Factura emitida por error",
      issueDate: "2026-05-20",
    });

    expect(creditNote).toMatchObject({ number: "R-000001", totalAmount: -374, rectifiedInvoiceId: original.id });
    const stored = invoiceRow(creditNote!.id);
    expect(stored).toMatchObject({ invoiceType: "CREDIT_NOTE", rectifiedInvoiceId: original.id, rectificationReason: "R4", rectificationType: "DIFFERENCES", totalAmount: "-374.00", status: "SENT" });
    expect(mocks.reserveSeriesNumber).toHaveBeenCalledWith(mocks.db, expect.objectContaining({ type: "CREDIT_NOTE", createIfMissing: { prefix: "R-" } }));
    expect(mocks.postCreditNote).toHaveBeenCalledWith(expect.objectContaining({ subtotal: -320, taxAmount: -54, totalAmount: -374 }));
    expect(mocks.postSalesInvoice).not.toHaveBeenCalled();
    // Totalmente rectificada y sin cobros: queda cerrada.
    expect(invoiceRow(original.id).paymentStatus).toBe("VOID");
    expect(auditActions()).toEqual(["invoice.create", "invoice.creditNote"]);
  });

  it("parcial: abona solo lo indicado y deja el resto pendiente", async () => {
    const original = await createInvoice(actor, baseInput);

    const creditNote = await createCreditNote(actor, original.id, {
      reason: "R4",
      type: "DIFFERENCES",
      scope: "PARTIAL",
      description: "Devolución de 1 hora",
      lines: [{ description: "Consultoría", quantity: 1, unitPrice: 100, taxIds: [VAT_21] }],
    });

    expect(creditNote?.totalAmount).toBe(-121);
    expect(invoiceRow(original.id).paymentStatus).toBe("PENDING");
  });

  it("no permite abonar más de lo pendiente de rectificar", async () => {
    const original = await createInvoice(actor, baseInput);
    await createCreditNote(actor, original.id, { reason: "R4", type: "DIFFERENCES", scope: "FULL", description: "Anulación" });

    await expect(createCreditNote(actor, original.id, { reason: "R4", type: "DIFFERENCES", scope: "FULL", description: "Otra vez" }))
      .rejects.toMatchObject({ status: 409 });
  });

  it("solo rectifica facturas emitidas", async () => {
    const draft = await createInvoice(actor, { ...baseInput, mode: "draft" });
    await expect(createCreditNote(actor, draft.id, { reason: "R4", type: "DIFFERENCES", scope: "FULL", description: "Error" }))
      .rejects.toMatchObject({ status: 409 });
  });

  it("un borrador de rectificativa se puede editar y emitir", async () => {
    const original = await createInvoice(actor, baseInput);
    const draft = await createCreditNote(actor, original.id, { reason: "R4", type: "DIFFERENCES", scope: "FULL", description: "Anulación", issue: false });
    expect(invoiceRow(draft!.id)).toMatchObject({ status: "DRAFT", totalAmount: "-374.00" });

    const updated = await updateCreditNoteDraft(actor, draft!.id, {
      reason: "R4",
      type: "DIFFERENCES",
      scope: "PARTIAL",
      description: "Devolución de 1 hora",
      lines: [{ description: "Consultoría", quantity: 1, unitPrice: 100, taxIds: [VAT_21] }],
      issue: true,
    });
    expect(updated).toMatchObject({ number: "R-000001", totalAmount: -121 });
    expect(invoiceRow(draft!.id)).toMatchObject({ status: "SENT", rectificationDescription: "Devolución de 1 hora", totalAmount: "-121.00" });
    await expect(updateCreditNoteDraft(actor, draft!.id, { reason: "R4", type: "DIFFERENCES", scope: "FULL", description: "Otra" })).rejects.toMatchObject({ status: 409 });
  });

  it("por sustitución: anula las líneas originales y añade las correctas", async () => {
    const original = await createInvoice(actor, baseInput);
    const creditNote = await createCreditNote(actor, original.id, {
      reason: "R1",
      type: "SUBSTITUTION",
      scope: "FULL",
      description: "Precio corregido",
      lines: [{ description: "Consultoría", quantity: 2, unitPrice: 90, taxIds: [VAT_21] }],
    });
    // −374 (original) + 217,80 (correcta) = −156,20
    expect(creditNote?.totalAmount).toBe(-156.2);
  });
});

describe("duplicateInvoice", () => {
  it("crea un borrador nuevo con las mismas líneas y fecha de hoy", async () => {
    const original = await createInvoice(actor, baseInput);
    vi.clearAllMocks();

    const copy = await duplicateInvoice(actor, original.id, { issueDate: new Date("2026-07-01T00:00:00.000Z") });

    expect(copy?.number).toMatch(/^BORRADOR-/);
    const stored = invoiceRow(copy!.id);
    expect(stored).toMatchObject({ status: "DRAFT", totalAmount: "374.00", customerId: "customer-1", vatTreatment: "DOMESTIC" });
    // Mantiene el plazo de pago (31 días).
    expect((stored.dueDate as Date).toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(mocks.reserveSeriesNumber).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(["invoice.duplicate"]);
  });
});
