import { createHash } from "node:crypto";

import { and, asc, desc, eq } from "drizzle-orm";

import { company, companySettings, customer, einvoiceDocument, einvoiceStatusEvent, invoice, invoicePaymentMethod, partner, type InvoicePartySnapshot } from "@/db/schema";
import { getCountryFiscalProfile } from "@/lib/country-packs/profile";
import { taxTerritoryOf } from "@/lib/country-packs/territory";
import { db } from "@/lib/db";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { HttpError } from "@/lib/http";
import { recordAudit } from "@/server/audit";
import { buildSpfeStatusMessage } from "@/server/einvoice/application-response";
import { buildFacturaeXml, facturaeProblems, FACTURAE_VERSION } from "@/server/einvoice/facturae";
import { EInvoiceError, hasAnyDir3, partyTaxNumber, isValidDir3, looksLikePublicAdministration, missingDir3, type Dir3Codes, type EInvoiceData } from "@/server/einvoice/model";
import { extractSigningMaterial, Pkcs12Error } from "@/server/einvoice/pkcs12";
import {
  einvoiceStatusProblem,
  isEInvoiceStatus,
  statusCommunicationDeadline,
  summarizeEInvoiceStatus,
  type EInvoiceStatus,
  type EInvoiceStatusEvent,
  type EInvoiceStatusSummary,
} from "@/server/einvoice/status";
import { buildUblXml, UBL_CUSTOMIZATION_ID, UBL_SPFE_CUSTOMIZATION_ID, ublProblems } from "@/server/einvoice/ubl";
import { signFacturae, unsignedFacturae, verifyFacturaeSignature, XadesError } from "@/server/einvoice/xades";
import { civilDateKey } from "@/server/invoices/issue-checks";
import { defaultSalesVatTreatment, invoiceLifecycle, isSalesVatTreatment, vatTreatmentLegalNote } from "@/server/invoices/lifecycle";
import { loadStoredLines } from "@/server/invoices/service";
import { readPrivateFile, storePrivateFile } from "@/server/storage/files";
import { certificateValidity, getCompanyCertificateInfo, loadCompanyCredentials } from "@/server/verifactu/certificates";
import { getInvoiceVerifactuInfo } from "@/server/verifactu/service";

/**
 * Factura electrónica de las facturas EMITIDAS: carga de datos, generación, firma, conservación del
 * fichero entregado y registro de estados. Los generadores (`facturae.ts`, `ubl.ts`) y la firma
 * (`xades.ts`) son puros; aquí está todo lo que toca la base de datos y el almacenamiento.
 *
 * El envío por servicio web (FACe, solución pública de la AEAT, plataformas privadas) NO está
 * implementado: el fichero se descarga y se presenta a mano.
 */

/** UBL: núcleo EN 16931:2017 (UBL 2.1). UBL_AEAT: perfil de la solución pública de la AEAT (UBL 2.5). */
export type EInvoiceFormat = "FACTURAE" | "UBL" | "UBL_AEAT";

export const EINVOICE_FORMATS: readonly EInvoiceFormat[] = ["FACTURAE", "UBL", "UBL_AEAT"];

export type EInvoiceActor = { tenantId: string; companyId: string; actorUserId: string };

export type EInvoiceAvailability = {
  /** Facturae y FACe: solo donde existe la factura electrónica española. */
  facturae: boolean;
  /** UBL EN 16931: norma europea. */
  ubl: boolean;
  /** UBL con el perfil de la solución pública de la AEAT (Orden HAC/1028/2026): solo España. */
  ublAeat: boolean;
  /** Registro de estados del RD 238/2026 (norma española). */
  statuses: boolean;
};

/** Qué se ofrece a una empresa según su territorio fiscal (por capacidad, no por país). */
export function einvoiceAvailability(territory: string | null | undefined): EInvoiceAvailability {
  const profile = getCountryFiscalProfile(territory ?? "ES");
  const spanish = profile.features.eInvoicing === "verifactu";
  return { facturae: spanish, ubl: spanish || profile.isEu, ublAeat: spanish, statuses: spanish };
}

