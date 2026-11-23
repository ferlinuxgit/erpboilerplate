import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cadena VeriFactu contra Postgres real (PGlite en memoria) con el esquema completo de Drizzle y
 * los triggers de inmutabilidad: encadenamiento secuencial, bloqueo de la cabeza, ausencia de
 * bifurcaciones, inmutabilidad, verificación de integridad y cola de envío con transporte falso.
 * Nunca se llama a la AEAT.
 */

const state = vi.hoisted(() => ({
  queries: [] as string[],
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
  state.db = drizzle(state.client, { schema, logger: { logQuery: (query: string) => state.queries.push(query) } });
  return { db: state.db };
});

import * as schema from "@/db/schema";
import { company, companySettings, customer, invoice, tenant, user, verifactuChainHead, verifactuEvent, verifactuRecord } from "@/db/schema";
import { appendAltaRecord, appendEvent } from "@/server/verifactu/chain";
import { getVerifactuSystemInfo } from "@/server/verifactu/config";
import { registerInvoiceAnnulmentRecord, registerIssuedInvoiceRecord, registerSubsanacionRecord } from "@/server/verifactu/hooks";
import { mapInvoiceToAlta } from "@/server/verifactu/mapping";
import { processPendingVerifactuRecords } from "@/server/verifactu/sender";
import { updateVerifactuSettings } from "@/server/verifactu/settings";
import { verifactuTriggerStatements } from "@/server/verifactu/sql";
import type { VerifactuTransport } from "@/server/verifactu/transport";
import { verifyCompanyChain, verifyRecordChain } from "@/server/verifactu/verify";

const COMPANY = "company-1";

beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);
  for (const statement of verifactuTriggerStatements()) await state.client.exec(statement);

  await state.db.insert(user).values({ id: "user-1", name: "Ana", email: "ana@example.com" });
  await state.db.insert(tenant).values({ id: "tenant-1", name: "T", slug: "t", ownerId: "user-1" });
  await state.db.insert(company).values({ id: COMPANY, tenantId: "tenant-1", name: "Empresa", legalName: "Empresa SL", vatNumber: "B12345678" });
  await state.db.insert(customer).values({ id: "customer-1", companyId: COMPANY, name: "Cliente" });
  for (let index = 1; index <= 6; index += 1) {
    await state.db.insert(invoice).values({
      id: `invoice-${index}`,
      companyId: COMPANY,
      customerId: "customer-1",
      number: `FA00000${index}`,
      issueDate: new Date(Date.UTC(2026, 8, index)),
      totalAmount: "121.00",
      status: "SENT",
    });
  }
}, 60_000);

afterAll(async () => {
  await state.client?.close();
});

beforeEach(() => {
  state.queries.length = 0;
});

const content = mapInvoiceToAlta({
  invoiceType: "INVOICE",
  rectificationReason: null,
  vatTreatment: "DOMESTIC",
  customer: { name: "Cliente", taxId: "B87654321", countryCode: "ES" },
  totals: { subtotal: 100, taxBuckets: [{ name: "IVA", kind: "VAT", rate: 21, operation: "ADD", baseAmount: 100, amount: 21 }] },
  description: "Servicios",
});

function draft(index: number) {
  return {
    companyId: COMPANY,
    invoiceId: `invoice-${index}`,
    mode: "VERIFACTU" as const,
    issuerTaxId: "B12345678",
    issuerName: "Empresa SL",
    invoiceNumber: `FA00000${index}`,
    invoiceIssueDate: `0${index}-09-2026`,
    systemInfo: getVerifactuSystemInfo(COMPANY, {}),
    content,
  };
}

/** Drizzle envuelve el error de Postgres ("Failed query…"); el mensaje del trigger está en `cause`. */
async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  const error = await promise.then(() => null, (caught: unknown) => caught as { message?: string; cause?: { message?: string } });
  expect(error).toBeTruthy();
  expect(`${error?.message ?? ""} ${error?.cause?.message ?? ""}`).toMatch(pattern);
}

async function allRecords() {
  return state.db.select().from(verifactuRecord).where(eq(verifactuRecord.companyId, COMPANY)).orderBy(asc(verifactuRecord.sequence));
}

