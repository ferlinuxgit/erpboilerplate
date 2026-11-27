import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";

import { accountChart, company, companySettings, customer, fixedAsset, fixedAssetDepreciation, invoice, invoiceLine, invoiceLineTax, partner, supplierInvoice, supplierInvoiceLine } from "@/db/schema";
import { standardVatRate } from "@/lib/country-packs/vat-rates";
import { db } from "@/lib/db";
import { fiscalCivilDate, fiscalRangeInstants, fiscalTimeZoneFor, normalizeTaxpayerType, resolveSalesVatTreatment, resolveSupplierVatTreatment } from "@/lib/fiscal-spain";
import { HttpError } from "@/lib/http";
import { buildReceivedRegisterRows, type ReceivedRegisterLine } from "@/server/accounting/gestor-package-model";
import { recordAudit } from "@/server/audit";
import { getCompanyTaxTerritory } from "@/server/company/fiscal-context";
import { hasSpanishNifShape, normalizeSpanishNif, sanitizeText } from "@/server/fiscal-files/fields";
import {
  buildLsiAssetRows, buildLsiIssuedRows, buildLsiReceivedRows, buildLsiWorkbook, expenseConceptForAccount, lsiFileName,
  type LsiActivity, type LsiAsset, type LsiBooks, type LsiIssuedLine, type LsiOptions, type LsiReceivedEntry, type LsiReceivedExtra,
} from "@/server/fiscal-files/lsi-model";
import { resolveAccrualDate } from "@/server/fiscal/accrual";
import { assertCountryFeature } from "@/server/fiscal/country-guard";
import { issuedInvoiceFiscalFilter, loadFiledVatPeriods } from "@/server/fiscal/spain";

const ID_BATCH = 500;
const cents = (value: string | number | null | undefined) => Math.round(Number(value ?? 0) * 100) || 0;

/**
 * Líneas de las facturas emitidas devengadas en el rango, reducidas a base, IVA, recargo y
 * retención. Mismos filtros que el 303 (sin anuladas ni borradores) y misma fecha de devengo
 * (`resolveAccrualDate`). Como el devengo nunca es posterior a la expedición, basta con mirar las
 * expedidas desde el inicio del rango.
 */
