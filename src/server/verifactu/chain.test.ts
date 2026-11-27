import { and, asc, eq, sql } from "drizzle-orm";
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
import { getInvoiceVerifactuInfo, getVerifactuHealth, getVerifactuOverview } from "@/server/verifactu/service";
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
    environment: "test" as const,
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

  it("creates the alta record in the issue transaction when activated, deciding by the real issue time", async () => {
    const since = new Date(Date.UTC(2026, 8, 5));
    await state.db.insert(companySettings).values({ companyId: COMPANY, verifactuMode: "verifactu", verifactuSince: since });
    const record = await state.db.transaction((tx: never) => registerIssuedInvoiceRecord(tx, hookInput(5)));
    expect(record).toMatchObject({ recordType: "ALTA", environment: "test", invoiceTypeCode: "F1", sequence: 5, totalAmount: "121.00", issuerTaxId: "B12345678" });
    // Borrador FECHADO antes del inicio pero emitido después: lleva registro (antes salía sin él).
    await state.db.transaction(async (tx: never) => {
      const backdated = await registerIssuedInvoiceRecord(tx, { ...hookInput(6), issueDate: new Date(Date.UTC(2026, 8, 1)) });
      expect(backdated).toMatchObject({ recordType: "ALTA", invoiceIssueDate: "01-09-2026" });
      throw new Error("rollback");
    }).catch((error: Error) => expect(error.message).toBe("rollback"));
    // Emitida de verdad antes de la fecha de inicio: sin registro, diga lo que diga su fecha de expedición.
    expect(await state.db.transaction((tx: never) => registerIssuedInvoiceRecord(tx, { ...hookInput(6), issuedAt: new Date(since.getTime() - 1000) }))).toBeNull();
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
    const isolationNow = new Date(Date.now() + 2 * 86_400_000);
    // «Enviar ahora» no puede esperar entre envíos: sin `pause` no aísla y el lote queda pendiente.
    const [untouched] = await processPendingVerifactuRecords({ transport, now: isolationNow });
    expect(sends).toHaveLength(1);
    expect(untouched).toMatchObject({ accepted: 0, rejected: 0, failed: 3 });
    sends.length = 0;

    // El worker sí aísla, esperando el tiempo de la AEAT (60 s por defecto) antes de cada envío extra.
    const pauses: number[] = [];
    const [summary] = await processPendingVerifactuRecords({ transport, now: new Date(isolationNow.getTime() + 3_600_000), pause: async (milliseconds) => { pauses.push(milliseconds); } });
    expect(sends[0]).toEqual(["LOTE-1", "LOTE-2", "LOTE-3"]);
    expect(sends.length).toBeGreaterThan(1);
    expect(pauses).toHaveLength(sends.length - 1);
    expect(pauses.every((milliseconds) => milliseconds === 60_000)).toBe(true);
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
    const saved = { transport: process.env.VERIFACTU_TRANSPORT, nif: process.env.VERIFACTU_PRODUCER_NIF, cert: process.env.VERIFACTU_CERT_PATH, environment: process.env.VERIFACTU_ENVIRONMENT };
    try {
      delete process.env.VERIFACTU_TRANSPORT;
      await expect(updateVerifactuSettings(actor, { mode: "verifactu", since: null })).rejects.toMatchObject({ status: 409 });
      process.env.VERIFACTU_TRANSPORT = "aeat";
      process.env.VERIFACTU_PRODUCER_NIF = "B00000000";
      delete process.env.VERIFACTU_CERT_PATH;
      // Transporte activo pero la empresa no tiene certificado (ni hay uno del sistema).
      await expect(updateVerifactuSettings(actor, { mode: "verifactu", since: null })).rejects.toMatchObject({ status: 409 });
      process.env.VERIFACTU_CERT_PATH = "/run/secrets/sistema.p12";
      // Con el envío activado el entorno hay que declararlo: sin él no hay valor por defecto.
      delete process.env.VERIFACTU_ENVIRONMENT;
      await expect(updateVerifactuSettings(actor, { mode: "verifactu", since: null })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("VERIFACTU_ENVIRONMENT") });
      process.env.VERIFACTU_ENVIRONMENT = "test";
      // Fecha de inicio absurda (año mal tecleado): rechazada.
      await expect(updateVerifactuSettings(actor, { mode: "verifactu", since: new Date(Date.now() + 3 * 365 * 86_400_000) })).rejects.toMatchObject({ status: 422 });
      await expect(updateVerifactuSettings(actor, { mode: "verifactu", since: null })).resolves.toMatchObject({ mode: "verifactu" });
    } finally {
      for (const [key, value] of [["VERIFACTU_TRANSPORT", saved.transport], ["VERIFACTU_PRODUCER_NIF", saved.nif], ["VERIFACTU_CERT_PATH", saved.cert], ["VERIFACTU_ENVIRONMENT", saved.environment]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe("VeriFactu · entornos, control de flujo y avisos", () => {
  const OTHER = "company-3";
  const issuer = { name: "Tercera", legalName: "Tercera SL", taxId: "B33333333", address: null, addressLine2: null, postalCode: null, city: null, province: null, countryCode: "ES" };
  const draftFor = (index: number, environment: "test" | "production") => ({
    companyId: OTHER,
    invoiceId: `c3-invoice-${index}`,
    mode: "VERIFACTU" as const,
    environment,
    issuerTaxId: "B33333333",
    issuerName: "Tercera SL",
    invoiceNumber: `T${index}`,
    invoiceIssueDate: `0${index}-10-2026`,
    systemInfo: getVerifactuSystemInfo(OTHER, {}),
    content,
  });
  const hookInput = (index: number, overrides: Record<string, unknown> = {}) => ({
    companyId: OTHER,
    invoiceId: `c3-invoice-${index}`,
    number: `T${index}`,
    issueDate: new Date(Date.UTC(2026, 9, index)),
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
  const recordsOf = async () => state.db.select().from(verifactuRecord).where(eq(verifactuRecord.companyId, OTHER)).orderBy(asc(verifactuRecord.generatedAt));
  const okTransport = (waitSeconds: number, sent: Array<{ numbers: string[]; target: unknown }>, environment?: "test" | "production"): VerifactuTransport => ({
    kind: "fake",
    environment,
    async send(xml, _credentials, target) {
      const numbers = [...xml.matchAll(/<sum1:IDFactura>\s*<sum1:IDEmisorFactura>[^<]*<\/sum1:IDEmisorFactura>\s*<sum1:NumSerieFactura>([^<]+)</g)].map((match) => match[1]);
      sent.push({ numbers, target });
      return {
        httpStatus: 200,
        body: `<Respuesta><CSV>CSV-T</CSV><TiempoEsperaEnvio>${waitSeconds}</TiempoEsperaEnvio>${numbers.map((number) => `<RespuestaLinea><IDFactura><NumSerieFactura>${number}</NumSerieFactura></IDFactura><EstadoRegistro>Correcto</EstadoRegistro></RespuestaLinea>`).join("")}</Respuesta>`,
      };
    },
  });

  beforeAll(async () => {
    await state.db.insert(company).values({ id: OTHER, tenantId: "tenant-1", name: "Tercera", legalName: "Tercera SL", vatNumber: "B33333333" });
    await state.db.insert(customer).values({ id: "c3-customer", companyId: OTHER, name: "Cliente" });
    for (let index = 1; index <= 6; index += 1) {
      await state.db.insert(invoice).values({ id: `c3-invoice-${index}`, companyId: OTHER, customerId: "c3-customer", number: `T${index}`, issueDate: new Date(Date.UTC(2026, 9, index)), totalAmount: "121.00", status: "SENT" });
    }
  });

  it("keeps one chain per company AND environment: test and production records never link", async () => {
    const base = new Date("2026-10-10T08:00:00Z");
    const test1 = await state.db.transaction((tx: never) => appendAltaRecord(tx, draftFor(1, "test"), base));
    const production1 = await state.db.transaction((tx: never) => appendAltaRecord(tx, draftFor(2, "production"), new Date(base.getTime() + 60_000)));
    const test2 = await state.db.transaction((tx: never) => appendAltaRecord(tx, draftFor(3, "test"), new Date(base.getTime() + 120_000)));
    // Cada entorno empieza su propia cadena en el n.º 1 y solo enlaza con los suyos.
    expect(test1).toMatchObject({ environment: "test", sequence: 1, previousHash: null });
    expect(production1).toMatchObject({ environment: "production", sequence: 1, previousHash: null, previousRecordId: null });
    expect(test2).toMatchObject({ environment: "test", sequence: 2, previousHash: test1.hash, previousRecordId: test1.id });
    const heads = await state.db.select().from(verifactuChainHead).where(eq(verifactuChainHead.companyId, OTHER));
    expect(heads.map((head: { environment: string; lastSequence: number }) => `${head.environment}:${head.lastSequence}`).sort()).toEqual(["production:1", "test:2"]);
    expect((await verifyCompanyChain(OTHER, "user-1")).ok).toBe(true);
    // El entorno es inmutable: no se puede «pasar» un registro de pruebas a producción.
    await expectDbError(state.db.update(verifactuRecord).set({ environment: "production" }).where(eq(verifactuRecord.id, test1.id)), /inmutables/);
  });

  it("sends only the records of the deployment environment, to the endpoint of that environment", async () => {
    const sent: Array<{ numbers: string[]; target: unknown }> = [];
    const now = new Date("2026-10-10T09:00:00Z");
    const [summary] = await processPendingVerifactuRecords({ transport: okTransport(120, sent, "test"), now, companyId: OTHER });
    expect(summary).toMatchObject({ sent: 2, accepted: 2, waitSeconds: 120 });
    expect(sent).toEqual([{ numbers: ["T1", "T3"], target: { environment: "test" } }]);
    const records = await recordsOf();
    expect(records.map((record: { invoiceNumber: string; status: string }) => `${record.invoiceNumber}:${record.status}`)).toEqual(["T1:ACCEPTED", "T2:PENDING_SEND", "T3:ACCEPTED"]);

    // El aviso general lo cuenta: un registro de producción que este despliegue (pruebas) no enviará.
    const health = await getVerifactuHealth(OTHER, now);
    expect(health.otherEnvironmentPending).toBe(1);
    expect(health.issues.map((issue) => issue.code)).toContain("OTHER_ENVIRONMENT");
  });

  it("stores the AEAT wait time per company and environment and respects it on the next send", async () => {
    const [head] = await state.db.select().from(verifactuChainHead).where(and(eq(verifactuChainHead.companyId, OTHER), eq(verifactuChainHead.environment, "test")));
    expect(head.waitSeconds).toBe(120);
    expect(head.lastSubmissionAt.toISOString()).toBe("2026-10-10T09:00:00.000Z");

    await state.db.transaction((tx: never) => appendAltaRecord(tx, draftFor(4, "test"), new Date("2026-10-10T09:00:30Z")));
    const sent: Array<{ numbers: string[]; target: unknown }> = [];
    // 60 s después: la AEAT pidió 120 → no se envía y se dice cuánto falta.
    const early = await processPendingVerifactuRecords({ transport: okTransport(60, sent, "test"), now: new Date("2026-10-10T09:01:00Z"), companyId: OTHER });
    expect(early).toEqual([expect.objectContaining({ companyId: OTHER, sent: 0, throttledSeconds: 60 })]);
    expect(sent).toHaveLength(0);
    // Pasados los 120 s, sí; y la nueva espera (60) sustituye a la anterior.
    const [late] = await processPendingVerifactuRecords({ transport: okTransport(60, sent, "test"), now: new Date("2026-10-10T09:02:00Z"), companyId: OTHER });
    expect(late).toMatchObject({ sent: 1, accepted: 1, waitSeconds: 60 });
    const [after] = await state.db.select().from(verifactuChainHead).where(and(eq(verifactuChainHead.companyId, OTHER), eq(verifactuChainHead.environment, "test")));
    expect(after.waitSeconds).toBe(60);
  });

  it("derives the QR URL and the test label from the environment of the record", async () => {
    const testInfo = await getInvoiceVerifactuInfo(OTHER, "c3-invoice-1");
    expect(testInfo).toMatchObject({ environment: "test", isTest: true, legends: ["ENTORNO DE PRUEBAS · SIN VALIDEZ FISCAL"] });
    expect(testInfo?.url).toMatch(/^https:\/\/prewww2\.aeat\.es\//);
    const productionInfo = await getInvoiceVerifactuInfo(OTHER, "c3-invoice-2");
    expect(productionInfo).toMatchObject({ environment: "production", isTest: false });
    expect(productionInfo?.url).toMatch(/^https:\/\/www2\.agenciatributaria\.gob\.es\//);
    expect(productionInfo?.legends).not.toContain("ENTORNO DE PRUEBAS · SIN VALIDEZ FISCAL");
  });

  it("warns about records unsent for more than an hour and about rejections, and hides «Subsanar» when it would not help", async () => {
    await state.db.insert(companySettings).values({ companyId: OTHER, verifactuMode: "verifactu" });
    const created = await state.db.transaction((tx: never) => registerIssuedInvoiceRecord(tx, hookInput(5)));
    expect(created).toMatchObject({ environment: "test", status: "PENDING_SEND" });
    const soon = await getVerifactuHealth(OTHER, new Date(created.generatedAt.getTime() + 30 * 60_000));
    expect(soon.overduePending).toBe(0);
    const late = await getVerifactuHealth(OTHER, new Date(created.generatedAt.getTime() + 2 * 3_600_000));
    expect(late).toMatchObject({ overduePending: 1, ok: false });
    expect(late.oldestPendingAt?.getTime()).toBe(created.generatedAt.getTime());
    expect(late.issues.find((issue) => issue.code === "PENDING_OVERDUE")?.title).toMatch(/^1 registro sin remitir desde el /);

    // Rechazo por la identificación del destinatario: cuenta como rechazo y no se ofrece «Subsanar».
    await state.db.update(verifactuRecord).set({ status: "REJECTED", aeatErrorCode: "1193", aeatErrorMessage: "En el bloque Destinatarios si se identifica mediante NIF, el NIF debe estar identificado" }).where(eq(verifactuRecord.id, created.id));
    expect((await getVerifactuHealth(OTHER)).rejected).toBe(1);
    const overview = await getVerifactuOverview(OTHER);
    const row = overview.records.find((record) => record.id === created.id);
    expect(row).toMatchObject({ canSubsanar: false, isTest: true });
    expect(row?.subsanarHint).toContain("factura rectificativa");
    await expect(state.db.transaction((tx: never) => registerSubsanacionRecord(tx, hookInput(5)))).rejects.toMatchObject({ status: 409, message: expect.stringContaining("rectificativa") });
    // 2004 y 2009 tampoco se subsanan; un error corregible sí.
    await state.db.update(verifactuRecord).set({ aeatErrorCode: "2004", aeatErrorMessage: "El valor del campo FechaHoraHusoGenRegistro debe ser la fecha actual" }).where(eq(verifactuRecord.id, created.id));
    await expect(state.db.transaction((tx: never) => registerSubsanacionRecord(tx, hookInput(5)))).rejects.toMatchObject({ status: 409 });
    await state.db.update(verifactuRecord).set({ aeatErrorCode: "1100", aeatErrorMessage: "Valor o tipo incorrecto del campo." }).where(eq(verifactuRecord.id, created.id));
    expect((await getVerifactuOverview(OTHER)).records.find((record) => record.id === created.id)).toMatchObject({ canSubsanar: true, subsanarHint: null });
    const fixed = await state.db.transaction((tx: never) => registerSubsanacionRecord(tx, hookInput(5)));
    expect(fixed).toMatchObject({ subsanacion: "S", rechazoPrevio: "X", environment: "test" });
    // Subsanado: el rechazo ya no es el último registro de la factura y deja de contar.
    expect((await getVerifactuHealth(OTHER)).rejected).toBe(0);
  });

  it("fails before issuing when the AEAT would reject the record for good", async () => {
    const issue = (overrides: Record<string, unknown>) => state.db.transaction((tx: never) => registerIssuedInvoiceRecord(tx, hookInput(6, overrides)));
    // Caracteres no admitidos en NumSerieFactura.
    await expect(issue({ number: "FÁC-6" })).rejects.toMatchObject({ status: 422, message: expect.stringContaining("«Á»") });
    await expect(issue({ number: 'F"6' })).rejects.toMatchObject({ status: 422 });
    // Fecha de operación posterior a la de expedición.
    await expect(issue({ operationDate: new Date(Date.UTC(2026, 9, 20)) })).rejects.toMatchObject({ status: 422, message: expect.stringContaining("fecha de la operación") });
    // Exención E2 (exportación) en una operación de régimen general.
    const exempt = { subtotal: 100, taxBuckets: [] };
    await expect(issue({ vatTreatment: "EXEMPT", exemptionCode: "E2", totals: exempt })).rejects.toMatchObject({ status: 422, message: expect.stringContaining("E2") });
    // E5 con un cliente identificado con NIF español.
    await expect(issue({ vatTreatment: "INTRA_EU", totals: exempt })).rejects.toMatchObject({ status: 422, message: expect.stringContaining("E5") });
    expect((await recordsOf()).some((record: { invoiceId: string }) => record.invoiceId === "c3-invoice-6")).toBe(false);
  });

  it("refuses to issue when the deployment does not declare its environment", async () => {
    const saved = { environment: process.env.VERIFACTU_ENVIRONMENT, transport: process.env.VERIFACTU_TRANSPORT };
    try {
      delete process.env.VERIFACTU_ENVIRONMENT;
      process.env.VERIFACTU_TRANSPORT = "aeat";
      await expect(state.db.transaction((tx: never) => registerIssuedInvoiceRecord(tx, hookInput(6)))).rejects.toMatchObject({ status: 503, message: expect.stringContaining("VERIFACTU_ENVIRONMENT") });
      process.env.VERIFACTU_ENVIRONMENT = "producion";
      await expect(state.db.transaction((tx: never) => registerIssuedInvoiceRecord(tx, hookInput(6)))).rejects.toMatchObject({ status: 503 });
    } finally {
      for (const [key, value] of [["VERIFACTU_ENVIRONMENT", saved.environment], ["VERIFACTU_TRANSPORT", saved.transport]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("blocks issuing and voiding in the legacy NO VERI*FACTU mode instead of generating non-compliant records", async () => {
    await state.db.update(companySettings).set({ verifactuMode: "non_verifactu" }).where(eq(companySettings.companyId, OTHER));
    const before = (await recordsOf()).length;
    await expect(state.db.transaction((tx: never) => registerIssuedInvoiceRecord(tx, hookInput(6)))).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Activa VERI*FACTU") });
    await expect(state.db.transaction((tx: never) => registerInvoiceAnnulmentRecord(tx, { companyId: OTHER, invoiceId: "c3-invoice-1" }))).rejects.toMatchObject({ status: 409 });
    expect((await recordsOf()).length).toBe(before);
    expect((await getVerifactuHealth(OTHER)).issues.map((issue) => issue.code)).toContain("LEGACY_MODE");
  });
});
