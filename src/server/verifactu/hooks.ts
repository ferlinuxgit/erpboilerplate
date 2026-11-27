import { and, desc, eq, inArray } from "drizzle-orm";

import { invoice, verifactuRecord, type InvoicePartySnapshot } from "@/db/schema";
import type { DbClient } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { taxTerritoryOf } from "@/lib/country-packs/territory";
import type { InvoiceTotals } from "@/lib/invoice-totals";
import { appendAltaRecord, appendAnulacionRecord, type VerifactuRecordRow } from "@/server/verifactu/chain";
import { getVerifactuSystemInfo, isVerifactuEnvironment, requireVerifactuEnvironment, verifactuEnvironmentLabels } from "@/server/verifactu/config";
import { formatAeatDate, isValidIssuerNifFormat, normalizeIssuerNif } from "@/server/verifactu/format";
import { mapInvoiceToAlta, SIMPLIFIED_INVOICE_HARD_LIMIT, verifactuTaxCodeFor, type SalesTreatment } from "@/server/verifactu/mapping";
import { getVerifactuSettings, recordModeFor } from "@/server/verifactu/settings";
import { assertAltaContentSendable, assertVerifactuSeriesNumber, subsanacionBlockFor } from "@/server/verifactu/validation";

/**
 * Puntos de enganche con el ciclo de vida de facturas. Se llaman DENTRO de la transacción de
 * emisión / rectificación / anulación: si el registro no se puede crear, la emisión entera se
 * deshace (no puede existir una factura emitida sin su registro de facturación).
 */

export type IssuedInvoiceHookInput = {
  companyId: string;
  invoiceId: string;
  number: string;
  issueDate: Date;
  invoiceType: string;
  rectificationReason: string | null;
  rectificationDescription: string | null;
  vatTreatment: SalesTreatment;
  issuer: InvoicePartySnapshot;
  customer: InvoicePartySnapshot | null;
  totals: Pick<InvoiceTotals, "subtotal" | "taxBuckets">;
  lineDescriptions: string[];
  original: { id: string; number: string; issueDate: Date } | null;
  /** Clase de documento con la que se emite (completa, simplificada o simplificada con destinatario). */
  documentClass?: "FULL" | "SIMPLIFIED" | "SIMPLIFIED_QUALIFIED" | null;
  /** Simplificadas a las que sustituye esta factura (canje): el registro es de tipo F3. */
  substituted?: Array<{ id: string; number: string; issueDate: Date }> | null;
  /** Fecha de la operación, si es distinta de la de expedición. */
  operationDate?: Date | null;
  /** Causa de exención o de no sujeción elegida en la factura (E1–E6, N1, N2). */
  exemptionCode?: string | null;
  /** Instante real de la emisión (por defecto, ahora). Decide si la factura debe llevar registro. */
  issuedAt?: Date;
};

/** La modalidad heredada sin remisión no genera registros conformes: ya no se emite con ella. */
export const LEGACY_MODE_BLOCKED_MESSAGE =
  "Esta empresa sigue en la modalidad NO VERI*FACTU, que ya no está disponible: sus registros no cumplirían la norma (irían sin firma electrónica). "
  + "Activa VERI*FACTU en Configuración › Fiscalidad para poder emitir o anular facturas.";

async function latestRecordForInvoice(tx: DbClient, companyId: string, invoiceId: string) {
  const [row] = await tx
    .select({
      recordType: verifactuRecord.recordType,
      issuerTaxId: verifactuRecord.issuerTaxId,
      issuerName: verifactuRecord.issuerName,
      invoiceNumber: verifactuRecord.invoiceNumber,
      invoiceIssueDate: verifactuRecord.invoiceIssueDate,
      invoiceTypeCode: verifactuRecord.invoiceTypeCode,
      status: verifactuRecord.status,
      mode: verifactuRecord.mode,
      environment: verifactuRecord.environment,
      aeatErrorCode: verifactuRecord.aeatErrorCode,
      aeatErrorMessage: verifactuRecord.aeatErrorMessage,
    })
    .from(verifactuRecord)
    .where(and(eq(verifactuRecord.companyId, companyId), eq(verifactuRecord.invoiceId, invoiceId)))
    // La secuencia es por entorno: entre registros de entornos distintos manda la fecha de generación.
    .orderBy(desc(verifactuRecord.generatedAt), desc(verifactuRecord.sequence))
    .limit(1);
  return row ?? null;
}

