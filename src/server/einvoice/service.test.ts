import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Servicio de factura electrónica contra Postgres real (PGlite en memoria) y almacenamiento local
 * temporal: carga de la factura emitida, generación, firma con el certificado guardado de la
 * empresa, conservación del fichero y registro de estados.
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
import { auditLog, company, customer, einvoiceDocument, invoice, invoiceLine, invoiceLineTax, partner, tenant, user } from "@/db/schema";
import { addEInvoiceStatus, dir3Warnings, einvoiceAvailability, generateEInvoice, getEInvoiceOverview, loadEInvoice } from "@/server/einvoice/service";
import { unsignedFacturae, verifyFacturaeSignature } from "@/server/einvoice/xades";
import { readPrivateFile } from "@/server/storage/files";
import { saveCompanyCertificate } from "@/server/verifactu/certificates";

const COMPANY = "company-1";
const actor = { tenantId: "tenant-1", companyId: COMPANY, actorUserId: "user-1" };
const uploads = mkdtempSync(join(tmpdir(), "einvoice-test-"));
const pfx = Buffer.from(readFileSync(join(__dirname, "test-fixtures", "certificado-rsa-de-prueba.p12.b64"), "utf8").trim(), "base64");
// El certificado RSA de prueba es válido desde el 27-11-2026.
const NOW = new Date("2026-12-01T12:00:00Z");

const issuerSnapshot = { name: "Talleres Norte", legalName: "Talleres Norte, S.L.", taxId: "B12345674", address: "Calle Mayor 1", addressLine2: null, postalCode: "28013", city: "Madrid", province: "Madrid", countryCode: "ES" };
const customerSnapshot = { name: "Ayuntamiento de Villaejemplo", taxId: "P2807900B", address: "Plaza de la Villa 1", addressLine2: null, postalCode: "28005", city: "Villaejemplo", province: "Madrid", countryCode: "ES" };

async function seedInvoice(id: string, values: Record<string, unknown>, lines: Array<{ description: string; quantity: string; unitPrice: string; taxes: Array<{ name: string; rate: string; kind: string; operation: string }> }>) {
  await state.db.insert(invoice).values({ id, companyId: COMPANY, customerId: "customer-1", issueDate: new Date(Date.UTC(2026, 10, 20)), issuerSnapshot, customerSnapshot, ...values });
  for (const [index, line] of lines.entries()) {
    const lineId = `${id}-line-${index}`;
    await state.db.insert(invoiceLine).values({ id: lineId, invoiceId: id, description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, lineTotal: "0.00" });
    for (const tax of line.taxes) await state.db.insert(invoiceLineTax).values({ invoiceLineId: lineId, ...tax, baseAmount: "0.00", amount: "0.00" });
  }
}