async function loadIssuedLines(companyId: string, range: { start: Date; endExclusive: Date }, homeCountry: string, timeZone: string): Promise<LsiIssuedLine[]> {
  const filedPeriods = await loadFiledVatPeriods(companyId, timeZone);
  const rows = await db
    .select({
      lineId: invoiceLine.id,
      quantity: invoiceLine.quantity,
      unitPrice: invoiceLine.unitPrice,
      discountPct: invoiceLine.discountPct,
      taxRate: invoiceLine.taxRate,
      retentionRate: invoiceLine.retentionRate,
      invoiceId: invoice.id,
      number: invoice.number,
      issueDate: invoice.issueDate,
      operationDate: invoice.operationDate,
      issuedAt: invoice.issuedAt,
      invoiceType: invoice.invoiceType,
      rectificationReason: invoice.rectificationReason,
      vatTreatment: invoice.vatTreatment,
      vatExemptionCode: invoice.vatExemptionCode,
      customerName: sql<string>`coalesce(${partner.name}, ${customer.name})`,
      customerTaxId: partner.taxId,
      customerCountry: partner.countryCode,
    })
    .from(invoiceLine)
    .innerJoin(invoice, eq(invoiceLine.invoiceId, invoice.id))
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    // Fin abierto: una factura expedida después del rango puede documentar una operación de dentro.
    .where(issuedInvoiceFiscalFilter(companyId, range.start, new Date(Date.UTC(2200, 0, 1)), timeZone));

  const candidates = rows
    .map((row) => ({ ...row, accrualDate: resolveAccrualDate(row, filedPeriods).date }))
    .filter((row) => row.accrualDate >= range.start && row.accrualDate < range.endExclusive);

  const lineIds = candidates.map((row) => row.lineId);
  const taxesByLine = new Map<string, Array<{ rate: string; kind: string; operation: string; baseAmount: string; amount: string }>>();
  for (let offset = 0; offset < lineIds.length; offset += ID_BATCH) {
    const taxes = await db
      .select({ lineId: invoiceLineTax.invoiceLineId, rate: invoiceLineTax.rate, kind: invoiceLineTax.kind, operation: invoiceLineTax.operation, baseAmount: invoiceLineTax.baseAmount, amount: invoiceLineTax.amount })
      .from(invoiceLineTax)
      .where(inArray(invoiceLineTax.invoiceLineId, lineIds.slice(offset, offset + ID_BATCH)));
    for (const tax of taxes) taxesByLine.set(tax.lineId, [...(taxesByLine.get(tax.lineId) ?? []), tax]);
  }

  return candidates.map((row) => {
    const discount = Math.min(Math.max(Number(row.discountPct ?? 0), 0), 100);
    const fallbackBase = Math.round(Number(row.quantity) * Number(row.unitPrice) * (1 - discount / 100) * 100);
    const line: LsiIssuedLine = {
      invoiceId: row.invoiceId,
      number: row.number,
      issueDate: row.issueDate,
      operationDate: row.operationDate,
      accrualDate: row.accrualDate,
      invoiceType: row.invoiceType,
      rectificationReason: row.rectificationReason,
      treatment: resolveSalesVatTreatment(row.vatTreatment, row.customerCountry, homeCountry),
      exemptionCode: row.vatExemptionCode,
      customerName: row.customerName,
      customerTaxId: row.customerTaxId,
      customerCountry: row.customerCountry,
      baseCents: fallbackBase,
      vatRate: 0,
      vatCents: 0,
      surchargeRate: null,
      surchargeCents: 0,
      withholdingRate: 0,
      withholdingCents: 0,
    };
    const taxes = taxesByLine.get(row.lineId);
    if (taxes && taxes.length > 0) {
      for (const tax of taxes) {
        line.baseCents = cents(tax.baseAmount);
        if (tax.operation === "SUBTRACT") {
          line.withholdingRate = Number(tax.rate);
          line.withholdingCents += cents(tax.amount);
        } else if (tax.kind === "SURCHARGE") {
          line.surchargeRate = Number(tax.rate);
          line.surchargeCents += cents(tax.amount);
        } else if (tax.kind === "VAT" || !tax.kind) {
          line.vatRate = Number(tax.rate);
          line.vatCents += cents(tax.amount);
        }
      }
    } else {
      // Facturas antiguas sin desglose de impuestos por línea: tipo y retención de la propia línea.
      line.vatRate = Number(row.taxRate ?? 0);
      line.vatCents = Math.round((fallbackBase * line.vatRate) / 100);
      line.withholdingRate = Number(row.retentionRate ?? 0);
      line.withholdingCents = Math.round((fallbackBase * line.withholdingRate) / 100);
    }
    return line;
  });
}

const SPLIT = "\u0001";

/**
 * Facturas recibidas del rango con el mismo criterio que el 303 y que el libro del gestor (por
 * fecha de registro; la anulación resta en su periodo). Se reutiliza `buildReceivedRegisterRows`
 * para los importes; el concepto de gasto y la marca de bien de inversión se conservan partiendo
 * cada factura por esos dos datos antes de agrupar.
 */
