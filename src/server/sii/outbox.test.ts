import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Bandeja de salida y envío del SII contra Postgres real (PGlite en memoria) con el esquema
 * completo de Drizzle y un transporte falso. Nunca se llama a la AEAT.
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
import { company, companySettings, customer, invoice, invoiceLine, invoiceLineTax, partner, siiRecord, siiSettings, supplierInvoice, supplierInvoiceLine, tenant, user } from "@/db/schema";
import { detectSiiRecords, isRegisteredInSii, listSiiCompanyIds, planOutboxAction, siiEligibility, type OutboxHistoryEntry } from "@/server/sii/outbox";
import { outcomeForLine, processPendingSiiRecords, retryDelayMs, SII_FAULT_ERROR, SII_TRANSPORT_ERROR } from "@/server/sii/sender";
import { exportSiiRecords, getSiiOverview, resendSiiRecord } from "@/server/sii/service";
import { siiXsdValidator } from "@/server/sii/test-fixtures/xsd-validator";
import type { SiiTransport } from "@/server/sii/transport";

// PGlite en una máquina cargada puede tardar: margen amplio para que la prueba no dependa de eso.
vi.setConfig({ testTimeout: 120_000 });

const COMPANY = "company-sii";
const OTHER = "company-sin-sii";
const validator = siiXsdValidator();
const year = new Date().getUTCFullYear();
const day = (month: number, date: number, y = year) => new Date(Date.UTC(y, month - 1, date, 10));

const entry = (operation: OutboxHistoryEntry["operation"], status: OutboxHistoryEntry["status"], contentHash = "h1", id = `${operation}-${status}`): OutboxHistoryEntry => ({ id, operation, status, contentHash });

describe("planOutboxAction (decisión pura)", () => {
  it("factura sin comunicar → alta; sin cambios → nada", () => {
    expect(planOutboxAction({ live: true, contentHash: "h1", history: [] })).toEqual({ kind: "create", operation: "A0" });
    expect(planOutboxAction({ live: true, contentHash: "h1", history: [entry("A0", "ACCEPTED")] })).toEqual({ kind: "none" });
    expect(planOutboxAction({ live: true, contentHash: "h1", history: [entry("A0", "PENDING")] })).toEqual({ kind: "none" });
  });

  it("cambia el contenido: actualiza lo pendiente o crea una modificación si ya consta", () => {
    expect(planOutboxAction({ live: true, contentHash: "h2", history: [entry("A0", "PENDING")] })).toEqual({ kind: "update", recordId: "A0-PENDING" });
    expect(planOutboxAction({ live: true, contentHash: "h2", history: [entry("A0", "ACCEPTED")] })).toEqual({ kind: "create", operation: "A1" });
    expect(planOutboxAction({ live: true, contentHash: "h2", history: [entry("A0", "ACCEPTED_WITH_ERRORS")] })).toEqual({ kind: "create", operation: "A1" });
  });

  it("rechazada: no insiste sola; si se corrige la factura, vuelve a salir como alta (o modificación si constaba)", () => {
    expect(planOutboxAction({ live: true, contentHash: "h1", history: [entry("A0", "REJECTED")] })).toEqual({ kind: "none" });
    expect(planOutboxAction({ live: true, contentHash: "h2", history: [entry("A0", "REJECTED")] })).toEqual({ kind: "create", operation: "A0" });
    expect(planOutboxAction({ live: true, contentHash: "h3", history: [entry("A0", "ACCEPTED"), entry("A1", "REJECTED", "h2")] })).toEqual({ kind: "create", operation: "A1" });
  });

  it("anulada: baja si consta en el SII; si aún no había salido, se descarta", () => {
    expect(planOutboxAction({ live: false, contentHash: null, history: [] })).toEqual({ kind: "none" });
    expect(planOutboxAction({ live: false, contentHash: null, history: [entry("A0", "PENDING")] })).toEqual({ kind: "delete", recordId: "A0-PENDING" });
    expect(planOutboxAction({ live: false, contentHash: null, history: [entry("A0", "ACCEPTED")] })).toEqual({ kind: "create", operation: "BAJA" });
    expect(planOutboxAction({ live: false, contentHash: null, history: [entry("A0", "ACCEPTED"), entry("A1", "PENDING", "h2")] })).toEqual({ kind: "to-cancellation", recordId: "A1-PENDING" });
    expect(planOutboxAction({ live: false, contentHash: null, history: [entry("A0", "REJECTED")] })).toEqual({ kind: "none" });
    expect(planOutboxAction({ live: false, contentHash: null, history: [entry("A0", "ACCEPTED"), entry("BAJA", "ACCEPTED")] })).toEqual({ kind: "none" });
  });

  it("enviada sin respuesta concluyente: espera", () => {
    expect(planOutboxAction({ live: true, contentHash: "h2", history: [entry("A0", "SENT")] })).toEqual({ kind: "none" });
    expect(isRegisteredInSii([entry("A0", "ACCEPTED"), entry("BAJA", "ACCEPTED")])).toBe(false);
    expect(isRegisteredInSii([entry("A0", "ACCEPTED"), entry("BAJA", "REJECTED")])).toBe(true);
  });
});