type LoadedInvoice = {
  data: EInvoiceData;
  invoiceId: string;
  number: string;
  issueDate: string;
  availability: EInvoiceAvailability;
  customerId: string;
};

function partyFrom(snapshot: InvoicePartySnapshot): EInvoiceData["issuer"] {
  return {
    name: snapshot.name,
    legalName: snapshot.legalName ?? null,
    taxId: snapshot.taxId,
    address: snapshot.address,
    addressLine2: snapshot.addressLine2,
    postalCode: snapshot.postalCode,
    city: snapshot.city,
    province: snapshot.province,
    countryCode: snapshot.countryCode,
    email: snapshot.email ?? null,
    phone: snapshot.phone ?? null,
    website: snapshot.website ?? null,
  };
}

/**
 * Datos de la factura para los generadores. Solo facturas emitidas: de un borrador no sale una
 * factura electrónica, y de una anulada tampoco. Emisor y cliente salen de las instantáneas
 * congeladas al emitir; los DIR3 y el IBAN del cliente, de su ficha actual (no son datos fiscales
 * de la factura, sino de encaminamiento y cobro).
 */
export async function loadEInvoice(companyId: string, invoiceId: string): Promise<LoadedInvoice | null> {
  const [row] = await db
    .select({
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      operationDate: invoice.operationDate,
      totalAmount: invoice.totalAmount,
      invoiceType: invoice.invoiceType,
      vatTreatment: invoice.vatTreatment,
      vatExemptionCode: invoice.vatExemptionCode,
      notes: invoice.notes,
      rectifiedInvoiceId: invoice.rectifiedInvoiceId,
      rectificationReason: invoice.rectificationReason,
      rectificationType: invoice.rectificationType,
      rectificationDescription: invoice.rectificationDescription,
      issuerSnapshot: invoice.issuerSnapshot,
      customerSnapshot: invoice.customerSnapshot,
      paymentMethodType: invoice.paymentMethodType,
      paymentBankAccountNumber: invoice.paymentBankAccountNumber,
      customerId: invoice.customerId,
      fiscalRegime: companySettings.fiscalRegime,
      currency: company.baseCurrencyCode,
      companyName: company.name,
      companyLegalName: company.legalName,
      companyVatNumber: company.vatNumber,
      companyFiscalAddress: company.fiscalAddress,
      companyFiscalAddressLine2: company.fiscalAddressLine2,
      companyPostalCode: company.postalCode,
      companyCity: company.city,
      companyProvince: company.province,
      companyCountryCode: company.countryCode,
      customerName: customer.name,
      customerIban: customer.iban,
      dir3AccountingOffice: customer.dir3AccountingOffice,
      dir3ManagingBody: customer.dir3ManagingBody,
      dir3ProcessingUnit: customer.dir3ProcessingUnit,
      dir3ProposingBody: customer.dir3ProposingBody,
      customerTaxId: partner.taxId,
      customerAddress: partner.address,
      customerAddressLine2: partner.addressLine2,
      customerPostalCode: partner.postalCode,
      customerCity: partner.city,
      customerProvince: partner.province,
      customerCountryCode: partner.countryCode,
    })
    .from(invoice)
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .innerJoin(company, eq(company.id, invoice.companyId))
    .leftJoin(companySettings, eq(companySettings.companyId, company.id))
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId)))
    .limit(1);
  if (!row) return null;
  const lifecycle = invoiceLifecycle(row);
  if (lifecycle === "DRAFT") throw new HttpError(409, "La factura electrónica solo se genera de facturas emitidas: emite antes el borrador.");
  if (lifecycle === "VOID") throw new HttpError(409, "La factura está anulada: no se genera su factura electrónica.");

  const isCreditNote = row.invoiceType === "CREDIT_NOTE";
  const [lines, paymentMethods, [original], verifactu] = await Promise.all([
    loadStoredLines(db, invoiceId),
    db.select({ type: invoicePaymentMethod.type, bankAccountNumber: invoicePaymentMethod.bankAccountNumber })
      .from(invoicePaymentMethod)
      .where(eq(invoicePaymentMethod.invoiceId, invoiceId))
      .orderBy(invoicePaymentMethod.position),
    row.rectifiedInvoiceId
      ? db.select({ id: invoice.id, number: invoice.number, issueDate: invoice.issueDate }).from(invoice)
          .where(and(eq(invoice.id, row.rectifiedInvoiceId), eq(invoice.companyId, companyId))).limit(1)
      : Promise.resolve([] as Array<{ id: string; number: string; issueDate: Date }>),
    getInvoiceVerifactuInfo(companyId, invoiceId),
  ]);

  // Facturas antiguas sin instantánea: los datos actuales de empresa y cliente, como hace el PDF.
  const issuer: InvoicePartySnapshot = row.issuerSnapshot ?? {
    name: row.companyName,
    legalName: row.companyLegalName,
    taxId: row.companyVatNumber,
    address: row.companyFiscalAddress,
    addressLine2: row.companyFiscalAddressLine2,
    postalCode: row.companyPostalCode,
    city: row.companyCity,
    province: row.companyProvince,
    countryCode: row.companyCountryCode,
  };
  const customerParty: InvoicePartySnapshot = row.customerSnapshot ?? {
    name: row.customerName,
    taxId: row.customerTaxId,
    address: row.customerAddress,
    addressLine2: row.customerAddressLine2,
    postalCode: row.customerPostalCode,
    city: row.customerCity,
    province: row.customerProvince,
    countryCode: row.customerCountryCode,
  };

  // Rectificativa por sustitución: el perfil de la AEAT pide la base y la cuota de la factura
  // rectificada (regla SPFE-CORE-52), que se recalculan de sus líneas guardadas con el mismo motor.
  let originalAmounts: { base: number; tax: number } | null = null;
  if (isCreditNote && original && row.rectificationType === "SUBSTITUTION") {
    const originalLines = await loadStoredLines(db, original.id);
    const totals = calculateInvoiceTotals(originalLines.map((line) => ({
      description: line.description ?? "",
      quantity: Number(line.quantity ?? 0),
      unitPrice: Number(line.unitPrice ?? 0),
      discountPct: Number(line.discountPct ?? 0),
      taxes: (line.taxes ?? []).map((tax) => ({ name: tax.name ?? null, rate: Number(tax.rate), kind: tax.kind ?? "VAT", operation: tax.operation })),
    })));
    originalAmounts = { base: totals.subtotal, tax: totals.taxAmount };
  }

  const territory = taxTerritoryOf(issuer) ?? "ES";
  const vatTreatment = isSalesVatTreatment(row.vatTreatment) ? row.vatTreatment : defaultSalesVatTreatment(customerParty.countryCode, issuer.countryCode);
  const issueDate = civilDateKey(row.issueDate);
  const legalLiterals = [
    vatTreatmentLegalNote(vatTreatment, territory, row.fiscalRegime),
    // Art. 6.1.p del Reglamento de facturación.
    row.fiscalRegime === "cash_accounting" ? "Régimen especial del criterio de caja." : null,
  ].filter((note): note is string => Boolean(note));

  const payment = paymentMethods[0] ?? (row.paymentMethodType ? { type: row.paymentMethodType, bankAccountNumber: row.paymentBankAccountNumber } : null);
  const dir3: Dir3Codes = {
    accountingOffice: row.dir3AccountingOffice,
    managingBody: row.dir3ManagingBody,
    processingUnit: row.dir3ProcessingUnit,
    proposingBody: row.dir3ProposingBody,
  };

  const data: EInvoiceData = {
    number: row.number,
    issueDate,
    operationDate: row.operationDate ? civilDateKey(row.operationDate) : null,
    dueDate: row.dueDate ? civilDateKey(row.dueDate) : null,
    currency: row.currency,
    isCreditNote,
    issuer: partyFrom(issuer),
    customer: partyFrom(customerParty),
    issuerTerritory: territory,
    lines: lines.map((line) => ({
      description: line.description ?? "",
      quantity: Number(line.quantity ?? 0),
      unitPrice: Number(line.unitPrice ?? 0),
      discountPct: Number(line.discountPct ?? 0),
      taxes: (line.taxes ?? []).map((tax) => ({ name: tax.name ?? null, rate: Number(tax.rate), kind: tax.kind ?? "VAT", operation: tax.operation })),
    })),
    storedTotal: Number(row.totalAmount),
    vatTreatment,
    vatExemptionCode: row.vatExemptionCode,
    cashAccounting: row.fiscalRegime === "cash_accounting",
    legalLiterals,
    corrective: isCreditNote
      ? {
          originalNumber: original?.number ?? "",
          originalIssueDate: original?.issueDate ? civilDateKey(original.issueDate) : null,
          reason: row.rectificationReason,
          type: row.rectificationType,
          description: row.rectificationDescription,
          originalTaxableBase: originalAmounts?.base ?? null,
          originalTaxAmount: originalAmounts?.tax ?? null,
        }
      : null,
    payment: payment ? { type: payment.type, iban: payment.bankAccountNumber, debtorIban: row.customerIban } : null,
    dir3: hasAnyDir3(dir3) ? dir3 : null,
    notes: row.notes,
    verifactuUrl: verifactu?.url ?? null,
  };
  return { data, invoiceId: row.id, number: row.number, issueDate, availability: einvoiceAvailability(territory), customerId: row.customerId };
}