beforeAll(async () => {
  process.env.LOCAL_UPLOAD_DIR = uploads;
  process.env.JWT_SECRET = "secreto-de-pruebas-para-cifrar-el-certificado";
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);

  await state.db.insert(user).values({ id: "user-1", name: "Ana", email: "ana@example.com" });
  await state.db.insert(tenant).values({ id: "tenant-1", name: "T", slug: "t", ownerId: "user-1" });
  await state.db.insert(company).values({ id: COMPANY, tenantId: "tenant-1", name: "Talleres Norte", legalName: "Talleres Norte, S.L.", vatNumber: "B12345674", fiscalAddress: "Calle Mayor 1", postalCode: "28013", city: "Madrid", province: "Madrid" });
  await state.db.insert(partner).values({ id: "partner-1", companyId: COMPANY, number: "C0001", name: "Ayuntamiento de Villaejemplo", taxId: "P2807900B", address: "Plaza de la Villa 1", postalCode: "28005", city: "Villaejemplo", province: "Madrid" });
  await state.db.insert(customer).values({ id: "customer-1", companyId: COMPANY, partnerId: "partner-1", name: "Ayuntamiento de Villaejemplo" });

  const vat21 = { name: "IVA 21 %", rate: "21.000", kind: "VAT", operation: "ADD" };
  await seedInvoice("invoice-1", { number: "F2026-000012", totalAmount: "242.00", status: "SENT", issuedAt: new Date("2026-11-20T10:00:00Z"), dueDate: new Date(Date.UTC(2026, 11, 20)), paymentMethodType: "BANK_TRANSFER", paymentBankAccountNumber: "ES9121000418450200051332" }, [
    { description: "Mantenimiento de alumbrado", quantity: "2.000", unitPrice: "100.00", taxes: [vat21] },
  ]);
  await seedInvoice("invoice-draft", { number: "BORRADOR-1", totalAmount: "121.00", status: "DRAFT" }, [
    { description: "Borrador", quantity: "1.000", unitPrice: "100.00", taxes: [vat21] },
  ]);
  await seedInvoice("invoice-credit", {
    number: "R2026-000001", totalAmount: "-121.00", status: "SENT", issuedAt: new Date("2026-11-25T10:00:00Z"), issueDate: new Date(Date.UTC(2026, 10, 25)),
    invoiceType: "CREDIT_NOTE", rectifiedInvoiceId: "invoice-1", rectificationReason: "R4", rectificationType: "DIFFERENCES", rectificationDescription: "Una revisión no realizada",
  }, [{ description: "Mantenimiento de alumbrado", quantity: "-1.000", unitPrice: "100.00", taxes: [vat21] }]);
}, 120_000);

afterAll(async () => {
  await state.client?.close();
  rmSync(uploads, { recursive: true, force: true });
});

