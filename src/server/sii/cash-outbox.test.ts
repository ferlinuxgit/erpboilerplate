import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Criterio de caja (clave 07, libros de cobros y de pagos) y libro de bienes de inversión en la
 * bandeja de salida del SII, contra Postgres real (PGlite en memoria) y un transporte falso.
 * Nunca se llama a la AEAT.
 */

const state = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: null as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: null as any,
}));

vi.mock("@/lib/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/db/schema");
  state.client = new PGlite();
  state.db = drizzle(state.client, { schema });
  return { db: state.db };
});

import * as schema from "@/db/schema";
import { company, companySettings, customer, invoice, invoiceLine, invoiceLineTax, invoicePayment, partner, payment, paymentMethod, siiRecord, siiSettings, supplierInvoice, supplierInvoiceLine, supplierInvoicePayment, supplierPayment, tenant, user } from "@/db/schema";
import { detectSiiRecords } from "@/server/sii/outbox";
import { processPendingSiiRecords } from "@/server/sii/sender";
import { getSiiOverview } from "@/server/sii/service";
import { siiXsdValidator } from "@/server/sii/test-fixtures/xsd-validator";
import type { SiiTransport } from "@/server/sii/transport";

vi.setConfig({ testTimeout: 120_000 });

const COMPANY = "company-caja";
const validator = siiXsdValidator();
const year = new Date().getUTCFullYear();
const day = (month: number, date: number, y = year) => new Date(Date.UTC(y, month - 1, date, 10));
const env = { SII_ENVIRONMENT: "test" };

type Row = typeof siiRecord.$inferSelect;
const records = (book?: string): Promise<Row[]> => state.db.select().from(siiRecord).where(and(eq(siiRecord.companyId, COMPANY), ...(book ? [eq(siiRecord.book, book)] : []))).orderBy(asc(siiRecord.createdAt), asc(siiRecord.id));
const bodyOf = (envelope: string) => /<soapenv:Body>\s*([\s\S]*?)\s*<\/soapenv:Body>/.exec(envelope)![1];

/**
 * Respuesta «todo correcto». Las facturas y los bienes se identifican por su RefExterna; los
 * cobros y pagos no la llevan y la AEAT devuelve la factura (número y fecha).
 */
function acceptAll(xml: string) {
  const refs = [...xml.matchAll(/<(?:sii|siiLR):RefExterna>([^<]+)</g)].map((match) => `<siiR:RespuestaLinea><siiR:RefExterna>${match[1]}</siiR:RefExterna><siiR:EstadoRegistro>Correcto</siiR:EstadoRegistro></siiR:RespuestaLinea>`);
  const invoices = refs.length > 0 ? [] : [...xml.matchAll(/<sii:NumSerieFacturaEmisor>([^<]+)<\/sii:NumSerieFacturaEmisor>\s*<sii:FechaExpedicionFacturaEmisor>([^<]+)</g)]
    .map((match) => `<siiR:RespuestaLinea><siiR:IDFactura><sii:NumSerieFacturaEmisor>${match[1]}</sii:NumSerieFacturaEmisor><sii:FechaExpedicionFacturaEmisor>${match[2]}</sii:FechaExpedicionFacturaEmisor></siiR:IDFactura><siiR:EstadoRegistro>Correcto</siiR:EstadoRegistro></siiR:RespuestaLinea>`);
  return `<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body><siiR:Respuesta xmlns:siiR="r" xmlns:sii="s"><siiR:CSV>GLOBAL</siiR:CSV><siiR:EstadoEnvio>Correcto</siiR:EstadoEnvio>${[...refs, ...invoices].join("")}</siiR:Respuesta></env:Body></env:Envelope>`;
}

function fakeTransport(): SiiTransport & { sent: Array<{ xml: string; book: string }> } {
  const sent: Array<{ xml: string; book: string }> = [];
  return {
    kind: "fake",
    environment: "test",
    requiresCredentials: false,
    sent,
    async send(xml, target) {
      sent.push({ xml, book: target.book });
      return { httpStatus: 200, body: acceptAll(xml) };
    },
  };
}

