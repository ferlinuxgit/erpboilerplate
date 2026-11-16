/**
 * Resumen de impuestos por periodo para países sin modelos oficiales (nivel "basic" del paquete
 * fiscal): impuesto repercutido en las facturas emitidas − impuesto deducible de las recibidas.
 * Usa exactamente el mismo cálculo que el modelo 303 español (mismos filtros de facturas, misma
 * agrupación por tipo y mismas autorepercusiones), así que es coherente con la contabilidad.
 */

import { centsToNumber } from "@/server/taxation/engine";
import type { VatBucket } from "@/lib/fiscal-spain";
import { bucketsToNumbers, computeModelo303Totals } from "@/server/fiscal/spain-calc";
import { fetchIssuedInvoiceVat, fetchSupplierInvoiceVat } from "@/server/fiscal/spain";
import { getFiscalSettings } from "@/server/fiscal/settings";

export { parseTaxSummaryPeriod, recentTaxSummaryPeriods, taxSummaryPeriodKey, type TaxSummaryPeriod, type TaxSummaryPeriodicity } from "@/server/fiscal/tax-summary-periods";
import type { TaxSummaryPeriod } from "@/server/fiscal/tax-summary-periods";

export type TaxSummary = {
  period: TaxSummaryPeriod;
  /** Impuesto repercutido en ventas nacionales, por tipo. */
  output: VatBucket[];
  /** Recargos u otros impuestos que suman (si los hay). */
  surcharge: VatBucket[];
  /** Ventas sin impuesto, por tratamiento (base). */
  untaxedSales: Array<{ treatment: string; base: number }>;
  /** Impuesto autorepercutido en compras intracomunitarias o con inversión del sujeto pasivo. */
  selfAssessed: number;
  /** Impuesto soportado en las facturas recibidas (lo cobrado por los proveedores). */
  inputCharged: number;
  /** Impuesto deducible (soportado + autorepercutido deducible). */
  deductible: number;
  /** Total devengado (repercutido + recargos + autorepercutido). */
  accrued: number;
  /** A ingresar (> 0) o a compensar/devolver (< 0). */
  result: number;
  issuedCount: number;
  receivedCount: number;
  draftInvoiceCount: number;
};

export async function calculateTaxSummary(companyId: string, period: TaxSummaryPeriod, homeCountry: string): Promise<TaxSummary> {
  const settings = await getFiscalSettings(companyId);
  const [issued, supplier] = await Promise.all([
    fetchIssuedInvoiceVat(companyId, period.start, period.endExclusive, homeCountry),
    fetchSupplierInvoiceVat(companyId, period.start, period.endExclusive, settings.prorrataPct, homeCountry),
  ]);
  const totals = computeModelo303Totals(issued, supplier);
  return {
    period,
    output: bucketsToNumbers(issued.vat),
    surcharge: bucketsToNumbers(issued.surcharge),
    untaxedSales: Object.entries(issued.zeroRated)
      .filter(([, cents]) => cents !== 0)
      .map(([treatment, cents]) => ({ treatment, base: centsToNumber(cents) })),
    selfAssessed: centsToNumber(totals.selfAssessedCents),
    inputCharged: centsToNumber(supplier.totalTaxCents),
    deductible: centsToNumber(totals.deductibleCents),
    accrued: centsToNumber(totals.accruedCents),
    result: centsToNumber(totals.resultCents),
    issuedCount: issued.documents.length,
    receivedCount: supplier.invoiceIds.size,
    draftInvoiceCount: issued.draftInvoiceCount,
  };
}