async function loadReceivedEntries(companyId: string, range: { start: Date; endExclusive: Date }, homeCountry: string): Promise<LsiReceivedEntry[]> {
  const columns = {
    invoiceId: supplierInvoice.id,
    number: supplierInvoice.number,
    supplierNumber: supplierInvoice.supplierDocumentNumber,
    supplierName: partner.name,
    supplierTaxId: partner.taxId,
    countryCode: partner.countryCode,
    issueDate: supplierInvoice.issueDate,
    accountingDate: supplierInvoice.accountingDate,
    voidedAt: supplierInvoice.voidedAt,
    operationDate: supplierInvoice.operationDate,
    documentKind: supplierInvoice.documentKind,
    rectifiedDocumentNumber: supplierInvoice.rectifiedDocumentNumber,
    rectifiedIssueDate: supplierInvoice.rectifiedIssueDate,
    rectificationReason: supplierInvoice.rectificationReason,
    vatTreatment: supplierInvoice.vatTreatment,
    isSimplified: supplierInvoice.isSimplified,
    importDuaNumber: supplierInvoice.importDuaNumber,
    importDuaDate: supplierInvoice.importDuaDate,
    totalAmount: supplierInvoice.totalAmount,
    prorrataPct: supplierInvoice.prorrataPct,
    base: supplierInvoiceLine.subtotalAmount,
    taxRate: supplierInvoiceLine.taxRate,
    taxAmount: supplierInvoiceLine.taxAmount,
    taxDeductiblePct: supplierInvoiceLine.taxDeductiblePct,
    surchargeRate: supplierInvoiceLine.surchargeRate,
    surchargeAmount: supplierInvoiceLine.surchargeAmount,
    retentionRate: supplierInvoiceLine.retentionRate,
    retentionAmount: supplierInvoiceLine.retentionAmount,
    isInvestmentGood: supplierInvoiceLine.isInvestmentGood,
    accountCode: accountChart.code,
  };
  const query = () => db
    .select(columns)
    .from(supplierInvoiceLine)
    .innerJoin(supplierInvoice, eq(supplierInvoiceLine.supplierInvoiceId, supplierInvoice.id))
    .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
    .leftJoin(accountChart, eq(accountChart.id, supplierInvoiceLine.expenseAccountId));
  const [registered, voided] = await Promise.all([
    query().where(and(
      eq(supplierInvoice.companyId, companyId),
      ne(supplierInvoice.status, "DRAFT"),
      or(ne(supplierInvoice.status, "VOID"), isNotNull(supplierInvoice.voidedAt)),
      gte(supplierInvoice.accountingDate, range.start),
      lt(supplierInvoice.accountingDate, range.endExclusive),
    )),
    query().where(and(
      eq(supplierInvoice.companyId, companyId),
      eq(supplierInvoice.status, "VOID"),
      gte(supplierInvoice.voidedAt, range.start),
      lt(supplierInvoice.voidedAt, range.endExclusive),
    )),
  ]);

  const extras = new Map<string, LsiReceivedExtra>();
  const toLine = (row: (typeof registered)[number], sign: 1 | -1): ReceivedRegisterLine => {
    // Una cuenta del grupo 2 es siempre un bien de inversión, como en el cálculo del 303.
    const investmentGood = row.isInvestmentGood || (row.accountCode ?? "").startsWith("2");
    const concept = expenseConceptForAccount(row.accountCode);
    const retentionRate = Number(row.retentionRate) || 0;
    const pseudoId = [row.invoiceId, concept, investmentGood ? "1" : "0", retentionRate].join(SPLIT);
    extras.set(`${pseudoId}|${sign}`, {
      supplierCountry: row.countryCode,
      isSimplified: row.isSimplified,
      rectificationReason: row.rectificationReason,
      importDuaNumber: row.importDuaNumber,
      importDuaDate: row.importDuaDate,
      expenseConcept: concept,
      retentionRate,
      investmentGood,
    });
    return {
      ...row,
      invoiceId: pseudoId,
      sign,
      isInvestmentGood: investmentGood,
      registrationDate: sign === 1 ? row.accountingDate : row.voidedAt ?? row.accountingDate,
      vatTreatment: resolveSupplierVatTreatment(row.vatTreatment, row.countryCode, null, homeCountry),
    };
  };
  const rows = buildReceivedRegisterRows(
    [...registered.map((row) => toLine(row, 1)), ...voided.map((row) => toLine(row, -1))],
    { selfAssessmentRate: standardVatRate(homeCountry) },
  );
  return rows.map((row) => {
    const sign = row.number.endsWith(" (anulación)") ? -1 : 1;
    const extra = extras.get(`${row.invoiceId}|${sign}`);
    if (!extra) throw new Error("Fila del libro de recibidas sin datos de su factura.");
    return { row: { ...row, invoiceId: row.invoiceId.split(SPLIT)[0] }, extra };
  });
}

/**
 * Bienes de inversión del ejercicio: las fichas de inmovilizado en uso en algún momento del año
 * (con su amortización y su factura de compra, si está enlazada) y, además, las facturas recibidas
 * en el año con líneas marcadas como bien de inversión que no tienen ficha.
 */