describe("VeriFactu chain (PGlite)", () => {
  it("creates strictly sequential records chained by hash, locking the chain head", async () => {
    const base = new Date("2026-09-24T08:00:00Z");
    for (let index = 1; index <= 3; index += 1) {
      await state.db.transaction((tx: never) => appendAltaRecord(tx, draft(index), base));
    }
    const records = await allRecords();
    expect(records.map((record: { sequence: number }) => record.sequence)).toEqual([1, 2, 3]);
    expect(records[0].previousHash).toBeNull();
    expect(records[1].previousHash).toBe(records[0].hash);
    expect(records[1].previousRecordId).toBe(records[0].id);
    expect(records[2].previousInvoiceNumber).toBe("FA000002");
    // Mismo instante: la fecha de generación avanza para no retroceder respecto al anterior.
    expect(records.map((record: { generatedAtText: string }) => record.generatedAtText)).toEqual([
      "2026-09-24T10:00:00+02:00",
      "2026-09-24T10:00:01+02:00",
      "2026-09-24T10:00:02+02:00",
    ]);
    expect(records.every((record: { status: string }) => record.status === "PENDING_SEND")).toBe(true);
    expect(state.queries.some((query) => /from "verifactu_chain_head".*for update/i.test(query))).toBe(true);

    const [head] = await state.db.select().from(verifactuChainHead).where(eq(verifactuChainHead.companyId, COMPANY));
    expect(head).toMatchObject({ lastSequence: 3, lastHash: records[2].hash, lastRecordId: records[2].id });
    expect(verifyRecordChain(records, head).ok).toBe(true);
  });

  it("rejects forks at database level (second successor of the same record or duplicate sequence)", async () => {
    const [firstRecord, second] = await allRecords();
    const { id: _id, ...rest } = second;
    void _id;
    await expect(state.db.insert(verifactuRecord).values({ ...rest, sequence: 99 })).rejects.toThrow();
    await expect(state.db.insert(verifactuRecord).values({ ...rest, previousRecordId: firstRecord.id, sequence: 2, invoiceId: "invoice-4" })).rejects.toThrow();
  });

  it("keeps hash and content immutable while allowing send-status updates", async () => {
    const [record] = await allRecords();
    await expectDbError(state.db.update(verifactuRecord).set({ hash: "A".repeat(64) }).where(eq(verifactuRecord.id, record.id)), /inmutables/);
    await expectDbError(state.db.update(verifactuRecord).set({ totalAmount: "1.00" }).where(eq(verifactuRecord.id, record.id)), /inmutables/);
    await expectDbError(state.db.delete(verifactuRecord).where(eq(verifactuRecord.id, record.id)), /no se pueden borrar/);
    await state.db.update(verifactuRecord).set({ aeatErrorMessage: "prueba" }).where(eq(verifactuRecord.id, record.id));
    const [updated] = await state.db.select().from(verifactuRecord).where(eq(verifactuRecord.id, record.id));
    expect(updated.aeatErrorMessage).toBe("prueba");
    await state.db.update(verifactuRecord).set({ aeatErrorMessage: null }).where(eq(verifactuRecord.id, record.id));
  });

  it("keeps the event log append-only and chained", async () => {
    await state.db.transaction((tx: never) => appendEvent(tx, { companyId: COMPANY, eventType: "SYSTEM_START", description: "Inicio", payload: { z: 1, a: 2 } }));
    await state.db.transaction((tx: never) => appendEvent(tx, { companyId: COMPANY, eventType: "EXPORT", description: "Export" }));
    const events = await state.db.select().from(verifactuEvent).where(eq(verifactuEvent.companyId, COMPANY)).orderBy(asc(verifactuEvent.sequence));
    expect(events.map((event: { sequence: number }) => event.sequence)).toEqual([1, 2]);
    expect(events[1].previousHash).toBe(events[0].hash);
    await expectDbError(state.db.update(verifactuEvent).set({ description: "x" }).where(eq(verifactuEvent.id, events[0].id)), /solo inserción/);
    expect(verifyRecordChain(await allRecords(), null, events).ok).toBe(true);
  });

  it("detects tampering when records are altered bypassing the trigger", async () => {
    await state.client.exec(`ALTER TABLE "verifactu_record" DISABLE TRIGGER verifactu_record_immutable`);
    const [, second] = await allRecords();
    await state.db.update(verifactuRecord).set({ totalAmount: "999.00" }).where(eq(verifactuRecord.id, second.id));
    const result = await verifyCompanyChain(COMPANY, "user-1");
    expect(result.ok).toBe(false);
    expect(result.anomalies).toEqual(expect.arrayContaining([expect.objectContaining({ sequence: 2, code: "HASH_MISMATCH" })]));
    await state.db.update(verifactuRecord).set({ totalAmount: second.totalAmount }).where(eq(verifactuRecord.id, second.id));
    await state.client.exec(`ALTER TABLE "verifactu_record" ENABLE TRIGGER verifactu_record_immutable`);

    const ok = await verifyCompanyChain(COMPANY, "user-1");
    expect(ok.ok).toBe(true);
    const events = await state.db.select({ eventType: verifactuEvent.eventType }).from(verifactuEvent).where(eq(verifactuEvent.companyId, COMPANY)).orderBy(asc(verifactuEvent.sequence));
    expect(events.map((event: { eventType: string }) => event.eventType).slice(-2)).toEqual(["ANOMALY_DETECTED", "CHAIN_VERIFIED"]);
  });

  it("submits pending records with a pluggable transport and stores AEAT results", async () => {
    const sent: string[] = [];
    const transport: VerifactuTransport = {
      kind: "fake",
      async send(xml) {
        sent.push(xml);
        return {
          httpStatus: 200,
          body: `<RespuestaRegFactuSistemaFacturacion><CSV>CSV-1</CSV><EstadoEnvio>ParcialmenteCorrecto</EstadoEnvio>
            <RespuestaLinea><IDFactura><NumSerieFactura>FA000001</NumSerieFactura></IDFactura><Operacion><TipoOperacion>Alta</TipoOperacion></Operacion><EstadoRegistro>Correcto</EstadoRegistro></RespuestaLinea>
            <RespuestaLinea><IDFactura><NumSerieFactura>FA000002</NumSerieFactura></IDFactura><Operacion><TipoOperacion>Alta</TipoOperacion></Operacion><EstadoRegistro>Incorrecto</EstadoRegistro><CodigoErrorRegistro>1100</CodigoErrorRegistro><DescripcionErrorRegistro>NIF no identificado</DescripcionErrorRegistro></RespuestaLinea>
            </RespuestaRegFactuSistemaFacturacion>`,
        };
      },
    };
    const summaries = await processPendingVerifactuRecords({ transport, now: new Date("2026-09-24T09:00:00Z") });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("<sum:RegFactuSistemaFacturacion>");
    expect(summaries).toEqual([expect.objectContaining({ companyId: COMPANY, sent: 3, accepted: 1, rejected: 1 })]);
    const records = await allRecords();
    // Sin línea de respuesta no se sabe si consta en la AEAT: sigue pendiente y se reintenta.
    expect(records.map((record: { status: string }) => record.status)).toEqual(["ACCEPTED", "REJECTED", "PENDING_SEND"]);
    expect(records[2].nextAttemptAt.getTime()).toBe(new Date("2026-09-24T09:01:00Z").getTime());
    expect(records[0].aeatCsv).toBe("CSV-1");
    expect(records[1].aeatErrorCode).toBe("1100");
  });

  it("keeps records pending with a delayed retry when the transport fails", async () => {
    await state.db.transaction((tx: never) => appendAltaRecord(tx, draft(4), new Date("2026-09-24T09:10:00Z")));
    const failing: VerifactuTransport = { kind: "fake", send: async () => { throw new Error("ECONNRESET"); } };
    const now = new Date("2026-09-24T09:10:00Z");
    const [summary] = await processPendingVerifactuRecords({ transport: failing, now });
    // El registro 3 (sin respuesta en el envío anterior) se reintenta junto al nuevo.
    expect(summary).toMatchObject({ failed: 2, error: "ECONNRESET" });
    const [record] = (await allRecords()).filter((row: { sequence: number }) => row.sequence === 4);
    expect(record.status).toBe("PENDING_SEND");
    expect(record.sendAttempts).toBe(1);
    expect(record.nextAttemptAt.getTime()).toBe(now.getTime() + 60_000);
    // Antes del reintento no se vuelve a enviar.
    expect(await processPendingVerifactuRecords({ transport: failing, now: new Date(now.getTime() + 30_000) })).toEqual([]);
  });
});

