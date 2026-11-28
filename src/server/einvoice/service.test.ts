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
import { addEInvoiceStatus, dir3Warnings, einvoiceAvailability, generateEInvoice, getEInvoiceOverview, getEInvoiceStatusMessage, loadEInvoice } from "@/server/einvoice/service";
import type { FaceTransport } from "@/server/einvoice/face";
import { refreshFaceStatus, requestFaceCancellation, sendEInvoiceToFace } from "@/server/einvoice/face-service";
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
    expect(einvoiceAvailability("ES")).toEqual({ facturae: true, ubl: true, ublAeat: true, statuses: true });
    expect(einvoiceAvailability("ES-CN")).toMatchObject({ facturae: true, ublAeat: true });
    expect(einvoiceAvailability("FR")).toEqual({ facturae: false, ubl: true, ublAeat: false, statuses: false });
    expect(einvoiceAvailability("MX")).toEqual({ facturae: false, ubl: false, ublAeat: false, statuses: false });
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
    // Los DIR3 que entraron en el fichero quedan guardados con él, aunque luego cambie la ficha.
    expect(row.dir3Codes).toEqual({ accountingOffice: "L01280796", managingBody: "L01280796", processingUnit: "L01280796", proposingBody: null });
    expect(row.customerIban).toBeNull();
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

  it("genera el UBL con el perfil de la AEAT y guarda su versión", async () => {
    const overview = await getEInvoiceOverview(COMPANY, "invoice-1");
    expect(overview?.ublAeat).toEqual({ problems: [], warnings: [] });
    const file = await generateEInvoice(actor, "invoice-1", { format: "UBL_AEAT" }, NOW);
    const xml = file!.bytes.toString("utf8");
    expect(file).toMatchObject({ fileName: "F2026-000012-ubl-aeat.xml", signed: false });
    expect(xml).toContain("<cbc:CustomizationID>urn:cen.eu:en16931:2026#conformant#urn:aeat.es:spfe:1.0.0:extended</cbc:CustomizationID>");
    expect(xml).toContain('<cbc:CompanyID schemeID="FC">P2807900B</cbc:CompanyID>');
    const [row] = await state.db.select().from(einvoiceDocument).where(eq(einvoiceDocument.format, "UBL_AEAT"));
    expect(row).toMatchObject({ formatVersion: "2.5 · urn:cen.eu:en16931:2026#conformant#urn:aeat.es:spfe:1.0.0:extended", dir3Codes: null });
    // Rectificativa por diferencias con causa R4: tipo y modalidad en el perfil de la AEAT.
    const credit = await generateEInvoice(actor, "invoice-credit", { format: "UBL_AEAT" }, NOW);
    expect(credit!.bytes.toString("utf8")).toContain("<cbc:DocumentTypeCode>R4</cbc:DocumentTypeCode>");
  });

  it("rectificativa por sustitución: base y cuota de la factura rectificada recalculadas de sus líneas", async () => {
    await seedInvoice("invoice-substitution", {
      number: "R2026-000002", totalAmount: "121.00", status: "SENT", issuedAt: new Date("2026-11-26T10:00:00Z"), issueDate: new Date(Date.UTC(2026, 10, 26)),
      invoiceType: "CREDIT_NOTE", rectifiedInvoiceId: "invoice-1", rectificationReason: "R1", rectificationType: "SUBSTITUTION", rectificationDescription: "Precio corregido",
    }, [{ description: "Mantenimiento de alumbrado", quantity: "1.000", unitPrice: "100.00", taxes: [{ name: "IVA 21 %", rate: "21.000", kind: "VAT", operation: "ADD" }] }]);
    const loaded = await loadEInvoice(COMPANY, "invoice-substitution");
    expect(loaded?.data.corrective).toMatchObject({ originalTaxableBase: 200, originalTaxAmount: 42 });
    const file = await generateEInvoice(actor, "invoice-substitution", { format: "UBL_AEAT" }, NOW);
    const xml = file!.bytes.toString("utf8");
    expect(xml).toContain("<cbc:DocumentTypeCode>Base</cbc:DocumentTypeCode><cbc:DocumentDescription>200.00</cbc:DocumentDescription>");
    expect(xml).toContain("<cbc:DocumentTypeCode>Cuota</cbc:DocumentTypeCode><cbc:DocumentDescription>42.00</cbc:DocumentDescription>");
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
    expect(overview?.documents.map((document) => `${document.format}:${document.signed}`).sort()).toEqual(["FACTURAE:false", "FACTURAE:true", "UBL:false", "UBL_AEAT:false"]);
    await expect(addEInvoiceStatus(actor, "invoice-draft", { status: "SENT", effectiveDate: "2026-11-20" }, NOW)).rejects.toMatchObject({ status: 409 });
    // Mensaje de cobro (SETTLEMENT) para la solución pública, solo desde el estado «Pagada».
    const paid = result!.statuses.find((entry) => entry.status === "PAID")!;
    const settlement = await getEInvoiceStatusMessage(COMPANY, "invoice-1", paid.id, NOW);
    expect(settlement?.fileName).toBe("F2026-000012-settlement-2026-12-01.xml");
    expect(settlement?.xml).toContain("<cbc:ResponseCode>SETTLEMENT</cbc:ResponseCode><cbc:EffectiveDate>2026-11-26</cbc:EffectiveDate>");
    expect(settlement?.xml).toContain("<cbc:ReferenceDate>2026-12-20</cbc:ReferenceDate>");
    expect(settlement?.xml).toContain("<cbc:CompanyID>B12345674</cbc:CompanyID>");
    await expect(getEInvoiceStatusMessage(COMPANY, "invoice-1", result!.statuses[1].id, NOW)).rejects.toMatchObject({ status: 409 });
    expect(await getEInvoiceStatusMessage(COMPANY, "invoice-1", "no-existe", NOW)).toBeNull();
  });

  it("FACe: remite el .xsig conservado, guarda el entorno y el registro, consulta y anula (transporte falso)", async () => {
    const env = { FACE_TRANSPORT: "face", FACE_ENVIRONMENT: "staging" };
    const sent: Array<{ environment: string; operation: string; envelope: string }> = [];
    const replies: string[] = [];
    const transport: FaceTransport = { kind: "fake", async send(request) { sent.push(request); return { httpStatus: 200, body: replies.shift() ?? "" }; } };
    const wrap = (inner: string) => `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body>${inner}</S:Body></S:Envelope>`;

    // Sin envío activado o sin entorno declarado no sale nada.
    await expect(sendEInvoiceToFace(actor, "invoice-1", { email: "facturas@talleres.example" }, { transport, env: {} })).rejects.toMatchObject({ status: 409 });
    await expect(sendEInvoiceToFace(actor, "invoice-1", { email: "facturas@talleres.example" }, { transport, env: { FACE_TRANSPORT: "face" } })).rejects.toMatchObject({ status: 503 });
    expect(sent).toHaveLength(0);

    // Rechazo de FACe: queda el error y el entorno, y se puede reintentar.
    replies.push(wrap("<ns1:enviarFacturaResponse><return><resultado><codigo>301</codigo><descripcion>Certificado no dado de alta</descripcion></resultado></return></ns1:enviarFacturaResponse>"));
    await expect(sendEInvoiceToFace(actor, "invoice-1", { email: "facturas@talleres.example" }, { transport, env, now: NOW })).rejects.toMatchObject({ status: 502, message: expect.stringContaining("Certificado no dado de alta") });
    let [row] = await state.db.select().from(einvoiceDocument).where(eq(einvoiceDocument.invoiceId, "invoice-1")).then((rows: Array<{ signed: boolean; format: string }>) => rows.filter((r) => r.signed && r.format === "FACTURAE"));
    expect(row).toMatchObject({ status: "FAILED", faceEnvironment: "staging", faceRegistryNumber: null, faceSubmittedAt: null, faceLastError: "FACe respondió: 301 · Certificado no dado de alta" });

    replies.push(wrap("<ns1:enviarFacturaResponse><return><resultado><codigo>0</codigo><descripcion>Correcto</descripcion></resultado><factura><numeroRegistro>REGAGE26e00001</numeroRegistro><fechaRecepcion>2026-12-01 13:00:00</fechaRecepcion></factura></return></ns1:enviarFacturaResponse>"));
    const face = await sendEInvoiceToFace(actor, "invoice-1", { email: "facturas@talleres.example" }, { transport, env, now: NOW });
    expect(face).toMatchObject({ environment: "staging", registryNumber: "REGAGE26e00001", contactEmail: "facturas@talleres.example", lastError: null });
    expect(sent.map((request) => `${request.environment}:${request.operation}`)).toEqual(["staging:enviarFactura", "staging:enviarFactura"]);
    // Lo que viaja es la copia firmada conservada, en base64, con su firma WS-Security.
    [row] = await state.db.select().from(einvoiceDocument).where(eq(einvoiceDocument.faceRegistryNumber, "REGAGE26e00001"));
    expect(row).toMatchObject({ status: "SENT", signed: true, format: "FACTURAE" });
    const stored = await readPrivateFile((row as unknown as { storageKey: string }).storageKey);
    expect(sent[1].envelope).toContain(`<factura><factura>${stored.toString("base64")}</factura><nombre>F2026-000012.xsig</nombre><mime>application/xml</mime></factura>`);
    expect(sent[1].envelope).toContain("<wsse:BinarySecurityToken ");
    // Ya remitida: no se vuelve a enviar ni se vuelve a firmar (queda congelada).
    await expect(sendEInvoiceToFace(actor, "invoice-1", { email: "facturas@talleres.example" }, { transport, env, now: NOW })).rejects.toMatchObject({ status: 409 });
    await expect(generateEInvoice(actor, "invoice-1", { format: "FACTURAE", signed: true, regenerate: true }, NOW)).rejects.toMatchObject({ status: 409 });
    expect((await generateEInvoice(actor, "invoice-1", { format: "FACTURAE", signed: true }, NOW))!.bytes.equals(stored)).toBe(true);
    expect(await state.db.select().from(auditLog).where(eq(auditLog.action, "einvoice.face.send"))).toHaveLength(1);

    replies.push(wrap("<ns1:consultarFacturaResponse><return><resultado><codigo>0</codigo></resultado><factura><numeroRegistro>REGAGE26e00001</numeroRegistro><tramitacion><codigo>1300</codigo><descripcion>Registrada en RCF</descripcion><motivo/></tramitacion><anulacion><codigo>4100</codigo><descripcion>No solicitada anulación</descripcion><motivo/></anulacion></factura></return></ns1:consultarFacturaResponse>"));
    const refreshed = await refreshFaceStatus(actor, "invoice-1", { transport, env, now: NOW });
    expect(refreshed).toMatchObject({ processing: { code: "1300" }, cancellation: { code: "4100" } });
    // En otro entorno no se consulta: la factura nació en pruebas.
    await expect(refreshFaceStatus(actor, "invoice-1", { transport, env: { FACE_TRANSPORT: "face", FACE_ENVIRONMENT: "production" }, now: NOW })).rejects.toMatchObject({ status: 409 });

    await expect(requestFaceCancellation(actor, "invoice-1", { reason: " " }, { transport, env, now: NOW })).rejects.toMatchObject({ status: 400 });
    replies.push(wrap("<ns1:anularFacturaResponse><return><resultado><codigo>0</codigo></resultado><factura><numeroRegistro>REGAGE26e00001</numeroRegistro><mensaje>Solicitada anulación</mensaje></factura></return></ns1:anularFacturaResponse>"));
    replies.push(wrap("<ns1:consultarFacturaResponse><return><resultado><codigo>0</codigo></resultado><factura><numeroRegistro>REGAGE26e00001</numeroRegistro><tramitacion><codigo>1300</codigo><descripcion>Registrada en RCF</descripcion><motivo/></tramitacion><anulacion><codigo>4200</codigo><descripcion>Solicitada anulación</descripcion><motivo>Importe erróneo</motivo></anulacion></factura></return></ns1:consultarFacturaResponse>"));
    const cancelled = await requestFaceCancellation(actor, "invoice-1", { reason: "Importe erróneo" }, { transport, env, now: NOW });
    expect(cancelled).toMatchObject({ cancellation: { code: "4200", reason: "Importe erróneo" } });
    expect(sent.at(-2)?.envelope).toContain("<motivo>Importe erróneo</motivo>");
    const overview = await getEInvoiceOverview(COMPANY, "invoice-1");
    expect(overview?.documents.find((document) => document.signed)?.face?.registryNumber).toBe("REGAGE26e00001");
  });
});