// ---------------------------------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------------------------------

export type EInvoiceCertificateState = { available: boolean; message: string | null };

async function certificateState(companyId: string, now = new Date()): Promise<EInvoiceCertificateState> {
  const info = await getCompanyCertificateInfo(db, companyId);
  if (!info) {
    return { available: false, message: "La empresa no ha subido su certificado electrónico (Fiscalidad › VERI*FACTU): la factura se puede descargar sin firmar y firmarla con AutoFirma." };
  }
  if (certificateValidity(info.validTo, now).expired) {
    return { available: false, message: "El certificado electrónico de la empresa está caducado: sube uno vigente para firmar, o firma el fichero con AutoFirma." };
  }
  return { available: true, message: null };
}

/** Avisos sobre los DIR3 del cliente: faltan (si parece una Administración) o están incompletos o mal formados. */
export function dir3Warnings(data: Pick<EInvoiceData, "customer" | "dir3">): string[] {
  const warnings: string[] = [];
  const publicBody = looksLikePublicAdministration(data.customer);
  const missing = missingDir3(data.dir3);
  if (!data.dir3) {
    if (publicBody) {
      warnings.push("El NIF del cliente es de una Administración pública y su ficha no tiene los códigos DIR3 (oficina contable, órgano gestor y unidad tramitadora): FACe rechazará la factura sin ellos. Añádelos en la ficha del cliente, sección «Administración pública».");
    }
    return warnings;
  }
  if (missing.length > 0) warnings.push(`Faltan códigos DIR3 en la ficha del cliente: ${missing.join(", ")}. FACe exige los tres.`);
  const malformed = [data.dir3.accountingOffice, data.dir3.managingBody, data.dir3.processingUnit, data.dir3.proposingBody].filter((code) => code && !isValidDir3(code));
  if (malformed.length > 0) warnings.push(`Algún código DIR3 no tiene la forma habitual (9 caracteres): ${malformed.join(", ")}.`);
  return warnings;
}