function operationDescription(input: IssuedInvoiceHookInput) {
  if (input.invoiceType === "CREDIT_NOTE") {
    return `Rectificación de la factura ${input.original?.number ?? ""}. ${input.rectificationDescription ?? ""}`.trim();
  }
  const descriptions = [...new Set(input.lineDescriptions.map((line) => line.trim()).filter(Boolean))];
  return descriptions.join("; ") || `Factura ${input.number}`;
}

/**
 * ¿Debe llevar registro una factura que se emite en `issuedAt`? Lo decide el instante REAL de la
 * emisión, nunca la fecha de expedición que figure en la factura: un borrador fechado antes de la
 * fecha de inicio pero emitido después se registra igual (si no, saldría sin registro ni QR y
 * fuera de la cadena).
 */
export function mustRegisterAt(since: Date | null, issuedAt: Date) {
  return !since || issuedAt.getTime() >= since.getTime();
}

/** Registro de alta de una factura o rectificativa recién emitida (null si VeriFactu no está activo). */
export async function registerIssuedInvoiceRecord(tx: DbClient, input: IssuedInvoiceHookInput): Promise<VerifactuRecordRow | null> {
  const settings = await getVerifactuSettings(tx, input.companyId);
  const mode = recordModeFor(settings.mode);
  if (!mode) return null;
  if (mode !== "VERIFACTU") throw new HttpError(409, LEGACY_MODE_BLOCKED_MESSAGE);
  if (!mustRegisterAt(settings.since, input.issuedAt ?? new Date())) return null;
  return appendAltaFor(tx, input, settings, mode, {});
}

/**
 * Alta de subsanación: corrige el registro de una factura que la AEAT rechazó o aceptó con errores.
 * Es un registro nuevo, encadenado como cualquier otro (el anterior no se toca), con
 * `Subsanacion = S` y, si hubo rechazo, `RechazoPrevio`: "X" cuando la factura no consta en la AEAT
 * (su alta fue rechazada) y "S" cuando sí consta y lo rechazado fue una subsanación anterior.
 */
export async function registerSubsanacionRecord(tx: DbClient, input: IssuedInvoiceHookInput): Promise<VerifactuRecordRow> {
  const settings = await getVerifactuSettings(tx, input.companyId);
  if (recordModeFor(settings.mode) !== "VERIFACTU") throw new HttpError(409, "VERI*FACTU no está activo en esta empresa.");
  const latest = await latestRecordForInvoice(tx, input.companyId, input.invoiceId);
  if (!latest || latest.recordType !== "ALTA") throw new HttpError(409, "Esta factura no tiene un registro de alta que subsanar.");
  if (latest.status !== "REJECTED" && latest.status !== "ACCEPTED_WITH_ERRORS") {
    throw new HttpError(409, "Solo se subsanan los registros rechazados o aceptados con errores por la AEAT.");
  }
  const environment = requireVerifactuEnvironment();
  if (latest.environment !== environment) {
    const recordEnvironment = isVerifactuEnvironment(latest.environment) ? verifactuEnvironmentLabels[latest.environment] : latest.environment;
    throw new HttpError(409, `Este registro es del entorno de ${recordEnvironment} de la AEAT y este servidor trabaja en ${verifactuEnvironmentLabels[environment]}: no se puede subsanar desde aquí.`);
  }
  const block = subsanacionBlockFor({ code: latest.aeatErrorCode, message: latest.aeatErrorMessage });
  if (block) throw new HttpError(409, block.message);
  let rechazoPrevio: "S" | "X" | null = null;
  if (latest.status === "REJECTED") {
    const [known] = await tx
      .select({ id: verifactuRecord.id })
      .from(verifactuRecord)
      .where(and(
        eq(verifactuRecord.companyId, input.companyId),
        eq(verifactuRecord.invoiceId, input.invoiceId),
        eq(verifactuRecord.recordType, "ALTA"),
        inArray(verifactuRecord.status, ["ACCEPTED", "ACCEPTED_WITH_ERRORS"]),
      ))
      .limit(1);
    rechazoPrevio = known ? "S" : "X";
  }
  // El registro conserva la identificación con la que la factura se registró la primera vez, y su
  // tipo: la clase de documento y las simplificadas sustituidas se leen de la factura emitida.
  const frozen = input.documentClass === undefined && input.substituted === undefined ? await frozenDocumentKind(tx, input.companyId, input.invoiceId) : {};
  return appendAltaFor(tx, { ...input, ...frozen, number: latest.invoiceNumber }, settings, "VERIFACTU", { subsanacion: "S", rechazoPrevio });
}