describe("elegibilidad y resultado por línea", () => {
  it("solo el SII de la AEAT en territorio común (también en criterio de caja: clave 07 y libros de cobros y pagos)", () => {
    const base = { siiEnabled: true, countryCode: "ES", territory: "ES", fiscalRegime: "general" };
    expect(siiEligibility(base)).toMatchObject({ enabled: true, supported: true });
    expect(siiEligibility({ ...base, siiEnabled: false })).toMatchObject({ enabled: false, supported: false });
    expect(siiEligibility({ ...base, territory: "ES-CN" }).supported).toBe(false);
    expect(siiEligibility({ ...base, fiscalRegime: "cash_accounting" }).supported).toBe(true);
    expect(siiEligibility({ ...base, countryCode: "PT", territory: "PT" }).supported).toBe(false);
  });

  it("traduce el estado de cada línea y los duplicados", () => {
    const response = { csv: "GLOBAL", submissionStatus: "ParcialmenteCorrecto" };
    const line = { invoiceNumber: "F1", issueDate: null, refExterna: null, csv: null, duplicateStatus: null, errorCode: null, errorMessage: null };
    expect(outcomeForLine({ ...line, status: "Correcto", csv: "LINEA" }, response, "A0")).toEqual({ status: "ACCEPTED", errorCode: null, errorMessage: null, csv: "LINEA" });
    expect(outcomeForLine({ ...line, status: "AceptadoConErrores", errorCode: "2011", errorMessage: "NIF no identificado" }, response, "A0")).toMatchObject({ status: "ACCEPTED_WITH_ERRORS", errorCode: "2011", csv: "GLOBAL" });
    expect(outcomeForLine({ ...line, status: "Incorrecto", errorCode: "1104", errorMessage: "Valor del campo ID incorrecto" }, response, "A0")).toMatchObject({ status: "REJECTED", errorCode: "1104" });
    const duplicate = outcomeForLine({ ...line, status: "Incorrecto", errorCode: "3000", errorMessage: "Factura duplicada", duplicateStatus: "Correcta" }, response, "A0");
    expect(duplicate.status).toBe("REJECTED");
    expect(duplicate.errorMessage).toContain("modificación");
    expect(outcomeForLine({ ...line, status: "Incorrecto", errorCode: "3001", errorMessage: "El registro está ya dado de baja" }, response, "BAJA").status).toBe("ACCEPTED");
    expect(outcomeForLine(undefined, { csv: "G", submissionStatus: "Correcto" }, "A0").status).toBe("ACCEPTED");
    expect(outcomeForLine(undefined, response, "A0").status).toBe("SENT");
  });

  it("reintentos con espera creciente hasta 6 horas", () => {
    expect(retryDelayMs(1)).toBe(5 * 60_000);
    expect(retryDelayMs(2)).toBe(10 * 60_000);
    expect(retryDelayMs(20)).toBe(6 * 60 * 60_000);
  });
});

