import { and, desc, eq, inArray } from "drizzle-orm";

import { verifactuRecord, type InvoicePartySnapshot } from "@/db/schema";
import type { DbClient } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { taxTerritoryOf } from "@/lib/country-packs/territory";
import type { InvoiceTotals } from "@/lib/invoice-totals";
import { appendAltaRecord, appendAnulacionRecord, type VerifactuRecordRow } from "@/server/verifactu/chain";
import { getVerifactuSystemInfo } from "@/server/verifactu/config";
import { formatAeatDate, isValidIssuerNifFormat, normalizeIssuerNif } from "@/server/verifactu/format";
import { mapInvoiceToAlta, SIMPLIFIED_INVOICE_HARD_LIMIT, verifactuTaxCodeFor, type SalesTreatment } from "@/server/verifactu/mapping";
import { getVerifactuSettings, recordModeFor } from "@/server/verifactu/settings";

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
  /** Fecha de la operación, si es distinta de la de expedición. */
  operationDate?: Date | null;
  /** Causa de exención o de no sujeción elegida en la factura (E1–E6, N1, N2). */
  exemptionCode?: string | null;
};

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
    })
    .from(verifactuRecord)
    .where(and(eq(verifactuRecord.companyId, companyId), eq(verifactuRecord.invoiceId, invoiceId)))
    .orderBy(desc(verifactuRecord.sequence))
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

/** Registro de alta de una factura o rectificativa recién emitida (null si VeriFactu no está activo). */
export async function registerIssuedInvoiceRecord(tx: DbClient, input: IssuedInvoiceHookInput): Promise<VerifactuRecordRow | null> {
  const settings = await getVerifactuSettings(tx, input.companyId);
  const mode = recordModeFor(settings.mode);
  if (!mode) return null;
  if (settings.since && input.issueDate.getTime() < settings.since.getTime()) return null;
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
  // El registro conserva la identificación con la que la factura se registró la primera vez.
  return appendAltaFor(tx, { ...input, number: latest.invoiceNumber }, settings, "VERIFACTU", { subsanacion: "S", rechazoPrevio });
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

  let original: { issuerTaxId: string; invoiceNumber: string; invoiceIssueDate: string; invoiceTypeCode: string | null } | null = null;
  if (input.original) {
    const originalRecord = await latestRecordForInvoice(tx, input.companyId, input.original.id);
    original = originalRecord && originalRecord.recordType === "ALTA"
      ? originalRecord
      : { issuerTaxId, invoiceNumber: input.original.number, invoiceIssueDate: formatAeatDate(input.original.issueDate), invoiceTypeCode: null };
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
    operationDate: input.operationDate && formatAeatDate(input.operationDate) !== formatAeatDate(input.issueDate) ? formatAeatDate(input.operationDate) : null,
    original,
  });
  // La AEAT rechaza una simplificada por encima del límite legal: mejor avisar antes de emitir.
  if (content.invoiceTypeCode === "F2" && Math.abs(Number(content.totalAmount)) > SIMPLIFIED_INVOICE_HARD_LIMIT) {
    throw new HttpError(422, `Una factura de más de ${SIMPLIFIED_INVOICE_HARD_LIMIT.toLocaleString("es-ES")} € necesita el NIF del cliente: sin él sería una factura simplificada y supera el límite legal. Completa el NIF en la ficha del cliente.`);
  }

  return appendAltaRecord(tx, {
    companyId: input.companyId,
    invoiceId: input.invoiceId,
    mode,
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
  const mode = recordModeFor(settings.mode) ?? "VERIFACTU";
  return appendAnulacionRecord(tx, {
    companyId: input.companyId,
    invoiceId: input.invoiceId,
    mode,
    issuerTaxId: latest.issuerTaxId,
    issuerName: latest.issuerName,
    invoiceNumber: latest.invoiceNumber,
    invoiceIssueDate: latest.invoiceIssueDate,
    systemInfo: getVerifactuSystemInfo(input.companyId),
  });
}