export type EInvoiceDocumentInfo = {
  id: string;
  format: EInvoiceFormat;
  formatVersion: string;
  signed: boolean;
  signerSubject: string | null;
  sha256: string;
  fileName: string;
  generatedAt: Date;
  /** DIR3 e IBAN de domiciliación que se usaron al generar (de la ficha del cliente en ese momento). */
  dir3Codes: Dir3Codes | null;
  customerIban: string | null;
  face: FaceSubmissionInfo | null;
};

/** Remisión del Facturae firmado a FACe y último estado conocido. */
export type FaceSubmissionInfo = {
  environment: string | null;
  registryNumber: string | null;
  submittedAt: Date | null;
  contactEmail: string | null;
  processing: { code: string; description: string | null; reason: string | null } | null;
  cancellation: { code: string; description: string | null; reason: string | null } | null;
  checkedAt: Date | null;
  lastError: string | null;
};

export type EInvoiceStatusRow = EInvoiceStatusEvent & { id: string; createdAt: Date; deadline: string | null };

export type EInvoiceOverview = {
  availability: EInvoiceAvailability;
  /** El cliente tiene DIR3 o NIF de Administración: el destino natural es FACe. */
  publicAdministration: boolean;
  facturae: { problems: string[]; warnings: string[] };
  ubl: { problems: string[]; warnings: string[] };
  ublAeat: { problems: string[]; warnings: string[] };
  certificate: EInvoiceCertificateState;
  documents: EInvoiceDocumentInfo[];
  statuses: EInvoiceStatusRow[];
  summary: EInvoiceStatusSummary;
  issueDate: string;
};