// ── Con base de datos ───────────────────────────────────────────────────────────────────────

type Sent = { xml: string; book: string };

function fakeTransport(respond: (xml: string, book: string) => string | Error): SiiTransport & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    kind: "fake",
    environment: "test",
    requiresCredentials: false,
    sent,
    async send(xml, target) {
      sent.push({ xml, book: target.book });
      const result = respond(xml, target.book);
      if (result instanceof Error) throw result;
      return { httpStatus: 200, body: result };
    },
  };
}

/** Respuesta en la que cada registro (por su RefExterna) recibe el estado que diga `statusOf`. */
function responseFor(xml: string, statusOf: (ref: string) => { status: string; code?: string; message?: string }) {
  const refs = [...xml.matchAll(/<(?:sii|siiLR):RefExterna>([^<]+)</g)].map((match) => match[1]);
  const lines = refs.map((ref) => {
    const result = statusOf(ref);
    return `<siiR:RespuestaLinea><siiR:RefExterna>${ref}</siiR:RefExterna><siiR:EstadoRegistro>${result.status}</siiR:EstadoRegistro>${result.code ? `<siiR:CodigoErrorRegistro>${result.code}</siiR:CodigoErrorRegistro><siiR:DescripcionErrorRegistro>${result.message ?? ""}</siiR:DescripcionErrorRegistro>` : ""}${result.status === "Correcto" ? `<siiR:CSV>CSV-${ref.slice(0, 8)}</siiR:CSV>` : ""}</siiR:RespuestaLinea>`;
  });
  return `<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body><siiR:Respuesta xmlns:siiR="r"><siiR:CSV>GLOBAL</siiR:CSV><siiR:EstadoEnvio>ParcialmenteCorrecto</siiR:EstadoEnvio>${lines.join("")}</siiR:Respuesta></env:Body></env:Envelope>`;
}

const bodyOf = (envelope: string) => /<soapenv:Body>\s*([\s\S]*?)\s*<\/soapenv:Body>/.exec(envelope)![1];
const records = (book?: string) => state.db.select().from(siiRecord).where(and(eq(siiRecord.companyId, COMPANY), ...(book ? [eq(siiRecord.book, book)] : []))).orderBy(asc(siiRecord.createdAt), asc(siiRecord.invoiceNumber));
const env = { SII_ENVIRONMENT: "test" };

async function addInvoice(id: string, number: string, issueDate: Date, companyId = COMPANY, customerId = "customer-1") {
  await state.db.insert(invoice).values({
    id,
    companyId,
    customerId,
    number,
    issueDate,
    issuedAt: issueDate,
    totalAmount: "121.00",
    status: "SENT",
    vatTreatment: "DOMESTIC",
    customerSnapshot: { name: "Cliente SA", taxId: "A58818501", address: null, addressLine2: null, postalCode: null, city: null, province: null, countryCode: "ES" },
  });
  await state.db.insert(invoiceLine).values({ id: `${id}-l1`, invoiceId: id, description: "Servicio", quantity: "1", unitPrice: "100.00", taxRate: "21", lineTotal: "121.00" });
  await state.db.insert(invoiceLineTax).values({ invoiceLineId: `${id}-l1`, name: "IVA 21 %", rate: "21", kind: "VAT", operation: "ADD", baseAmount: "100.00", amount: "21.00" });
}

async function addSupplierInvoice(id: string, number: string, accountingDate: Date) {
  await state.db.insert(supplierInvoice).values({
    id,
    companyId: COMPANY,
    supplierPartnerId: "supplier-1",
    number,
    supplierDocumentNumber: `PROV-${number}`,
    issueDate: accountingDate,
    accountingDate,
    status: "POSTED",
    subtotalAmount: "200.00",
    taxAmount: "42.00",
    totalAmount: "242.00",
    vatTreatment: "DOMESTIC",
  });
  await state.db.insert(supplierInvoiceLine).values({ id: `${id}-l1`, supplierInvoiceId: id, description: "Material", quantity: "1", unitPrice: "200.00", taxRate: "21", subtotalAmount: "200.00", taxAmount: "42.00", lineTotal: "242.00" });
}

