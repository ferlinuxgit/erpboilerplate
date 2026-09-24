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
import { registerInvoiceAnnulmentRecord, registerIssuedInvoiceRecord } from "@/server/verifactu/hooks";
import { mapInvoiceToAlta } from "@/server/verifactu/mapping";
import { processPendingVerifactuRecords } from "@/server/verifactu/sender";
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
    expect(records.map((record: { status: string }) => record.status)).toEqual(["ACCEPTED", "REJECTED", "SENT"]);
    expect(records[0].aeatCsv).toBe("CSV-1");
    expect(records[1].aeatErrorCode).toBe("1100");
  });

  it("keeps records pending with a delayed retry when the transport fails", async () => {
    await state.db.transaction((tx: never) => appendAltaRecord(tx, draft(4), new Date("2026-09-24T09:10:00Z")));
    const failing: VerifactuTransport = { kind: "fake", send: async () => { throw new Error("ECONNRESET"); } };
    const now = new Date("2026-09-24T09:10:00Z");
    const [summary] = await processPendingVerifactuRecords({ transport: failing, now });
    expect(summary).toMatchObject({ failed: 1, error: "ECONNRESET" });
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