describe("VeriFactu hooks", () => {
  const issuer = { name: "Empresa", legalName: "Empresa SL", taxId: "B12345678", address: null, addressLine2: null, postalCode: null, city: null, province: null, countryCode: "ES" };
  const hookInput = (index: number) => ({
    companyId: COMPANY,
    invoiceId: `invoice-${index}`,
    number: `FA00000${index}`,
    issueDate: new Date(Date.UTC(2026, 8, index)),
    invoiceType: "INVOICE",
    rectificationReason: null,
    rectificationDescription: null,
    vatTreatment: "DOMESTIC" as const,
    issuer,
    customer: { ...issuer, name: "Cliente", legalName: null, taxId: "B87654321" },
    totals: { subtotal: 100, taxBuckets: [{ name: "IVA", kind: "VAT", rate: 21, operation: "ADD" as const, baseAmount: 100, amount: 21 }] },
    lineDescriptions: ["Servicios"],
    original: null,
  });

  it("does nothing while VeriFactu is not activated", async () => {
    expect(await state.db.transaction((tx: never) => registerIssuedInvoiceRecord(tx, hookInput(5)))).toBeNull();
  });

  it("creates the alta record in the issue transaction when activated and respects the start date", async () => {
    await state.db.insert(companySettings).values({ companyId: COMPANY, verifactuMode: "verifactu", verifactuSince: new Date(Date.UTC(2026, 8, 5)) });
    const record = await state.db.transaction((tx: never) => registerIssuedInvoiceRecord(tx, hookInput(5)));
    expect(record).toMatchObject({ recordType: "ALTA", invoiceTypeCode: "F1", sequence: 5, totalAmount: "121.00", issuerTaxId: "B12345678" });
    // Factura anterior a la fecha de inicio: sin registro.
    expect(await state.db.transaction((tx: never) => registerIssuedInvoiceRecord(tx, { ...hookInput(6), issueDate: new Date(Date.UTC(2026, 8, 1)) }))).toBeNull();
  });

  it("rolls back the record when the surrounding issue transaction fails", async () => {
    const before = (await allRecords()).length;
    await expect(state.db.transaction(async (tx: never) => {
      await registerIssuedInvoiceRecord(tx, hookInput(6));
      throw new Error("posting failed");
    })).rejects.toThrow("posting failed");
    expect((await allRecords()).length).toBe(before);
    const [head] = await state.db.select().from(verifactuChainHead).where(eq(verifactuChainHead.companyId, COMPANY));
    expect(head.lastSequence).toBe(before);
  });

  it("requires a valid issuer NIF", async () => {
    await expect(state.db.transaction((tx: never) => registerIssuedInvoiceRecord(tx, { ...hookInput(6), issuer: { ...issuer, taxId: "" } })))
      .resolves.toBeTruthy(); // cae al NIF de la ficha de empresa (B12345678)
    await state.db.execute(sql`update "company" set "vatNumber" = null where id = ${COMPANY}`);
    await expect(state.db.transaction((tx: never) => registerIssuedInvoiceRecord(tx, { ...hookInput(6), issuer: { ...issuer, taxId: null } }))).rejects.toMatchObject({ status: 422 });
    await state.db.execute(sql`update "company" set "vatNumber" = 'B12345678' where id = ${COMPANY}`);
  });

  it("creates an anulación record only for invoices with a current alta", async () => {
    expect(await state.db.transaction((tx: never) => registerInvoiceAnnulmentRecord(tx, { companyId: COMPANY, invoiceId: "invoice-99" }))).toBeNull();
    const annulment = await state.db.transaction((tx: never) => registerInvoiceAnnulmentRecord(tx, { companyId: COMPANY, invoiceId: "invoice-5" }));
    expect(annulment).toMatchObject({ recordType: "ANULACION", invoiceNumber: "FA000005", invoiceTypeCode: null });
    expect(await state.db.transaction((tx: never) => registerInvoiceAnnulmentRecord(tx, { companyId: COMPANY, invoiceId: "invoice-5" }))).toBeNull();
    const [head] = await state.db.select().from(verifactuChainHead).where(eq(verifactuChainHead.companyId, COMPANY));
    expect(verifyRecordChain(await allRecords(), head).ok).toBe(true);
  });
});