/** Clase de documento y simplificadas sustituidas tal y como quedaron al emitir la factura. */
async function frozenDocumentKind(tx: DbClient, companyId: string, invoiceId: string): Promise<Pick<IssuedInvoiceHookInput, "documentClass" | "substituted">> {
  const [row] = await tx
    .select({ documentClass: invoice.documentClass, substitutesInvoiceIds: invoice.substitutesInvoiceIds })
    .from(invoice)
    .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId)))
    .limit(1);
  const ids = row?.substitutesInvoiceIds ?? [];
  const substituted = ids.length > 0
    ? await tx
        .select({ id: invoice.id, number: invoice.number, issueDate: invoice.issueDate })
        .from(invoice)
        .where(and(eq(invoice.companyId, companyId), inArray(invoice.id, ids)))
    : [];
  return {
    documentClass: row?.documentClass === "FULL" || row?.documentClass === "SIMPLIFIED" || row?.documentClass === "SIMPLIFIED_QUALIFIED" ? row.documentClass : null,
    substituted: substituted.length > 0 ? substituted : null,
  };
}

async function appendAltaFor(
  tx: DbClient,
  input: IssuedInvoiceHookInput,
  settings: Awaited<ReturnType<typeof getVerifactuSettings>>,
  mode: "VERIFACTU" | "NO_VERIFACTU",
  flags: { subsanacion?: "S" | null; rechazoPrevio?: "S" | "X" | null },
): Promise<VerifactuRecordRow> {
  const issuerTaxId = normalizeIssuerNif(input.issuer.taxId?.trim() || settings.issuerTaxId);
  if (!isValidIssuerNifFormat(issuerTaxId)) {
    throw new HttpError(422, "VeriFactu está activo y la empresa no tiene un NIF válido: complétalo en Configuración › Empresa antes de emitir.");
  }
  const issuerName = (input.issuer.legalName?.trim() || input.issuer.name || settings.issuerName).slice(0, 120);
  // El registro nace en el entorno de este despliegue; sin entorno declarado no se emite.
  const environment = requireVerifactuEnvironment();
  // Todo lo que la AEAT rechazaría sin remedio se comprueba aquí, antes de que la factura quede emitida.
  assertVerifactuSeriesNumber(input.number);

  let original: { issuerTaxId: string; invoiceNumber: string; invoiceIssueDate: string; invoiceTypeCode: string | null } | null = null;
  if (input.original) {
    const originalRecord = await latestRecordForInvoice(tx, input.companyId, input.original.id);
    original = originalRecord && originalRecord.recordType === "ALTA"
      ? originalRecord
      : { issuerTaxId, invoiceNumber: input.original.number, invoiceIssueDate: formatAeatDate(input.original.issueDate), invoiceTypeCode: null };
  }

  // Canje: cada simplificada se identifica tal y como consta en su registro (o, si es anterior a
  // VERI*FACTU, con su número y fecha).
  const substituted: Array<{ issuerTaxId: string; invoiceNumber: string; invoiceIssueDate: string }> = [];
  for (const entry of input.substituted ?? []) {
    const record = await latestRecordForInvoice(tx, input.companyId, entry.id);
    substituted.push(record && record.recordType === "ALTA"
      ? { issuerTaxId: record.issuerTaxId, invoiceNumber: record.invoiceNumber, invoiceIssueDate: record.invoiceIssueDate }
      : { issuerTaxId, invoiceNumber: entry.number, invoiceIssueDate: formatAeatDate(entry.issueDate) });
  }

  const content = mapInvoiceToAlta({
    // Canarias (IGIC, 03), Ceuta y Melilla (IPSI, 02): según el domicilio fiscal del emisor.
    taxCode: verifactuTaxCodeFor(taxTerritoryOf(input.issuer)),
    invoiceType: input.invoiceType,
    rectificationReason: input.rectificationReason,
    vatTreatment: input.vatTreatment,
    customer: input.customer ? { name: input.customer.legalName?.trim() || input.customer.name, taxId: input.customer.taxId, countryCode: input.customer.countryCode } : null,
    totals: input.totals,
    description: operationDescription(input),
    exemptionCode: input.exemptionCode,
    documentClass: input.documentClass ?? null,
    substituted: substituted.length > 0 ? substituted : null,
    operationDate: input.operationDate && formatAeatDate(input.operationDate) !== formatAeatDate(input.issueDate) ? formatAeatDate(input.operationDate) : null,
    original,
  });
  if (substituted.length > 0 && content.invoiceTypeCode !== "F3") {
    throw new HttpError(422, "La factura que sustituye a una simplificada debe identificar al destinatario: completa el NIF del cliente.");
  }
  assertAltaContentSendable(content, formatAeatDate(input.issueDate));
  // La AEAT rechaza una simplificada por encima del límite legal: mejor avisar antes de emitir.
  if (content.invoiceTypeCode === "F2" && Math.abs(Number(content.totalAmount)) > SIMPLIFIED_INVOICE_HARD_LIMIT) {
    throw new HttpError(422, `Una factura de más de ${SIMPLIFIED_INVOICE_HARD_LIMIT.toLocaleString("es-ES")} € necesita el NIF del cliente: sin él sería una factura simplificada y supera el límite legal. Completa el NIF en la ficha del cliente.`);
  }

  return appendAltaRecord(tx, {
    companyId: input.companyId,
    invoiceId: input.invoiceId,
    mode,
    environment,
    issuerTaxId,
    issuerName,
    invoiceNumber: input.number,
    invoiceIssueDate: formatAeatDate(input.issueDate),
    systemInfo: getVerifactuSystemInfo(input.companyId),
    content,
    ...flags,
  });
}