async function loadAssets(companyId: string, year: number, range: { start: Date; endExclusive: Date }, received: LsiReceivedEntry[]): Promise<LsiAsset[]> {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const assets = await db
    .select({
      id: fixedAsset.id,
      code: fixedAsset.code,
      description: fixedAsset.description,
      accountCode: accountChart.code,
      inServiceDate: fixedAsset.inServiceDate,
      acquisitionCost: fixedAsset.acquisitionCost,
      residualValue: fixedAsset.residualValue,
      isDepreciable: fixedAsset.isDepreciable,
      annualPct: fixedAsset.annualPct,
      usefulLifeYears: fixedAsset.usefulLifeYears,
      priorAccumulated: fixedAsset.priorAccumulated,
      supplierInvoiceId: fixedAsset.supplierInvoiceId,
      disposalDate: fixedAsset.disposalDate,
      disposalType: fixedAsset.disposalType,
    })
    .from(fixedAsset)
    .leftJoin(accountChart, eq(accountChart.id, fixedAsset.assetAccountId))
    .where(and(
      eq(fixedAsset.companyId, companyId),
      lte(fixedAsset.inServiceDate, yearEnd),
      or(isNull(fixedAsset.disposalDate), gte(fixedAsset.disposalDate, yearStart)),
    ))
    .orderBy(fixedAsset.code);

  const depreciation = assets.length
    ? await db
        .select({
          assetId: fixedAssetDepreciation.assetId,
          before: sql<string>`coalesce(sum(case when ${fixedAssetDepreciation.periodEnd} < ${yearStart} then ${fixedAssetDepreciation.amount} else 0 end), 0)`,
          inYear: sql<string>`coalesce(sum(case when ${fixedAssetDepreciation.periodEnd} >= ${yearStart} and ${fixedAssetDepreciation.periodEnd} <= ${yearEnd} then ${fixedAssetDepreciation.amount} else 0 end), 0)`,
        })
        .from(fixedAssetDepreciation)
        .where(and(eq(fixedAssetDepreciation.companyId, companyId), lte(fixedAssetDepreciation.periodEnd, yearEnd)))
        .groupBy(fixedAssetDepreciation.assetId)
    : [];
  const depreciationByAsset = new Map(depreciation.map((row) => [row.assetId, row]));

  const invoiceIds = [...new Set(assets.map((asset) => asset.supplierInvoiceId).filter((id): id is string => Boolean(id)))];
  const invoiceRows = invoiceIds.length
    ? await db
        .select({
          id: supplierInvoice.id,
          number: supplierInvoice.number,
          supplierNumber: supplierInvoice.supplierDocumentNumber,
          issueDate: supplierInvoice.issueDate,
          prorrataPct: supplierInvoice.prorrataPct,
          supplierName: partner.name,
          supplierTaxId: partner.taxId,
          supplierCountry: partner.countryCode,
          base: supplierInvoiceLine.subtotalAmount,
          taxRate: supplierInvoiceLine.taxRate,
          taxAmount: supplierInvoiceLine.taxAmount,
          taxDeductiblePct: supplierInvoiceLine.taxDeductiblePct,
          isInvestmentGood: supplierInvoiceLine.isInvestmentGood,
          accountCode: accountChart.code,
        })
        .from(supplierInvoiceLine)
        .innerJoin(supplierInvoice, eq(supplierInvoiceLine.supplierInvoiceId, supplierInvoice.id))
        .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
        .leftJoin(accountChart, eq(accountChart.id, supplierInvoiceLine.expenseAccountId))
        .where(and(eq(supplierInvoice.companyId, companyId), inArray(supplierInvoice.id, invoiceIds)))
    : [];
  const invoiceById = new Map<string, NonNullable<LsiAsset["invoice"]> & { rates: Set<number> }>();
  const hasInvestmentLines = new Set(invoiceRows.filter((row) => row.isInvestmentGood || (row.accountCode ?? "").startsWith("2")).map((row) => row.id));
  for (const row of invoiceRows) {
    // Si la factura marca líneas de bien de inversión, solo cuentan esas; si no, toda la factura.
    if (hasInvestmentLines.has(row.id) && !(row.isInvestmentGood || (row.accountCode ?? "").startsWith("2"))) continue;
    const entry = invoiceById.get(row.id) ?? {
      issueDate: row.issueDate, supplierNumber: row.supplierNumber, number: row.number, supplierName: row.supplierName, supplierTaxId: row.supplierTaxId,
      supplierCountry: row.supplierCountry, baseCents: 0, vatRate: null, prorrataPct: Number(row.prorrataPct), deductibleCents: 0, rates: new Set<number>(),
    };
    entry.baseCents += cents(row.base);
    entry.deductibleCents += Math.round((cents(row.taxAmount) * Math.min(Math.max(Number(row.taxDeductiblePct), 0), 100) * Math.min(Math.max(Number(row.prorrataPct), 0), 100)) / 10_000);
    entry.rates.add(Number(row.taxRate));
    entry.vatRate = entry.rates.size === 1 ? Number(row.taxRate) : null;
    invoiceById.set(row.id, entry);
  }

  const result: LsiAsset[] = assets.map((asset) => {
    const amounts = depreciationByAsset.get(asset.id);
    const pct = asset.annualPct !== null ? Number(asset.annualPct) : asset.usefulLifeYears !== null && Number(asset.usefulLifeYears) > 0 ? 100 / Number(asset.usefulLifeYears) : null;
    const linked = asset.supplierInvoiceId ? invoiceById.get(asset.supplierInvoiceId) : undefined;
    return {
      identifier: asset.code,
      description: asset.description,
      assetAccountCode: asset.accountCode,
      inServiceDate: asset.inServiceDate,
      acquisitionCostCents: cents(asset.acquisitionCost),
      amortizableCents: cents(asset.acquisitionCost) - cents(asset.residualValue),
      annualPct: asset.isDepreciable ? pct : null,
      accumulatedAtStartCents: cents(asset.priorAccumulated) + cents(amounts?.before),
      yearDepreciationCents: cents(amounts?.inYear),
      invoice: linked ?? null,
      disposalDate: asset.disposalDate,
      disposalType: asset.disposalType,
    };
  });

  // Facturas del año con bienes de inversión que no tienen ficha de inmovilizado.
  const linkedInvoices = new Set(invoiceIds);
  const unlinked = new Map<string, LsiAsset & { rates: Set<number> }>();
  for (const { row, extra } of received) {
    if (!extra.investmentGood || linkedInvoices.has(row.invoiceId) || row.number.endsWith(" (anulación)")) continue;
    if (row.registrationDate < range.start || row.registrationDate >= range.endExclusive) continue;
    const date = (row.operationDate ?? row.issueDate).toISOString().slice(0, 10);
    const entry = unlinked.get(row.invoiceId) ?? {
      identifier: row.number,
      description: `Bien de inversión de la factura ${row.supplierNumber ?? row.number} (sin ficha de inmovilizado)`,
      assetAccountCode: null,
      inServiceDate: date,
      acquisitionCostCents: 0,
      amortizableCents: 0,
      annualPct: null,
      accumulatedAtStartCents: 0,
      yearDepreciationCents: 0,
      invoice: { issueDate: row.issueDate, supplierNumber: row.supplierNumber, number: row.number, supplierName: row.supplierName, supplierTaxId: row.supplierTaxId, supplierCountry: extra.supplierCountry, baseCents: 0, vatRate: null, prorrataPct: 100, deductibleCents: 0 },
      rates: new Set<number>(),
    };
    const baseCents = Math.round(row.base * 100);
    entry.acquisitionCostCents += baseCents;
    entry.amortizableCents += baseCents;
    if (entry.invoice) {
      entry.invoice.baseCents += baseCents;
      entry.invoice.deductibleCents += Math.round(row.deductibleTax * 100);
      entry.rates.add(row.taxRate);
      entry.invoice.vatRate = entry.rates.size === 1 ? row.taxRate : null;
      const soportado = row.chargedTax + row.selfAssessedTax;
      if (soportado !== 0) entry.invoice.prorrataPct = Math.round((row.deductibleTax / soportado) * 10_000) / 100;
    }
    unlinked.set(row.invoiceId, entry);
  }
  return [...result, ...unlinked.values()];
}