beforeAll(async () => {
  vi.stubEnv("SII_ENVIRONMENT", "test");
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);

  await state.db.insert(user).values({ id: "user-1", name: "Ana", email: "ana@example.com" });
  await state.db.insert(tenant).values({ id: "tenant-1", name: "T", slug: "t", ownerId: "user-1" });
  await state.db.insert(company).values([
    { id: COMPANY, tenantId: "tenant-1", name: "Empresa", legalName: "Empresa Demo SL", vatNumber: "B12345674", postalCode: "28001" },
    { id: OTHER, tenantId: "tenant-1", name: "Otra", vatNumber: "B85121501", postalCode: "28001" },
  ]);
  await state.db.insert(companySettings).values([{ companyId: COMPANY, siiEnabled: true }, { companyId: OTHER, siiEnabled: false }]);
  await state.db.insert(partner).values([
    { id: "partner-c", companyId: COMPANY, number: "C1", name: "Cliente SA", taxId: "A58818501", countryCode: "ES" },
    { id: "supplier-1", companyId: COMPANY, number: "P1", type: "SUPPLIER", name: "Proveedor SL", taxId: "B85121501", countryCode: "ES" },
  ]);
  await state.db.insert(customer).values([
    { id: "customer-1", companyId: COMPANY, partnerId: "partner-c", name: "Cliente SA" },
    { id: "customer-2", companyId: OTHER, name: "Cliente de la otra" },
  ]);

  await addInvoice("inv-1", "FA-0001", day(2, 10));
  await addInvoice("inv-2", "FA-0002", day(2, 11));
  await addInvoice("inv-draft", "BORRADOR-xyz", day(2, 12));
  await addInvoice("inv-old", "FA-OLD", day(12, 20, year - 1));
  await addInvoice("inv-other", "FB-0001", day(2, 10), OTHER, "customer-2");
  await addSupplierInvoice("sup-1", "FR-0001", day(2, 15));
}, 120_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await state.client?.close();
});