/**
 * Registro de anulación: solo si la factura tiene un alta vigente (el último registro es un alta).
 * Los borradores no tienen registro, así que anular un borrador no genera nada.
 */
export async function registerInvoiceAnnulmentRecord(tx: DbClient, input: { companyId: string; invoiceId: string }): Promise<VerifactuRecordRow | null> {
  const latest = await latestRecordForInvoice(tx, input.companyId, input.invoiceId);
  if (!latest || latest.recordType !== "ALTA") return null;
  const settings = await getVerifactuSettings(tx, input.companyId);
  if (recordModeFor(settings.mode) === "NO_VERIFACTU") throw new HttpError(409, LEGACY_MODE_BLOCKED_MESSAGE);
  // La anulación va a la cadena del entorno en el que nació el alta que anula (un alta de pruebas
  // no se anula en producción). Si ese entorno no es el de este despliegue, no se enviará desde aquí.
  const environment = isVerifactuEnvironment(latest.environment) ? latest.environment : requireVerifactuEnvironment();
  return appendAnulacionRecord(tx, {
    companyId: input.companyId,
    invoiceId: input.invoiceId,
    mode: "VERIFACTU",
    environment,
    issuerTaxId: latest.issuerTaxId,
    issuerName: latest.issuerName,
    invoiceNumber: latest.invoiceNumber,
    invoiceIssueDate: latest.invoiceIssueDate,
    systemInfo: getVerifactuSystemInfo(input.companyId),
  });
}