export function faceInfo(document: typeof einvoiceDocument.$inferSelect): FaceSubmissionInfo | null {
  if (!document.faceRegistryNumber && !document.faceLastError) return null;
  return {
    environment: document.faceEnvironment,
    registryNumber: document.faceRegistryNumber,
    submittedAt: document.faceSubmittedAt,
    contactEmail: document.faceContactEmail,
    processing: document.faceProcessingCode ? { code: document.faceProcessingCode, description: document.faceProcessingDescription, reason: document.faceProcessingReason } : null,
    cancellation: document.faceCancellationCode ? { code: document.faceCancellationCode, description: document.faceCancellationDescription, reason: document.faceCancellationReason } : null,
    checkedAt: document.faceCheckedAt,
    lastError: document.faceLastError,
  };
}

function warningsOf(build: () => { warnings: string[] }): string[] {
  try {
    return build().warnings;
  } catch {
    return [];
  }
}

/** Todo lo que la ficha de la factura necesita para ofrecer la factura electrónica, sin generar ficheros. */
export async function getEInvoiceOverview(companyId: string, invoiceId: string): Promise<EInvoiceOverview | null> {
  let loaded: LoadedInvoice | null;
  try {
    loaded = await loadEInvoice(companyId, invoiceId);
  } catch (error) {
    if (error instanceof HttpError) return null;
    throw error;
  }
  if (!loaded) return null;
  const { data, availability } = loaded;
  const [certificate, documents, statuses] = await Promise.all([
    certificateState(companyId),
    db.select().from(einvoiceDocument)
      .where(and(eq(einvoiceDocument.companyId, companyId), eq(einvoiceDocument.invoiceId, invoiceId)))
      .orderBy(desc(einvoiceDocument.generatedAt)),
    listEInvoiceStatuses(companyId, invoiceId),
  ]);
  return {
    availability,
    publicAdministration: Boolean(data.dir3) || looksLikePublicAdministration(data.customer),
    facturae: availability.facturae
      ? { problems: facturaeProblems(data), warnings: [...dir3Warnings(data), ...warningsOf(() => buildFacturaeXml(data))] }
      : { problems: [], warnings: [] },
    ubl: availability.ubl ? { problems: ublProblems(data), warnings: warningsOf(() => buildUblXml(data)) } : { problems: [], warnings: [] },
    ublAeat: availability.ublAeat ? { problems: ublProblems(data, "SPFE"), warnings: warningsOf(() => buildUblXml(data, "SPFE")) } : { problems: [], warnings: [] },
    certificate,
    documents: documents.map((document) => ({
      id: document.id,
      format: EINVOICE_FORMATS.find((format) => format === document.format) ?? "FACTURAE",
      formatVersion: document.formatVersion,
      signed: document.signed,
      signerSubject: document.signerSubject,
      sha256: document.sha256,
      fileName: document.fileName,
      generatedAt: document.generatedAt,
      dir3Codes: document.dir3Codes ?? null,
      customerIban: document.customerIban,
      face: faceInfo(document),
    })),
    statuses,
    summary: summarizeEInvoiceStatus(statuses),
    issueDate: loaded.issueDate,
  };
}

// ---------------------------------------------------------------------------------------------
// Generación y conservación
// ---------------------------------------------------------------------------------------------