export type LsiBooksResult = { fileName: string; bytes: Uint8Array; counts: { issued: number; received: number; assets: number }; isIndividual: boolean };

/**
 * Libros registro del ejercicio en el formato de la AEAT, desde el 1 de enero hasta el final del
 * trimestre indicado (la AEAT los pide «sin fraccionar por trimestre»). No deja rastro en la
 * auditoría: lo hace quien lo descarga (`generateLsiBooks`) o lo empaqueta.
 */
export async function buildLsiBooks(input: { companyId: string; year: number; quarter?: number; activity?: LsiActivity }): Promise<LsiBooksResult> {
  const [companyRow] = await db
    .select({ name: company.name, legalName: company.legalName, vatNumber: company.vatNumber, countryCode: company.countryCode, taxpayerType: companySettings.taxpayerType })
    .from(company)
    .leftJoin(companySettings, eq(companySettings.companyId, company.id))
    .where(eq(company.id, input.companyId))
    .limit(1);
  if (!companyRow) throw new HttpError(404, "Empresa no encontrada.");
  assertCountryFeature(companyRow.countryCode, "taxReports");
  const territory = await getCompanyTaxTerritory(input.companyId);
  // El formato es el de los libros del IVA: en Canarias, Ceuta y Melilla (IGIC / IPSI) no aplica.
  if (territory !== "ES") throw new HttpError(422, "Los libros en formato de la AEAT son los del IVA: no están disponibles para empresas de Canarias, Ceuta o Melilla.");
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) throw new HttpError(422, "El ejercicio no es válido.");
  const quarter = Math.min(Math.max(Math.trunc(input.quarter ?? 4), 1), 4);
  const nif = normalizeSpanishNif(companyRow.vatNumber);
  const name = companyRow.legalName?.trim() || companyRow.name;
  const problems: string[] = [];
  if (!hasSpanishNifShape(nif)) problems.push("Falta el NIF de la empresa o no tiene forma de NIF español (va en el nombre del fichero). Corrígelo en Configuración › Empresa.");
  if (!sanitizeText(name)) problems.push("Falta la razón social de la empresa.");
  if (problems.length > 0) throw new HttpError(422, `No se pueden generar los libros. ${problems.join(" ")}`);

  const timeZone = fiscalTimeZoneFor(territory);
  const range = fiscalRangeInstants({ start: new Date(Date.UTC(input.year, 0, 1)), endExclusive: new Date(Date.UTC(input.year, quarter * 3, 1)) }, timeZone);
  const isIndividual = normalizeTaxpayerType(companyRow.taxpayerType) === "individual";
  const options: LsiOptions = { isIndividual, activity: input.activity, civilDate: (instant) => fiscalCivilDate(instant, timeZone) };

  const [issuedLines, receivedEntries] = await Promise.all([
    loadIssuedLines(input.companyId, range, territory, timeZone),
    loadReceivedEntries(input.companyId, range, territory),
  ]);
  const assets = await loadAssets(input.companyId, input.year, range, receivedEntries);

  const books: LsiBooks = {
    year: input.year,
    taxId: nif,
    name,
    isIndividual,
    issued: buildLsiIssuedRows(issuedLines, options),
    received: buildLsiReceivedRows(receivedEntries, options),
    assets: buildLsiAssetRows(assets, input.year, options),
  };
  return {
    fileName: lsiFileName(books),
    bytes: await buildLsiWorkbook(books),
    counts: { issued: books.issued.length, received: books.received.length, assets: books.assets.length },
    isIndividual,
  };
}

/** Descarga de los libros en formato de la AEAT, con su rastro en la auditoría. */
export async function generateLsiBooks(input: { companyId: string; tenantId: string; actorUserId: string; year: number; quarter?: number; activity?: LsiActivity }) {
  const result = await buildLsiBooks(input);
  await recordAudit({
    tenantId: input.tenantId,
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    action: "fiscal.lsiBooks",
    entityName: "company",
    entityId: input.companyId,
    payload: { year: input.year, quarter: input.quarter ?? 4, fileName: result.fileName, ...result.counts },
  });
  return result;
}