async function sendAll() {
  const transport = fakeTransport();
  await processPendingSiiRecords({ transport, companyId: COMPANY });
  for (const sent of transport.sent) expect(validator.validate(bodyOf(sent.xml))).toEqual([]);
  return transport.sent;
}

beforeAll(async () => {
  vi.stubEnv("SII_ENVIRONMENT", "test");
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);

  await state.db.insert(user).values({ id: "user-1", name: "Ana", email: "ana@example.com" });
  await state.db.insert(tenant).values({ id: "tenant-1", name: "T", slug: "t", ownerId: "user-1" });
  await state.db.insert(company).values({ id: COMPANY, tenantId: "tenant-1", name: "Caja", legalName: "Empresa Caja SL", vatNumber: "B12345674", postalCode: "28001" });
  await state.db.insert(companySettings).values({ companyId: COMPANY, siiEnabled: true, fiscalRegime: "cash_accounting", vatProrataFinal: { [String(year)]: "80" } });
  await state.db.insert(partner).values([
    { id: "partner-c", companyId: COMPANY, number: "C1", name: "Cliente SA", taxId: "A58818501", countryCode: "ES" },
    { id: "supplier-1", companyId: COMPANY, number: "P1", type: "SUPPLIER", name: "Proveedor SL", taxId: "B85121501", countryCode: "ES" },
  ]);
  await state.db.insert(customer).values({ id: "customer-1", companyId: COMPANY, partnerId: "partner-c", name: "Cliente SA" });
  await state.db.insert(paymentMethod).values({ id: "pm-transfer", companyId: COMPANY, code: "TR", name: "Transferencia", type: "BANK_TRANSFER", bankAccountNumber: "ES91 2100 0418 4502 0005 1332" });

  await state.db.insert(invoice).values({
    id: "inv-1",
    companyId: COMPANY,
    customerId: "customer-1",
    number: "FA-0001",
    issueDate: day(2, 10),
    issuedAt: day(2, 10),
    totalAmount: "121.00",
    status: "SENT",
    vatTreatment: "DOMESTIC",
    customerSnapshot: { name: "Cliente SA", taxId: "A58818501", address: null, addressLine2: null, postalCode: null, city: null, province: null, countryCode: "ES" },
  });
  await state.db.insert(invoiceLine).values({ id: "inv-1-l1", invoiceId: "inv-1", description: "Servicio", quantity: "1", unitPrice: "100.00", taxRate: "21", lineTotal: "121.00" });
  await state.db.insert(invoiceLineTax).values({ invoiceLineId: "inv-1-l1", name: "IVA 21 %", rate: "21", kind: "VAT", operation: "ADD", baseAmount: "100.00", amount: "21.00" });
  await state.db.insert(payment).values({ id: "pay-1", companyId: COMPANY, number: "CO-1", invoiceId: "inv-1", amount: "100.00", postedAt: day(3, 2), paymentMethodId: "pm-transfer" });
  await state.db.insert(invoicePayment).values({ id: "ip-1", companyId: COMPANY, invoiceId: "inv-1", paymentId: "pay-1", amountApplied: "100.00" });

  // Factura de compra con un bien de inversión (base 5.000 €), pagada en parte.
  await state.db.insert(supplierInvoice).values({
    id: "sup-1",
    companyId: COMPANY,
    supplierPartnerId: "supplier-1",
    number: "FR-0001",
    supplierDocumentNumber: "A/77",
    issueDate: day(2, 14),
    accountingDate: day(2, 15),
    status: "POSTED",
    subtotalAmount: "5000.00",
    taxAmount: "1050.00",
    totalAmount: "6050.00",
    vatTreatment: "DOMESTIC",
    prorrataPct: "80",
  });
  await state.db.insert(supplierInvoiceLine).values({ id: "sup-1-l1", supplierInvoiceId: "sup-1", description: "Torno CNC", quantity: "1", unitPrice: "5000.00", taxRate: "21", subtotalAmount: "5000.00", taxAmount: "1050.00", lineTotal: "6050.00", isInvestmentGood: true });
  await state.db.insert(supplierPayment).values({ id: "spay-1", companyId: COMPANY, number: "PA-1", supplierPartnerId: "supplier-1", amount: "2000.00", postedAt: day(3, 5), paymentMethodId: "pm-transfer" });
  await state.db.insert(supplierInvoicePayment).values({ id: "sip-1", companyId: COMPANY, supplierInvoiceId: "sup-1", supplierPaymentId: "spay-1", amountApplied: "2000.00" });
}, 120_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await state.client?.close();
});