export type GeneratedEInvoice = { bytes: Buffer; fileName: string; contentType: string; sha256: string; signed: boolean; warnings: string[] };

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function problemsToHttp(error: unknown): never {
  if (error instanceof EInvoiceError) throw new HttpError(422, `No se puede generar la factura electrónica. ${error.problems.join(" ")}`);
  throw error;
}

/**
 * Genera (o recupera) la factura electrónica de una factura emitida y la conserva.
 *
 * - Sin firma: el fichero es determinista; se guarda la primera vez y después se sirve esa copia
 *   mientras siga coincidiendo con lo que se generaría hoy.
 * - Con firma: se reutiliza la copia firmada conservada mientras lo firmado siga siendo la factura
 *   actual; si no (o con `regenerate`), se firma de nuevo y se sustituye. Antes de entregarla se
 *   comprueba que la firma verifica: nunca sale un fichero con una firma inválida.
 */
export async function generateEInvoice(
  actor: EInvoiceActor,
  invoiceId: string,
  options: { format: EInvoiceFormat; signed?: boolean; regenerate?: boolean },
  now = new Date(),
): Promise<GeneratedEInvoice | null> {
  const loaded = await loadEInvoice(actor.companyId, invoiceId);
  if (!loaded) return null;
  const { data, availability } = loaded;
  const signed = options.format === "FACTURAE" && Boolean(options.signed);
  if (options.format === "FACTURAE" && !availability.facturae) throw new HttpError(404, "Facturae no está disponible para esta empresa.");
  if (options.format === "UBL" && !availability.ubl) throw new HttpError(404, "La factura UBL no está disponible para esta empresa.");
  if (options.format === "UBL_AEAT" && !availability.ublAeat) throw new HttpError(404, "El perfil UBL de la solución pública de la AEAT no está disponible para esta empresa.");

  let built: { xml: string; warnings: string[]; fileName: string };
  try {
    built = options.format === "UBL" ? buildUblXml(data) : options.format === "UBL_AEAT" ? buildUblXml(data, "SPFE") : buildFacturaeXml(data);
  } catch (error) {
    problemsToHttp(error);
  }
  const warnings = options.format === "FACTURAE" ? [...dir3Warnings(data), ...built.warnings] : built.warnings;
  const contentType = "application/xml; charset=utf-8";

  const [existing] = await db.select().from(einvoiceDocument)
    .where(and(eq(einvoiceDocument.invoiceId, invoiceId), eq(einvoiceDocument.companyId, actor.companyId), eq(einvoiceDocument.format, options.format), eq(einvoiceDocument.signed, signed)))
    .limit(1);
  // Lo remitido a FACe queda congelado: es el documento registrado por la Administración y no se
  // sustituye (para corregirlo hay que anularlo en FACe y emitir una rectificativa).
  if (existing?.faceRegistryNumber) {
    if (options.regenerate) throw new HttpError(409, `Esta factura ya se remitió a FACe (registro ${existing.faceRegistryNumber}): no se vuelve a firmar. Si hay que corregirla, solicita su anulación en FACe y emite una rectificativa.`);
    const stored = await readPrivateFile(existing.storageKey);
    return { bytes: stored, fileName: existing.fileName, contentType, sha256: existing.sha256, signed, warnings };
  }
  if (existing && !options.regenerate) {
    try {
      const stored = await readPrivateFile(existing.storageKey);
      const text = stored.toString("utf8");
      const stillCurrent = signed ? unsignedFacturae(text) === built.xml && verifyFacturaeSignature(text).valid : text === built.xml;
      if (stillCurrent && sha256(stored) === existing.sha256) {
        return { bytes: stored, fileName: existing.fileName, contentType, sha256: existing.sha256, signed, warnings };
      }
    } catch {
      // Copia ilegible o perdida: se genera de nuevo.
    }
  }

  let xml = built.xml;
  let signerSubject: string | null = null;
  if (signed) {
    const credentials = await loadCompanyCredentials(db, actor.companyId);
    if (!credentials) throw new HttpError(409, "La empresa no ha subido su certificado electrónico: descarga la factura sin firmar y fírmala con AutoFirma, o sube el certificado en Fiscalidad › VERI*FACTU.");
    if (certificateValidity(credentials.validTo, now).expired) throw new HttpError(409, "El certificado electrónico de la empresa está caducado: sube uno vigente o firma el fichero con AutoFirma.");
    try {
      const material = extractSigningMaterial(credentials.pfx, credentials.passphrase);
      xml = signFacturae(built.xml, { privateKey: material.privateKey, certificateDer: material.certificateDer, signingTime: now });
      signerSubject = material.certificate.subject.split("\n").map((part) => part.trim()).filter(Boolean).join(", ").slice(0, 500);
    } catch (error) {
      if (error instanceof Pkcs12Error || error instanceof XadesError) throw new HttpError(422, error.message);
      throw error;
    }
    const verification = verifyFacturaeSignature(xml);
    if (!verification.valid) throw new HttpError(500, "La firma generada no ha superado la comprobación y no se entrega. Descarga la factura sin firmar y fírmala con AutoFirma.");
  }

  const bytes = Buffer.from(xml, "utf8");
  const hash = sha256(bytes);
  // FACe admite .xml y .xsig; la extensión .xsig distingue a simple vista el fichero firmado.
  const fileName = signed ? built.fileName.replace(/\.xml$/, ".xsig") : built.fileName;
  const storageKey = await storePrivateFile({
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    folder: "einvoice",
    fileName: `${invoiceId}-${options.format.toLowerCase()}${signed ? "-firmada" : ""}.xml`,
    contentType: "application/xml",
    body: bytes,
  });
  const values = {
    formatVersion: options.format === "UBL" ? `2.1 · ${UBL_CUSTOMIZATION_ID}` : options.format === "UBL_AEAT" ? `2.5 · ${UBL_SPFE_CUSTOMIZATION_ID}` : FACTURAE_VERSION,
    signerSubject,
    sha256: hash,
    storageKey,
    fileName,
    status: "GENERATED",
    // Valores de la ficha del cliente que entraron en el fichero (solo Facturae los usa).
    dir3Codes: options.format === "FACTURAE" ? data.dir3 ?? null : null,
    customerIban: options.format === "FACTURAE" && data.payment?.type === "DIRECT_DEBIT" ? data.payment.debtorIban?.trim() || null : null,
    generatedByUserId: actor.actorUserId,
    generatedAt: now,
  };
  await db.transaction(async (tx) => {
    await tx.insert(einvoiceDocument)
      .values({ companyId: actor.companyId, invoiceId, format: options.format, signed, ...values })
      .onConflictDoUpdate({ target: [einvoiceDocument.invoiceId, einvoiceDocument.format, einvoiceDocument.signed], set: values });
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "einvoice.generate",
      entityName: "invoice",
      entityId: invoiceId,
      payload: { format: options.format, signed, sha256: hash, fileName, signerSubject, dir3Codes: values.dir3Codes, customerIban: values.customerIban },
    }, tx);
  });
  return { bytes, fileName, contentType, sha256: hash, signed, warnings };
}

