import { and, eq, gt, isNotNull, sql } from "drizzle-orm";

import { accountChart, company, partner, supplierInvoice, supplierInvoiceLine } from "@/db/schema";
import { db } from "@/lib/db";
import { fiscalTimeZoneFor, isSpanishFiscalModelCode, parseSpanishFiscalPeriod } from "@/lib/fiscal-spain";
import { HttpError } from "@/lib/http";
import { recordAudit } from "@/server/audit";
import { FiscalFileError, normalizeSpanishNif, type Declarant, type FiscalFile } from "@/server/fiscal-files/fields";
import { buildPresentationFile, hasPresentationFile, type PresentationExtras, type PresentationOptions } from "@/server/fiscal-files/presentation";
import { assertCountryFeature } from "@/server/fiscal/country-guard";
import { getFiscalReport, resolveFiscalReportSummary, type FiscalSummarySource } from "@/server/fiscal/service";
import { supplierInvoiceFiscalFilter, type SpanishFiscalSummary } from "@/server/fiscal/spain";

/**
 * Perceptores con retención del periodo: proveedores distintos con alguna línea con retención en
 * las facturas recibidas que computan en él. Mismo reparto que el cálculo del modelo: gasto en la
 * cuenta 621 (arrendamientos) → 115; el resto (profesionales) → 111.
 */
async function countWithholdingRecipients(companyId: string, code: "111" | "115", period: string, timeZone: string) {
  const range = parseSpanishFiscalPeriod(period, code);
  if (!range) return 0;
  const isRent = sql`coalesce(${accountChart.code}, '') like '621%'`;
  const [row] = await db
    .select({ recipients: sql<number>`count(distinct ${supplierInvoice.supplierPartnerId})::int` })
    .from(supplierInvoiceLine)
    .innerJoin(supplierInvoice, eq(supplierInvoiceLine.supplierInvoiceId, supplierInvoice.id))
    .leftJoin(accountChart, eq(accountChart.id, supplierInvoiceLine.expenseAccountId))
    .where(and(
      supplierInvoiceFiscalFilter(companyId, range.start, range.endExclusive, timeZone),
      gt(supplierInvoiceLine.retentionAmount, "0"),
      code === "115" ? isRent : sql`not ${isRent}`,
    ));
  return Number(row?.recipients ?? 0);
}

/** País y código postal de los terceros de la empresa, por NIF normalizado (para el 347). */
async function loadPartyAddresses(companyId: string) {
  const rows = await db
    .select({ taxId: partner.taxId, countryCode: partner.countryCode, postalCode: partner.postalCode })
    .from(partner)
    .where(and(eq(partner.companyId, companyId), isNotNull(partner.taxId)));
  const addresses = new Map<string, { countryCode: string | null; postalCode: string | null }>();
  for (const row of rows) {
    const key = normalizeSpanishNif(row.taxId);
    if (!key) continue;
    // Varias fichas con el mismo NIF (cliente y proveedor): se queda la que tenga código postal.
    const current = addresses.get(key);
    if (!current || (!current.postalCode && row.postalCode)) addresses.set(key, { countryCode: row.countryCode, postalCode: row.postalCode });
  }
  return addresses;
}

async function loadExtras(companyId: string, summary: SpanishFiscalSummary, period: string): Promise<PresentationExtras> {
  if (summary.code === "111" || summary.code === "115") {
    return { withholdingRecipients: await countWithholdingRecipients(companyId, summary.code, period, fiscalTimeZoneFor(summary.fiscalProfile.territory)) };
  }
  if (summary.code === "347") return { partyAddresses: await loadPartyAddresses(companyId) };
  return {};
}

export type GeneratedPresentationFile = FiscalFile & { source: FiscalSummarySource };

/**
 * Genera el fichero de presentación de un modelo guardado: con la foto de lo presentado si la hay
 * y, si no, con el cálculo en vivo. Deja rastro en la auditoría. Los datos que faltan (NIF, nombre,
 * fichas incompletas…) se devuelven como error 422 con el detalle.
 */
export async function generatePresentationFile(input: {
  companyId: string;
  tenantId: string;
  actorUserId: string;
  reportId: string;
  options?: PresentationOptions;
}): Promise<GeneratedPresentationFile> {
  const report = await getFiscalReport(input.companyId, input.reportId);
  if (!report) throw new HttpError(404, "Modelo no encontrado.");
  if (!isSpanishFiscalModelCode(report.code) || !hasPresentationFile(report.code)) {
    throw new HttpError(422, report.code === "390"
      ? "El programa no genera el fichero del 390: usa el resumen anual como guía para rellenarlo en la sede."
      : `El modelo ${report.code} no tiene fichero de presentación en el programa.`);
  }
  const [companyRow] = await db
    .select({ name: company.name, legalName: company.legalName, vatNumber: company.vatNumber, phone: company.phone, countryCode: company.countryCode })
    .from(company)
    .where(eq(company.id, input.companyId))
    .limit(1);
  if (!companyRow) throw new HttpError(404, "Empresa no encontrada.");
  assertCountryFeature(companyRow.countryCode, "taxReports");

  const resolved = await resolveFiscalReportSummary(input.companyId, report);
  if (!resolved) throw new HttpError(422, "Modelo fiscal no soportado.");
  const { summary, source } = resolved;
  const declarant: Declarant = {
    taxId: companyRow.vatNumber,
    name: companyRow.legalName?.trim() || companyRow.name,
    isIndividual: summary.fiscalProfile.taxpayerType === "individual",
    phone: companyRow.phone,
  };

  let file: FiscalFile;
  try {
    file = buildPresentationFile(summary, report.period, declarant, await loadExtras(input.companyId, summary, report.period), input.options);
  } catch (error) {
    if (error instanceof FiscalFileError) throw new HttpError(422, `No se puede generar el fichero. ${error.problems.join(" ")}`);
    throw error;
  }
  await recordAudit({
    tenantId: input.tenantId,
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    action: "fiscal.presentationFile",
    entityName: "fiscalReport",
    entityId: report.id,
    payload: { code: report.code, period: report.period, fileName: file.fileName, source },
  });
  return { ...file, source };
}