describe("criterio de caja y bienes de inversión en el SII", () => {
  it("las facturas llevan la clave 07; los cobros y pagos esperan a que la factura conste en el SII", async () => {
    await detectSiiRecords(COMPANY, { env });
    const [settings] = await state.db.select().from(siiSettings).where(eq(siiSettings.companyId, COMPANY));
    expect(settings.cashAccountingSince).toEqual(settings.since);

    const rows = await records();
    expect(rows.map((row) => [row.book, row.operation, row.invoiceNumber, row.totalAmount]).sort()).toEqual([
      ["INVESTMENT_GOODS", "A0", "A/77", null],
      ["ISSUED", "A0", "FA-0001", "121.00"],
      ["ISSUED_COLLECTIONS", "A0", "FA-0001", "100.00"],
      ["RECEIVED", "A0", "A/77", "6050.00"],
      ["RECEIVED_PAYMENTS", "A0", "A/77", "2000.00"],
    ]);
    const collection = rows.find((row) => row.book === "ISSUED_COLLECTIONS")!;
    expect(collection).toMatchObject({ sourceId: "ip-1", fiscalYear: String(year), period: "03" });
    expect(collection.blockedReason).toMatch(/todavía no consta en el SII/);
    expect(collection.dueDate).toMatch(new RegExp(`^${year}-03-0[6-9]$`));
    const good = rows.find((row) => row.book === "INVESTMENT_GOODS")!;
    expect(good).toMatchObject({ fiscalYear: String(year), period: "0A", sourceId: `sup-1-l1:${year}`, blockedReason: null });
    expect(good.dueDate).toMatch(new RegExp(`^${year + 1}-0[12]-`));

    const sent = await sendAll();
    expect(sent.map((entry) => entry.book).sort()).toEqual(["INVESTMENT_GOODS", "ISSUED", "RECEIVED"]);
    expect(sent.find((entry) => entry.book === "ISSUED")!.xml).toContain("<sii:ClaveRegimenEspecialOTrascendencia>07</sii:ClaveRegimenEspecialOTrascendencia>");
    expect(sent.find((entry) => entry.book === "RECEIVED")!.xml).toContain("<sii:ClaveRegimenEspecialOTrascendencia>07</sii:ClaveRegimenEspecialOTrascendencia>");
    expect(sent.find((entry) => entry.book === "INVESTMENT_GOODS")!.xml).toContain("<sii:ProrrataAnualDefinitiva>80.00</sii:ProrrataAnualDefinitiva>");
  });

  it("aceptada la factura, salen sus cobros y pagos en su propio libro", async () => {
    const summary = await detectSiiRecords(COMPANY, { env });
    expect(summary.updated).toBe(2);
    const sent = await sendAll();
    expect(sent.map((entry) => entry.book).sort()).toEqual(["ISSUED_COLLECTIONS", "RECEIVED_PAYMENTS"]);
    const collections = sent.find((entry) => entry.book === "ISSUED_COLLECTIONS")!.xml;
    expect(collections).toContain("<siiLR:SuministroLRCobrosEmitidas");
    expect(collections).toMatch(/<sii:Cobro>\s*<sii:Fecha>02-03-\d{4}<\/sii:Fecha>\s*<sii:Importe>100.00<\/sii:Importe>\s*<sii:Medio>01<\/sii:Medio>\s*<sii:Cuenta_O_Medio>ES9121000418450200051332</);
    // El pago al proveedor no lleva la cuenta (la de la forma de pago es la de la empresa).
    expect(sent.find((entry) => entry.book === "RECEIVED_PAYMENTS")!.xml).toMatch(/<sii:Pago>\s*<sii:Fecha>05-03-\d{4}<\/sii:Fecha>\s*<sii:Importe>2000.00<\/sii:Importe>\s*<sii:Medio>01<\/sii:Medio>\s*<\/sii:Pago>/);
    expect((await records()).every((row) => row.status === "ACCEPTED")).toBe(true);
    expect(await detectSiiRecords(COMPANY, { env })).toMatchObject({ created: 0, updated: 0, cancelled: 0 });
  });

  it("un cobro cambiado se corrige (anulación en negativo más el nuevo) y uno borrado se anula", async () => {
    await state.db.update(payment).set({ postedAt: day(3, 4) }).where(eq(payment.id, "pay-1"));
    expect(await detectSiiRecords(COMPANY, { env })).toMatchObject({ created: 1 });
    let sent = await sendAll();
    expect(sent).toHaveLength(1);
    expect(sent[0].xml).toMatch(/<sii:Fecha>02-03-\d{4}<\/sii:Fecha>\s*<sii:Importe>-100.00<\/sii:Importe>[\s\S]*<sii:Fecha>04-03-\d{4}<\/sii:Fecha>\s*<sii:Importe>100.00<\/sii:Importe>/);

    await state.db.delete(invoicePayment).where(eq(invoicePayment.id, "ip-1"));
    expect(await detectSiiRecords(COMPANY, { env })).toMatchObject({ cancelled: 1 });
    sent = await sendAll();
    expect(sent[0].xml).toMatch(/<sii:Fecha>04-03-\d{4}<\/sii:Fecha>\s*<sii:Importe>-100.00<\/sii:Importe>/);
    expect(sent[0].xml).not.toMatch(/<sii:Importe>100.00</);
    const history = (await records("ISSUED_COLLECTIONS")).map((row) => `${row.operation}:${row.status}:${row.totalAmount}`);
    expect(history).toEqual(["A0:ACCEPTED:100.00", "A1:ACCEPTED:0.00", "BAJA:ACCEPTED:-100.00"]);
    // Ya anulado: nada más que hacer.
    expect(await detectSiiRecords(COMPANY, { env })).toMatchObject({ created: 0, updated: 0, cancelled: 0 });
  });

  it("sin prorrata definitiva no hay libro de bienes de inversión: lo pendiente se descarta", async () => {
    await state.db.update(companySettings).set({ vatProrataFinal: { [String(year)]: "60" } }).where(eq(companySettings.companyId, COMPANY));
    expect(await detectSiiRecords(COMPANY, { env })).toMatchObject({ created: 1 });
    expect((await records("INVESTMENT_GOODS")).map((row) => `${row.operation}:${row.status}`)).toEqual(["A0:ACCEPTED", "A1:PENDING"]);
    await state.db.update(companySettings).set({ vatProrataFinal: {} }).where(eq(companySettings.companyId, COMPANY));
    expect(await detectSiiRecords(COMPANY, { env })).toMatchObject({ discarded: 1 });
    expect((await records("INVESTMENT_GOODS")).map((row) => `${row.operation}:${row.status}`)).toEqual(["A0:ACCEPTED"]);
  });

  it("la pantalla separa el estado de cada libro", async () => {
    const overview = await getSiiOverview(COMPANY);
    expect(overview.cashAccounting).toMatchObject({ active: true });
    const books = Object.fromEntries(overview.books.map((book) => [book.book, book.counts]));
    expect(books.ISSUED_COLLECTIONS).toEqual({ ACCEPTED: 1 });
    expect(books.RECEIVED_PAYMENTS).toEqual({ ACCEPTED: 1 });
    expect(books.INVESTMENT_GOODS).toEqual({ ACCEPTED: 1 });
  });
});