describe("bandeja de salida del SII", () => {
  it("solo trabaja para las empresas con el SII activado", async () => {
    expect(await listSiiCompanyIds()).toEqual([COMPANY]);
    const skipped = await detectSiiRecords(OTHER, { env });
    expect(skipped.skipped).toContain("no está activado");
    expect(await state.db.select().from(siiRecord).where(eq(siiRecord.companyId, OTHER))).toEqual([]);
  });

  it("detecta las facturas expedidas y recibidas del año sin suministrar (ni borradores ni anteriores a la fecha de inicio)", async () => {
    const summary = await detectSiiRecords(COMPANY, { env });
    expect(summary).toMatchObject({ created: 3, updated: 0, cancelled: 0, skipped: null });
    const rows = await records();
    expect(rows.map((row: { book: string; invoiceNumber: string; operation: string; status: string }) => [row.book, row.invoiceNumber, row.operation, row.status]).sort()).toEqual([
      ["ISSUED", "FA-0001", "A0", "PENDING"],
      ["ISSUED", "FA-0002", "A0", "PENDING"],
      ["RECEIVED", "PROV-FR-0001", "A0", "PENDING"],
    ]);
    const first = rows.find((row: { invoiceNumber: string }) => row.invoiceNumber === "FA-0001");
    expect(first).toMatchObject({ environment: "test", fiscalYear: String(year), period: "02", invoiceDate: `10-02-${year}`, invoiceTypeCode: "F1", counterpartyName: "Cliente SA", totalAmount: "121.00", blockedReason: null });
    expect(first.dueDate).toMatch(new RegExp(`^${year}-02-1[5-9]$`));
    const [settings] = await state.db.select().from(siiSettings).where(eq(siiSettings.companyId, COMPANY));
    expect(settings.since.toISOString()).toBe(new Date(Date.UTC(year - 1, 11, 31, 23)).toISOString());
    // Repetir la revisión no duplica nada.
    expect(await detectSiiRecords(COMPANY, { env })).toMatchObject({ created: 0, updated: 0 });
    expect(await records()).toHaveLength(3);
  });

  it("envía por libro, con XML válido contra el XSD, y anota aceptados y rechazados", async () => {
    const transport = fakeTransport((xml) => responseFor(xml, (ref) => (xml.includes("FA-0002") && ref === rejectedId ? { status: "Incorrecto", code: "1104", message: "Valor del campo ID incorrecto" } : { status: "Correcto" })));
    const rejectedId = (await records("ISSUED")).find((row: { invoiceNumber: string }) => row.invoiceNumber === "FA-0002").id;
    const [summary] = await processPendingSiiRecords({ transport });
    expect(summary).toMatchObject({ companyId: COMPANY, sent: 3, accepted: 2, rejected: 1, failed: 0, error: null });
    expect(transport.sent.map((sent) => sent.book).sort()).toEqual(["ISSUED", "RECEIVED"]);
    for (const sent of transport.sent) expect(validator.validate(bodyOf(sent.xml))).toEqual([]);
    const issuedXml = transport.sent.find((sent) => sent.book === "ISSUED")!.xml;
    expect(issuedXml).toContain("<sii:TipoComunicacion>A0</sii:TipoComunicacion>");
    expect(issuedXml).toMatch(/<sii:Titular>\s*<sii:NombreRazon>Empresa Demo SL<\/sii:NombreRazon>\s*<sii:NIF>B12345674<\/sii:NIF>/);
    const rows = await records();
    const byNumber = Object.fromEntries(rows.map((row: { invoiceNumber: string }) => [row.invoiceNumber, row]));
    expect(byNumber["FA-0001"]).toMatchObject({ status: "ACCEPTED", attempts: 1 });
    expect(byNumber["FA-0001"].aeatCsv).toMatch(/^CSV-/);
    expect(byNumber["FA-0002"]).toMatchObject({ status: "REJECTED", aeatErrorCode: "1104", aeatErrorMessage: "Valor del campo ID incorrecto" });
    expect(byNumber["PROV-FR-0001"].status).toBe("ACCEPTED");
    // Nada pendiente: un segundo envío no manda nada.
    expect(await processPendingSiiRecords({ transport })).toEqual([]);
  });

  it("la pantalla ve los rechazados con su error y los vencidos; exporta lo suministrado", async () => {
    const overview = await getSiiOverview(COMPANY);
    expect(overview.eligibility.supported).toBe(true);
    expect(overview.counts).toEqual({ ACCEPTED: 2, REJECTED: 1 });
    expect(overview.rejected.map((record) => [record.invoiceNumber, record.aeatErrorCode])).toEqual([["FA-0002", "1104"]]);
    // La rechazada sigue sin constar en el SII y su plazo (febrero) ya pasó.
    expect(overview.overdue.map((record) => record.invoiceNumber)).toEqual(["FA-0002"]);
    expect(overview.rejected[0].dueLabel).toMatch(/^\d{2}\/02\/\d{4}$/);
    const file = await exportSiiRecords(COMPANY);
    expect(file.filename).toMatch(/^sii-registros-pruebas-/);
    expect(file.content.split("\r\n")[0]).toContain("Libro;Comunicación;Estado");
    expect(file.content).toContain("Expedida;Alta;Rechazado");
  });

  it("reenviar una rechazada crea una nueva alta; si la AEAT dice que está duplicada, sale como modificación", async () => {
    const rejected = (await records("ISSUED")).find((row: { status: string }) => row.status === "REJECTED");
    const resent = await resendSiiRecord(COMPANY, rejected.id);
    expect(resent).toMatchObject({ operation: "A0", requeued: false });
    const transport = fakeTransport((xml) => responseFor(xml, () => ({ status: "Incorrecto", code: "3000", message: "Factura duplicada" })));
    await processPendingSiiRecords({ transport });
    const duplicate = (await records("ISSUED")).find((row: { id: string }) => row.id === resent.recordId);
    expect(duplicate).toMatchObject({ status: "REJECTED", aeatErrorCode: "3000" });
    const again = await resendSiiRecord(COMPANY, duplicate.id);
    expect(again.operation).toBe("A1");
    const accepting = fakeTransport((xml) => responseFor(xml, () => ({ status: "Correcto" })));
    await processPendingSiiRecords({ transport: accepting });
    expect(accepting.sent[0].xml).toContain("<sii:TipoComunicacion>A1</sii:TipoComunicacion>");
    expect((await records("ISSUED")).filter((row: { sourceId: string }) => row.sourceId === "inv-2").map((row: { operation: string; status: string }) => `${row.operation}:${row.status}`)).toEqual(["A0:REJECTED", "A0:REJECTED", "A1:ACCEPTED"]);
    await expect(resendSiiRecord(COMPANY, again.recordId)).rejects.toThrow(/ya está aceptado/);
  });

  it("una factura recibida modificada tras suministrarse genera una modificación (A1)", async () => {
    await state.db.update(supplierInvoiceLine).set({ subtotalAmount: "300.00", taxAmount: "63.00" }).where(eq(supplierInvoiceLine.id, "sup-1-l1"));
    expect(await detectSiiRecords(COMPANY, { env })).toMatchObject({ created: 1 });
    const rows = await records("RECEIVED");
    expect(rows.map((row: { operation: string; status: string }) => `${row.operation}:${row.status}`)).toEqual(["A0:ACCEPTED", "A1:PENDING"]);
    expect(rows[1].dueDate).toBeNull();
    const transport = fakeTransport((xml) => responseFor(xml, () => ({ status: "AceptadoConErrores", code: "2011", message: "El NIF de la contraparte no está identificado" })));
    const [summary] = await processPendingSiiRecords({ transport });
    expect(summary.acceptedWithErrors).toBe(1);
    expect(transport.sent[0].xml).toContain("<sii:BaseImponible>300.00</sii:BaseImponible>");
    expect(validator.validate(bodyOf(transport.sent[0].xml))).toEqual([]);
  });

  it("anular una factura suministrada genera la baja; anular una que no había salido la quita de la bandeja", async () => {
    await addInvoice("inv-3", "FA-0003", day(3, 2));
    await detectSiiRecords(COMPANY, { env });
    expect((await records("ISSUED")).filter((row: { sourceId: string }) => row.sourceId === "inv-3")).toHaveLength(1);
    await state.db.update(invoice).set({ status: "VOID" }).where(eq(invoice.id, "inv-3"));
    await state.db.update(invoice).set({ status: "VOID" }).where(eq(invoice.id, "inv-1"));
    const summary = await detectSiiRecords(COMPANY, { env });
    expect(summary).toMatchObject({ discarded: 1, cancelled: 1 });
    expect((await records("ISSUED")).filter((row: { sourceId: string }) => row.sourceId === "inv-3")).toHaveLength(0);
    const baja = (await records("ISSUED")).find((row: { operation: string }) => row.operation === "BAJA");
    expect(baja).toMatchObject({ sourceId: "inv-1", status: "PENDING", invoiceNumber: "FA-0001", period: "02" });
    const transport = fakeTransport((xml) => responseFor(xml, () => ({ status: "Correcto" })));
    await processPendingSiiRecords({ transport });
    const body = bodyOf(transport.sent[0].xml);
    expect(body).toContain("<siiLR:BajaLRFacturasEmitidas");
    expect(validator.validate(body)).toEqual([]);
    // Dada de baja: no vuelve a generar nada.
    expect(await detectSiiRecords(COMPANY, { env })).toMatchObject({ created: 0, cancelled: 0 });
  });

  it("fallo de conexión o rechazo del envío completo: sigue pendiente, con espera y el motivo a la vista", async () => {
    await addInvoice("inv-4", "FA-0004", day(3, 3));
    await addInvoice("inv-5", "FA-0005", day(3, 4));
    await detectSiiRecords(COMPANY, { env });
    const start = new Date();
    const failing = fakeTransport(() => new Error("ECONNRESET"));
    const [failed] = await processPendingSiiRecords({ transport: failing, now: start });
    expect(failed).toMatchObject({ sent: 0, failed: 2, error: "ECONNRESET" });
    let pending = (await records("ISSUED")).filter((row: { status: string }) => row.status === "PENDING");
    expect(pending.map((row: { aeatErrorCode: string }) => row.aeatErrorCode)).toEqual([SII_TRANSPORT_ERROR, SII_TRANSPORT_ERROR]);
    expect(pending[0].nextAttemptAt.getTime()).toBe(start.getTime() + 5 * 60_000);
    // Antes de que pase la espera no se reintenta.
    expect(await processPendingSiiRecords({ transport: failing, now: new Date(start.getTime() + 60_000) })).toEqual([]);

    const fault = fakeTransport(() => '<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body><env:Fault><faultstring>Codigo[4102].El XML no cumple el esquema.</faultstring></env:Fault></env:Body></env:Envelope>');
    const later = new Date(start.getTime() + 10 * 60_000);
    const [faulted] = await processPendingSiiRecords({ transport: fault, now: later });
    expect(faulted.failed).toBe(2);
    expect(fault.sent).toHaveLength(1);
    pending = (await records("ISSUED")).filter((row: { status: string }) => row.status === "PENDING");
    expect(pending.every((row: { aeatErrorCode: string; aeatErrorMessage: string }) => row.aeatErrorCode === SII_FAULT_ERROR && row.aeatErrorMessage.includes("4102"))).toBe(true);
    expect((await getSiiOverview(COMPANY)).pending.filter((record) => record.sendFailed)).toHaveLength(2);

    // Tras un rechazo completo, cada registro viaja solo para aislar al culpable.
    const isolating = fakeTransport((xml) => responseFor(xml, () => ({ status: "Correcto" })));
    await processPendingSiiRecords({ transport: isolating, now: new Date(later.getTime() + 60 * 60_000) });
    expect(isolating.sent).toHaveLength(2);
    expect((await records("ISSUED")).filter((row: { status: string }) => row.status === "PENDING")).toHaveLength(0);
  });

  it("una factura que no se puede suministrar queda bloqueada con el motivo y no se envía", async () => {
    await state.db.insert(partner).values({ id: "supplier-2", companyId: COMPANY, number: "P2", type: "SUPPLIER", name: "Sin NIF" });
    await addSupplierInvoice("sup-2", "FR-0002", day(3, 5));
    await state.db.update(supplierInvoice).set({ supplierPartnerId: "supplier-2" }).where(eq(supplierInvoice.id, "sup-2"));
    await detectSiiRecords(COMPANY, { env });
    const blocked = (await records("RECEIVED")).find((row: { sourceId: string }) => row.sourceId === "sup-2");
    expect(blocked.blockedReason).toContain("no tiene NIF");
    const transport = fakeTransport((xml) => responseFor(xml, () => ({ status: "Correcto" })));
    await processPendingSiiRecords({ transport });
    expect(transport.sent).toHaveLength(0);
    // Al completar el NIF, la comunicación pendiente se actualiza y se desbloquea.
    await state.db.update(partner).set({ taxId: "A58818501" }).where(eq(partner.id, "supplier-2"));
    expect(await detectSiiRecords(COMPANY, { env })).toMatchObject({ updated: 1 });
    expect((await records("RECEIVED")).find((row: { sourceId: string }) => row.sourceId === "sup-2").blockedReason).toBeNull();
  });
});