describe("factura electrónica: servicio", () => {
  it("ofrece cada formato por capacidad del territorio, no por país", () => {
    expect(einvoiceAvailability("ES")).toEqual({ facturae: true, ubl: true, statuses: true });
    expect(einvoiceAvailability("ES-CN")).toMatchObject({ facturae: true });
    expect(einvoiceAvailability("FR")).toEqual({ facturae: false, ubl: true, statuses: false });
    expect(einvoiceAvailability("MX")).toEqual({ facturae: false, ubl: false, statuses: false });
  });

  it("no genera nada de un borrador", async () => {
    await expect(loadEInvoice(COMPANY, "invoice-draft")).rejects.toMatchObject({ status: 409 });
    await expect(generateEInvoice(actor, "invoice-draft", { format: "FACTURAE" })).rejects.toMatchObject({ status: 409 });
    expect(await getEInvoiceOverview(COMPANY, "invoice-draft")).toBeNull();
    expect(await generateEInvoice(actor, "no-existe", { format: "FACTURAE" })).toBeNull();
    expect(await loadEInvoice("otra-empresa", "invoice-1")).toBeNull();
  });

  it("avisa de que faltan los DIR3 de una Administración y del certificado", async () => {
    const overview = await getEInvoiceOverview(COMPANY, "invoice-1");
    expect(overview?.publicAdministration).toBe(true);
    expect(overview?.facturae.problems).toEqual([]);
    expect(overview?.facturae.warnings.some((warning) => warning.includes("códigos DIR3"))).toBe(true);
    expect(overview?.certificate.available).toBe(false);
    expect(overview?.certificate.message).toContain("AutoFirma");
    await expect(generateEInvoice(actor, "invoice-1", { format: "FACTURAE", signed: true })).rejects.toMatchObject({ status: 409 });
    expect(dir3Warnings({ customer: customerSnapshot, dir3: { accountingOffice: "L01280796" } })[0]).toContain("órgano gestor, unidad tramitadora");
  });

  it("genera el Facturae sin firmar con los DIR3 de la ficha, lo conserva y guarda su huella", async () => {
    await state.db.update(customer).set({ dir3AccountingOffice: "L01280796", dir3ManagingBody: "L01280796", dir3ProcessingUnit: "L01280796" }).where(eq(customer.id, "customer-1"));
    const file = await generateEInvoice(actor, "invoice-1", { format: "FACTURAE" }, NOW);
    const xml = file!.bytes.toString("utf8");
    expect(file).toMatchObject({ fileName: "F2026-000012.xml", signed: false, warnings: [] });
    expect(xml).toContain("<InvoiceTotal>242.00</InvoiceTotal>");
    expect(xml).toContain("<CentreCode>L01280796</CentreCode><RoleTypeCode>03</RoleTypeCode>");
    expect(xml).toContain("<IBAN>ES9121000418450200051332</IBAN>");
    expect(xml).toContain("<InstallmentDueDate>2026-12-20</InstallmentDueDate>");
    const [row] = await state.db.select().from(einvoiceDocument).where(eq(einvoiceDocument.invoiceId, "invoice-1"));
    expect(row).toMatchObject({ format: "FACTURAE", formatVersion: "3.2.2", signed: false, sha256: file!.sha256, status: "GENERATED", generatedByUserId: "user-1" });
    expect((await readPrivateFile(row.storageKey)).equals(file!.bytes)).toBe(true);
    const audits = await state.db.select().from(auditLog).where(eq(auditLog.action, "einvoice.generate"));
    expect(audits).toHaveLength(1);
    // Segunda descarga: la copia conservada, sin nueva fila ni nueva auditoría.
    const again = await generateEInvoice(actor, "invoice-1", { format: "FACTURAE" }, new Date("2026-11-28T12:00:00Z"));
    expect(again!.sha256).toBe(file!.sha256);
    expect(await state.db.select().from(auditLog).where(eq(auditLog.action, "einvoice.generate"))).toHaveLength(1);
  });

  it("firma con el certificado guardado de la empresa y la firma verifica", async () => {
    await saveCompanyCertificate(actor, { pfx, passphrase: "secreto", fileName: "prueba.p12" }, NOW);
    expect((await getEInvoiceOverview(COMPANY, "invoice-1"))?.certificate).toEqual({ available: true, message: null });
    const signed = await generateEInvoice(actor, "invoice-1", { format: "FACTURAE", signed: true }, NOW);
    const text = signed!.bytes.toString("utf8");
    expect(signed).toMatchObject({ fileName: "F2026-000012.xsig", signed: true });
    expect(verifyFacturaeSignature(text)).toMatchObject({ valid: true, signingTime: "2026-12-01T13:00:00+01:00" });
    const unsigned = await generateEInvoice(actor, "invoice-1", { format: "FACTURAE" }, NOW);
    expect(unsignedFacturae(text)).toBe(unsigned!.bytes.toString("utf8"));
    const rows = await state.db.select().from(einvoiceDocument).where(eq(einvoiceDocument.invoiceId, "invoice-1"));
    expect(rows).toHaveLength(2);
    expect(rows.find((row: { signed: boolean }) => row.signed)).toMatchObject({ sha256: signed!.sha256, signerSubject: expect.stringContaining("ANA PRUEBA") });
    // Se reutiliza la copia firmada conservada; «firmar de nuevo» la sustituye.
    const later = new Date("2026-12-02T09:00:00Z");
    expect((await generateEInvoice(actor, "invoice-1", { format: "FACTURAE", signed: true }, later))!.sha256).toBe(signed!.sha256);
    const resigned = await generateEInvoice(actor, "invoice-1", { format: "FACTURAE", signed: true, regenerate: true }, later);
    expect(resigned!.sha256).not.toBe(signed!.sha256);
    expect(verifyFacturaeSignature(resigned!.bytes.toString("utf8")).valid).toBe(true);
    expect(await state.db.select().from(einvoiceDocument).where(eq(einvoiceDocument.invoiceId, "invoice-1"))).toHaveLength(2);
  });

  it("si la factura conservada ya no coincide con la emitida, se vuelve a generar", async () => {
    await state.db.update(customer).set({ dir3ProposingBody: "L01280799" }).where(eq(customer.id, "customer-1"));
    const file = await generateEInvoice(actor, "invoice-1", { format: "FACTURAE" }, NOW);
    expect(file!.bytes.toString("utf8")).toContain("<CentreCode>L01280799</CentreCode><RoleTypeCode>04</RoleTypeCode>");
    const signed = await generateEInvoice(actor, "invoice-1", { format: "FACTURAE", signed: true }, NOW);
    expect(signed!.bytes.toString("utf8")).toContain("L01280799");
    expect(verifyFacturaeSignature(signed!.bytes.toString("utf8")).valid).toBe(true);
  });

  it("genera UBL y la rectificativa con su referencia a la original", async () => {
    const ubl = await generateEInvoice(actor, "invoice-1", { format: "UBL" }, NOW);
    expect(ubl).toMatchObject({ fileName: "F2026-000012-ubl.xml", signed: false });
    expect(ubl!.bytes.toString("utf8")).toContain('<cbc:PayableAmount currencyID="EUR">242.00</cbc:PayableAmount>');
    const credit = await generateEInvoice(actor, "invoice-credit", { format: "FACTURAE" }, NOW);
    const xml = credit!.bytes.toString("utf8");
    expect(xml).toContain("<InvoiceClass>OR</InvoiceClass>");
    expect(xml).toContain("<Corrective><InvoiceNumber>000012</InvoiceNumber><InvoiceSeriesCode>F2026-</InvoiceSeriesCode>");
    expect(xml).toContain("<InvoiceIssueDate>2026-11-20</InvoiceIssueDate>");
    expect(xml).toContain("<InvoiceTotal>-121.00</InvoiceTotal>");
    const creditUbl = await generateEInvoice(actor, "invoice-credit", { format: "UBL" }, NOW);
    expect(creditUbl!.bytes.toString("utf8")).toContain("<cbc:InvoiceTypeCode>384</cbc:InvoiceTypeCode>");
  });

  it("registra los estados que la norma obliga a comunicar y rechaza los incoherentes", async () => {
    await expect(addEInvoiceStatus(actor, "invoice-1", { status: "REJECTED", effectiveDate: "2026-11-24" }, NOW)).rejects.toMatchObject({ status: 422 });
    await expect(addEInvoiceStatus(actor, "invoice-1", { status: "ACCEPTED", effectiveDate: "2026-12-02" }, NOW)).rejects.toMatchObject({ status: 422 });
    await addEInvoiceStatus(actor, "invoice-1", { status: "SENT", effectiveDate: "2026-11-20" }, NOW);
    await addEInvoiceStatus(actor, "invoice-1", { status: "REJECTED", effectiveDate: "2026-11-23", rejectionCode: "01", reason: "Falta el número de expediente" }, NOW);
    await expect(addEInvoiceStatus(actor, "invoice-1", { status: "PAID", effectiveDate: "2026-11-26" }, NOW)).rejects.toMatchObject({ status: 422 });
    await addEInvoiceStatus(actor, "invoice-1", { status: "ACCEPTED", effectiveDate: "2026-11-24" }, NOW);
    const result = await addEInvoiceStatus(actor, "invoice-1", { status: "PAID", effectiveDate: "2026-11-26" }, NOW);
    expect(result?.statuses.map((entry) => entry.status)).toEqual(["SENT", "REJECTED", "ACCEPTED", "PAID"]);
    expect(result?.summary).toMatchObject({ current: "PAID", sentOn: "2026-11-20", paidOn: "2026-11-26", commercial: { status: "ACCEPTED" } });
    expect(result?.statuses[1]).toMatchObject({ reason: "Falta el número de expediente", rejectionCode: "01", deadline: "2026-11-27" });
    const overview = await getEInvoiceOverview(COMPANY, "invoice-1");
    expect(overview?.summary.current).toBe("PAID");
    expect(overview?.documents.map((document) => `${document.format}:${document.signed}`).sort()).toEqual(["FACTURAE:false", "FACTURAE:true", "UBL:false"]);
    await expect(addEInvoiceStatus(actor, "invoice-draft", { status: "SENT", effectiveDate: "2026-11-20" }, NOW)).rejects.toMatchObject({ status: 409 });
  });
});
