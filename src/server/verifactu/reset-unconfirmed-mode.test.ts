import { readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Migración 0035: las empresas con un modo VeriFactu guardado desde el antiguo formulario fiscal
 * (sin el evento SYSTEM_START que deja el interruptor de activación) vuelven a "pending" y se
 * purgan los registros generados por error. Las activadas de verdad no se tocan.
 */

import * as schema from "@/db/schema";
import { company, companySettings, customer, invoice, tenant, user, verifactuChainHead, verifactuRecord } from "@/db/schema";
import { appendAltaRecord, appendEvent } from "@/server/verifactu/chain";
import { getVerifactuSystemInfo } from "@/server/verifactu/config";
import { mapInvoiceToAlta } from "@/server/verifactu/mapping";
import { verifactuTriggerStatements } from "@/server/verifactu/sql";

const client = new PGlite();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const state = { client, db: drizzle(client, { schema }) as any };

const MIGRATION =readFileSync(path.join(process.cwd(), "drizzle/0035_verifactu_reset_unconfirmed_mode.sql"), "utf8");

const content = mapInvoiceToAlta({
  invoiceType: "INVOICE",
  rectificationReason: null,
  vatTreatment: "DOMESTIC",
  customer: { name: "Cliente", taxId: "B87654321", countryCode: "ES" },
  totals: { subtotal: 100, taxBuckets: [{ name: "IVA", kind: "VAT", rate: 21, operation: "ADD", baseAmount: 100, amount: 21 }] },
  description: "Servicios",
});

async function seedCompany(id: string, mode: "verifactu" | "non_verifactu", invoices: number) {
  await state.db.insert(company).values({ id, tenantId: "tenant-1", name: id, legalName: `${id} SL`, vatNumber: "B12345678" });
  await state.db.insert(companySettings).values({ companyId: id, verifactuMode: mode });
  await state.db.insert(customer).values({ id: `${id}-customer`, companyId: id, name: "Cliente" });
  for (let index = 1; index <= invoices; index += 1) {
    await state.db.insert(invoice).values({
      id: `${id}-invoice-${index}`,
      companyId: id,
      customerId: `${id}-customer`,
      number: `FA00000${index}`,
      issueDate: new Date(Date.UTC(2026, 8, index)),
      totalAmount: "121.00",
      status: "SENT",
    });
  }
}

async function appendRecord(id: string, index: number) {
  return state.db.transaction((tx: never) => appendAltaRecord(tx, {
    companyId: id,
    invoiceId: `${id}-invoice-${index}`,
    mode: "NO_VERIFACTU",
    issuerTaxId: "B12345678",
    issuerName: `${id} SL`,
    invoiceNumber: `FA00000${index}`,
    invoiceIssueDate: `0${index}-09-2026`,
    systemInfo: getVerifactuSystemInfo(id, {}),
    content,
  }));
}

async function recordsOf(id: string) {
  return state.db.select().from(verifactuRecord).where(eq(verifactuRecord.companyId, id)).orderBy(asc(verifactuRecord.sequence));
}

async function settingsOf(id: string) {
  const [row] = await state.db.select().from(companySettings).where(eq(companySettings.companyId, id));
  return row;
}

beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);
  for (const statement of verifactuTriggerStatements()) await state.client.exec(statement);

  await state.db.insert(user).values({ id: "user-1", name: "Ana", email: "ana@example.com" });
  await state.db.insert(tenant).values({ id: "tenant-1", name: "T", slug: "t", ownerId: "user-1" });

  // Modo guardado con el antiguo formulario fiscal: registros sin evento de inicio.
  await seedCompany("legacy", "non_verifactu", 3);
  for (let index = 1; index <= 3; index += 1) await appendRecord("legacy", index);

  // Activada con el interruptor: tiene evento SYSTEM_START.
  await seedCompany("confirmed", "non_verifactu", 2);
  await state.db.transaction((tx: never) => appendEvent(tx, { companyId: "confirmed", eventType: "SYSTEM_START", description: "Inicio" }));
  for (let index = 1; index <= 2; index += 1) await appendRecord("confirmed", index);
}, 60_000);

afterAll(async () => {
  await state.client?.close();
});

describe("migration 0035: reset unconfirmed VeriFactu mode", () => {
  it("resets the mode and purges the chain of companies that never confirmed activation", async () => {
    expect(await recordsOf("legacy")).toHaveLength(3);
    await state.client.exec(MIGRATION);

    expect(await settingsOf("legacy")).toMatchObject({ verifactuMode: "pending", verifactuSince: null });
    expect(await recordsOf("legacy")).toHaveLength(0);
    const [head] = await state.db.select().from(verifactuChainHead).where(eq(verifactuChainHead.companyId, "legacy"));
    expect(head).toMatchObject({ lastRecordId: null, lastSequence: 0, lastHash: null });
  });

  it("leaves companies activated through the switch untouched", async () => {
    expect(await settingsOf("confirmed")).toMatchObject({ verifactuMode: "non_verifactu" });
    expect((await recordsOf("confirmed")).map((record: { sequence: number }) => record.sequence)).toEqual([1, 2]);
  });

  it("restores the immutability guard after the purge and lets the chain start over", async () => {
    const [confirmedRecord] = await recordsOf("confirmed");
    await expect(state.db.delete(verifactuRecord).where(eq(verifactuRecord.id, confirmedRecord.id))).rejects.toThrow();
    const restarted = await appendRecord("legacy", 1);
    expect(restarted).toMatchObject({ sequence: 1, previousHash: null });
  });

  it("refuses to purge records already sent to the AEAT", async () => {
    await seedCompany("sent", "verifactu", 1);
    const record = await appendRecord("sent", 1);
    await state.db.update(verifactuRecord).set({ status: "ACCEPTED" }).where(eq(verifactuRecord.id, record.id));
    await expect(state.client.exec(MIGRATION)).rejects.toThrow(/revisar a mano/);
    expect(await recordsOf("sent")).toHaveLength(1);
  });
});