// ---------------------------------------------------------------------------------------------
// Estados (art. 10 RD 238/2026)
// ---------------------------------------------------------------------------------------------

export async function listEInvoiceStatuses(companyId: string, invoiceId: string): Promise<EInvoiceStatusRow[]> {
  const rows = await db.select().from(einvoiceStatusEvent)
    .where(and(eq(einvoiceStatusEvent.companyId, companyId), eq(einvoiceStatusEvent.invoiceId, invoiceId)))
    .orderBy(asc(einvoiceStatusEvent.createdAt));
  return rows.filter((row) => isEInvoiceStatus(row.status)).map((row) => ({
    id: row.id,
    status: row.status as EInvoiceStatus,
    effectiveDate: row.effectiveDate,
    rejectionCode: row.rejectionCode,
    reason: row.reason,
    createdAt: row.createdAt,
    // Plazo en que el cliente debía comunicarlo (aceptación, rechazo o pago).
    deadline: row.status === "ACCEPTED" || row.status === "REJECTED" || row.status === "PAID" ? statusCommunicationDeadline(row.effectiveDate) : null,
  }));
}

/** Anota un estado en el historial de la factura. Devuelve el historial actualizado. */
export async function addEInvoiceStatus(
  actor: EInvoiceActor,
  invoiceId: string,
  input: EInvoiceStatusEvent,
  now = new Date(),
): Promise<{ statuses: EInvoiceStatusRow[]; summary: EInvoiceStatusSummary } | null> {
  const loaded = await loadEInvoice(actor.companyId, invoiceId);
  if (!loaded) return null;
  if (!loaded.availability.statuses) throw new HttpError(404, "El registro de estados de la factura electrónica no está disponible para esta empresa.");
  const history = await listEInvoiceStatuses(actor.companyId, invoiceId);
  const event: EInvoiceStatusEvent = {
    status: input.status,
    effectiveDate: input.effectiveDate,
    rejectionCode: input.status === "REJECTED" ? input.rejectionCode?.trim() || null : null,
    reason: input.status === "REJECTED" ? input.reason?.trim().slice(0, 1000) || null : null,
  };
  const problem = einvoiceStatusProblem(event, { history, issueDate: loaded.issueDate, today: civilDateKey(now) });
  if (problem) throw new HttpError(422, problem);
  await db.transaction(async (tx) => {
    const [created] = await tx.insert(einvoiceStatusEvent)
      .values({ companyId: actor.companyId, invoiceId, ...event, source: "MANUAL", createdByUserId: actor.actorUserId, createdAt: now })
      .returning({ id: einvoiceStatusEvent.id });
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "einvoice.status.add",
      entityName: "invoice",
      entityId: invoiceId,
      payload: { ...event, eventId: created?.id },
    }, tx);
  });
  const statuses = await listEInvoiceStatuses(actor.companyId, invoiceId);
  return { statuses, summary: summarizeEInvoiceStatus(statuses) };
}