describe("VeriFactu · subsanación, aislamiento de lotes y reglas de activación", () => {
  const issuer = { name: "Empresa", legalName: "Empresa SL", taxId: "B12345678", address: null, addressLine2: null, postalCode: null, city: null, province: null, countryCode: "ES" };
  const hookInput = (index: number, overrides: Record<string, unknown> = {}) => ({
    companyId: COMPANY,
    invoiceId: `invoice-${index}`,
    number: `FA00000${index}`,
    issueDate: new Date(Date.UTC(2026, 8, 6)),
    invoiceType: "INVOICE",
    rectificationReason: null,
    rectificationDescription: null,
    vatTreatment: "DOMESTIC" as const,
    issuer,
    customer: { ...issuer, name: "Cliente", legalName: null, taxId: "B87654321" },
    totals: { subtotal: 100, taxBuckets: [{ name: "IVA", kind: "VAT", rate: 21, operation: "ADD" as const, baseAmount: 100, amount: 21 }] },
    lineDescriptions: ["Servicios"],
    original: null,
    ...overrides,
  });
  const okLine = (number: string) => `<RespuestaLinea><IDFactura><NumSerieFactura>${number}</NumSerieFactura></IDFactura><EstadoRegistro>Correcto</EstadoRegistro></RespuestaLinea>`;
  // Solo el IDFactura de cada registro (el RegistroAnterior también lleva un NumSerieFactura).
  const sentNumbers = (xml: string) => [...xml.matchAll(/<sum1:IDFactura>\s*<sum1:IDEmisorFactura>[^<]*<\/sum1:IDEmisorFactura>\s*<sum1:NumSerieFactura>([^<]+)</g)].map((match) => match[1]);

  it("refuses a simplified invoice above the legal limit and sends the operation date when it differs", async () => {
    const big = { subtotal: 4000, taxBuckets: [{ name: "IVA", kind: "VAT", rate: 21, operation: "ADD" as const, baseAmount: 4000, amount: 840 }] };
    await expect(state.db.transaction((tx: never) => registerIssuedInvoiceRecord(tx, hookInput(6, { customer: null, totals: big })))).rejects.toMatchObject({ status: 422 });
    await state.db.transaction(async (tx: never) => {
      const record = await registerIssuedInvoiceRecord(tx, hookInput(6, { operationDate: new Date(Date.UTC(2026, 7, 28)) }));
      expect(record).toMatchObject({ operationDate: "28-08-2026", subsanacion: null, rechazoPrevio: null });
      const same = await registerIssuedInvoiceRecord(tx, hookInput(6, { operationDate: new Date(Date.UTC(2026, 8, 6)) }));
      expect(same?.operationDate).toBeNull();
      throw new Error("rollback");
    }).catch((error: Error) => expect(error.message).toBe("rollback"));
  });

  it("isolates the record that makes the whole batch fail and rejects only that one", async () => {
    // Deja la cola limpia: lo pendiente de los tests anteriores se da por aceptado.
    const before = await allRecords();
    for (const record of before) {
      if (record.status === "PENDING_SEND") await state.db.update(verifactuRecord).set({ status: "ACCEPTED", nextAttemptAt: null }).where(eq(verifactuRecord.id, record.id));
    }
    for (const index of [1, 2, 3]) {
      await state.db.transaction((tx: never) => registerIssuedInvoiceRecord(tx, hookInput(index, { number: `LOTE-${index}` })));
    }
    const sends: string[][] = [];
    const transport: VerifactuTransport = {
      kind: "fake",
      async send(xml) {
        const numbers = sentNumbers(xml).filter((number) => number.startsWith("LOTE-"));
        sends.push(numbers);
        if (numbers.includes("LOTE-2")) return { httpStatus: 500, body: "<Fault><faultstring>Codigo[4102].El XML no cumple el esquema</faultstring></Fault>" };
        return { httpStatus: 200, body: `<Respuesta><CSV>CSV-L</CSV>${numbers.map(okLine).join("")}</Respuesta>` };
      },
    };
    const [summary] = await processPendingVerifactuRecords({ transport, now: new Date(Date.now() + 2 * 86_400_000) });
    expect(sends[0]).toEqual(["LOTE-1", "LOTE-2", "LOTE-3"]);
    expect(summary).toMatchObject({ accepted: 2, rejected: 1, failed: 0 });
    const lote = (await allRecords()).filter((record: { invoiceNumber: string }) => record.invoiceNumber.startsWith("LOTE-"));
    expect(lote.map((record: { status: string }) => record.status)).toEqual(["ACCEPTED", "REJECTED", "ACCEPTED"]);
    expect(lote[1]).toMatchObject({ aeatErrorCode: "SOAP" });
    expect(lote[1].aeatErrorMessage).toContain("4102");
  });

  it("keeps everything pending when the failure is general (nothing in the batch gets through)", async () => {
    await state.db.transaction((tx: never) => registerIssuedInvoiceRecord(tx, hookInput(4, { number: "GEN-1" })));
    await state.db.transaction((tx: never) => registerIssuedInvoiceRecord(tx, hookInput(4, { number: "GEN-2" })));
    const fault: VerifactuTransport = { kind: "fake", send: async () => ({ httpStatus: 500, body: "<Fault><faultstring>Codigo[4104].Certificado no autorizado</faultstring></Fault>" }) };
    // Los registros se generan con la hora real: el envío se simula días después.
    const now = new Date(Date.now() + 3 * 86_400_000);
    const [summary] = await processPendingVerifactuRecords({ transport: fault, now });
    expect(summary).toMatchObject({ accepted: 0, rejected: 0, failed: 2 });
    const pending = (await allRecords()).filter((record: { invoiceNumber: string }) => record.invoiceNumber.startsWith("GEN-"));
    expect(pending.every((record: { status: string }) => record.status === "PENDING_SEND")).toBe(true);

    // Sin certificado propio ni del sistema no se intenta el envío; con el de la empresa, sí, y marcado como incidencia.
    const seen: Array<{ xml: string; credentials: unknown }> = [];
    const needsCert: VerifactuTransport = {
      kind: "fake",
      requiresCredentials: true,
      async send(xml, credentials) {
        seen.push({ xml, credentials });
        return { httpStatus: 200, body: `<Respuesta><CSV>CSV-G</CSV>${okLine("GEN-1")}${okLine("GEN-2")}</Respuesta>` };
      },
    };
    const later = new Date(now.getTime() + 86_400_000);
    expect(await processPendingVerifactuRecords({ transport: needsCert, now: later })).toEqual([]);
    const credentials = { pfx: Buffer.from("pfx"), passphrase: "secreto" };
    const [sent] = await processPendingVerifactuRecords({ transport: needsCert, now: later, credentialsFor: async () => credentials });
    expect(sent).toMatchObject({ accepted: 2 });
    expect(seen).toHaveLength(1);
    expect(seen[0].credentials).toBe(credentials);
    expect(seen[0].xml).toContain("<sum1:Incidencia>S</sum1:Incidencia>");
  });

  it("subsana un registro rechazado (RechazoPrevio X) y uno aceptado con errores (sin rechazo previo)", async () => {
    const rejected = (await allRecords()).find((record: { invoiceNumber: string }) => record.invoiceNumber === "LOTE-2");
    const fixed = await state.db.transaction((tx: never) => registerSubsanacionRecord(tx, hookInput(2, { number: "OTRO", customer: { ...issuer, name: "Cliente Corregido SL", legalName: null, taxId: "B11111111" } })));
    // Conserva la identificación de la factura y se encadena como un registro nuevo.
    expect(fixed).toMatchObject({ invoiceNumber: "LOTE-2", subsanacion: "S", rechazoPrevio: "X", status: "PENDING_SEND", recordType: "ALTA" });
    expect(fixed.sequence).toBeGreaterThan(rejected.sequence);
    expect(fixed.recipient).toMatchObject({ taxId: "B11111111", name: "Cliente Corregido SL" });
    // Ya hay una subsanación pendiente: no se puede subsanar otra vez hasta tener respuesta.
    await expect(state.db.transaction((tx: never) => registerSubsanacionRecord(tx, hookInput(2)))).rejects.toMatchObject({ status: 409 });

    await state.db.update(verifactuRecord).set({ status: "ACCEPTED_WITH_ERRORS" }).where(eq(verifactuRecord.id, fixed.id));
    const again = await state.db.transaction((tx: never) => registerSubsanacionRecord(tx, hookInput(2)));
    expect(again).toMatchObject({ subsanacion: "S", rechazoPrevio: null });
    // La factura ya consta en la AEAT: si ahora rechazan la subsanación, el rechazo previo es "S".
    await state.db.update(verifactuRecord).set({ status: "REJECTED" }).where(eq(verifactuRecord.id, again.id));
    const third = await state.db.transaction((tx: never) => registerSubsanacionRecord(tx, hookInput(2)));
    expect(third).toMatchObject({ subsanacion: "S", rechazoPrevio: "S" });

    const [head] = await state.db.select().from(verifactuChainHead).where(eq(verifactuChainHead.companyId, COMPANY));
    expect(verifyRecordChain(await allRecords(), head).ok).toBe(true);
  });

  it("no permite desactivar, cambiar de modalidad ni mover la fecha de inicio una vez activado", async () => {
    const actor = { tenantId: "tenant-1", companyId: COMPANY, actorUserId: "user-1" };
    const since = new Date(Date.UTC(2026, 8, 5));
    await expect(updateVerifactuSettings(actor, { mode: "pending", since })).rejects.toMatchObject({ status: 409 });
    await expect(updateVerifactuSettings(actor, { mode: "non_verifactu", since })).rejects.toMatchObject({ status: 422 });
    // Fecha futura para dejar de generar registros: rechazado porque ya hay registros.
    await expect(updateVerifactuSettings(actor, { mode: "verifactu", since: new Date(Date.UTC(2030, 0, 1)) })).rejects.toMatchObject({ status: 409 });
    await expect(updateVerifactuSettings(actor, { mode: "verifactu", since })).resolves.toMatchObject({ mode: "verifactu" });
  });

  it("no deja activar VERI*FACTU mientras el envío a la AEAT no esté operativo", async () => {
    await state.db.insert(company).values({ id: "company-2", tenantId: "tenant-1", name: "Otra", legalName: "Otra SL", vatNumber: "B22222222" });
    const actor = { tenantId: "tenant-1", companyId: "company-2", actorUserId: "user-1" };
    const saved = { transport: process.env.VERIFACTU_TRANSPORT, nif: process.env.VERIFACTU_PRODUCER_NIF, cert: process.env.VERIFACTU_CERT_PATH };
    try {
      delete process.env.VERIFACTU_TRANSPORT;
      await expect(updateVerifactuSettings(actor, { mode: "verifactu", since: null })).rejects.toMatchObject({ status: 409 });
      process.env.VERIFACTU_TRANSPORT = "aeat";
      process.env.VERIFACTU_PRODUCER_NIF = "B00000000";
      delete process.env.VERIFACTU_CERT_PATH;
      // Transporte activo pero la empresa no tiene certificado (ni hay uno del sistema).
      await expect(updateVerifactuSettings(actor, { mode: "verifactu", since: null })).rejects.toMatchObject({ status: 409 });
      process.env.VERIFACTU_CERT_PATH = "/run/secrets/sistema.p12";
      await expect(updateVerifactuSettings(actor, { mode: "verifactu", since: null })).resolves.toMatchObject({ mode: "verifactu" });
    } finally {
      for (const [key, value] of [["VERIFACTU_TRANSPORT", saved.transport], ["VERIFACTU_PRODUCER_NIF", saved.nif], ["VERIFACTU_CERT_PATH", saved.cert]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