/**
 * Mensaje UBL «ApplicationResponse» con el que el EMISOR comunica el cobro (SETTLEMENT) de la
 * factura a la solución pública de la AEAT (anexo II de la Orden HAC/1028/2026), a partir del
 * estado «Pagada» anotado. Del resto de estados no hay mensaje del emisor: el rechazo y el pago los
 * comunica el cliente, y la aceptación es tácita. La aplicación no lo remite: se descarga.
 */
export async function getEInvoiceStatusMessage(companyId: string, invoiceId: string, eventId: string, now = new Date()): Promise<{ xml: string; fileName: string } | null> {
  const loaded = await loadEInvoice(companyId, invoiceId);
  if (!loaded) return null;
  if (!loaded.availability.statuses) throw new HttpError(404, "Los mensajes de estado de la factura electrónica no están disponibles para esta empresa.");
  const event = (await listEInvoiceStatuses(companyId, invoiceId)).find((entry) => entry.id === eventId);
  if (!event) return null;
  if (event.status !== "PAID") {
    throw new HttpError(409, "Solo el cobro tiene mensaje del emisor para la solución pública de la AEAT: el rechazo y el pago los comunica el cliente, y la aceptación no se comunica.");
  }
  const messageDate = civilDateKey(now);
  try {
    return buildSpfeStatusMessage({
      code: "SETTLEMENT",
      messageId: `SETTLEMENT-${messageDate.replace(/-/g, "")}-${event.id.slice(0, 8)}`,
      messageDate,
      effectiveDate: event.effectiveDate,
      dueDate: loaded.data.dueDate ?? null,
      invoice: {
        number: loaded.data.number,
        issueDate: loaded.data.issueDate,
        issuerTaxId: partyTaxNumber(loaded.data.issuer),
        issuerName: (loaded.data.issuer.legalName?.trim() || loaded.data.issuer.name || "").trim(),
        payableAmount: loaded.data.storedTotal,
        isCreditNote: loaded.data.isCreditNote,
      },
    });
  } catch (error) {
    if (error instanceof EInvoiceError) throw new HttpError(422, `No se puede generar el mensaje de cobro. ${error.problems.join(" ")}`);
    throw error;
  }
}
