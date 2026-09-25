import type { RecurringTemplateLine, RecurringTemplateLineTax } from "@/db/schema";
import type { InvoiceCalculationTax } from "@/lib/invoice-totals";
import {
  SURCHARGE_BY_VAT_RATE,
  findRetentionTaxByRate,
  findSurchargeTaxForVat,
  findVatTaxByRate,
  type ConfiguredTaxLike,
} from "@/server/invoices/default-taxes";

/**
 * Impuestos de las líneas de facturas recurrentes (código puro).
 *
 * Una plantilla creada desde una factura guarda los impuestos exactos de cada línea (IVA, recargo
 * de equivalencia, retenciones, otros). Las plantillas antiguas o escritas a mano solo tienen
 * `taxRate` (IVA) y `retentionRate` (IRPF): de ahí se derivan, añadiendo el recargo si el cliente
 * está en recargo de equivalencia.
 */

type CompanyTax = ConfiguredTaxLike & { name: string; kind: string; operation: string };

const EPSILON = 0.0005;

function same(left: number, right: number) {
  return Math.abs(left - right) < EPSILON;
}

function kindOf(tax: { kind?: string | null }) {
  return (tax.kind ?? "VAT").toUpperCase();
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

function sumRates(taxes: RecurringTemplateLineTax[], predicate: (tax: RecurringTemplateLineTax) => boolean) {
  return round3(taxes.filter(predicate).reduce((sum, tax) => sum + tax.rate, 0));
}

const isVat = (tax: RecurringTemplateLineTax) => tax.operation === "ADD" && kindOf(tax) === "VAT";
const isWithholding = (tax: RecurringTemplateLineTax) => tax.operation === "SUBTRACT";
const isSurcharge = (tax: RecurringTemplateLineTax) => tax.operation === "ADD" && kindOf(tax) === "SURCHARGE";

/** Tipo de IVA y retención resumidos de unos impuestos (para los campos simples del formulario). */
export function summarizeLineTaxes(taxes: RecurringTemplateLineTax[]) {
  return { taxRate: sumRates(taxes, isVat), retentionRate: sumRates(taxes, isWithholding) };
}

/** Impuestos guardados de una línea de factura → impuestos de plantilla (null si la línea no los tenía). */
export function templateTaxesFromInvoiceLine(taxes: InvoiceCalculationTax[] | null | undefined): RecurringTemplateLineTax[] | null {
  if (!taxes) return null;
  return taxes.map((tax) => ({
    taxId: tax.id ?? null,
    name: tax.name?.trim() || `${kindOf(tax) === "VAT" ? "IVA" : "Impuesto"} ${tax.rate.toLocaleString("es-ES")} %`,
    rate: tax.rate,
    kind: kindOf(tax),
    operation: tax.operation === "SUBTRACT" ? "SUBTRACT" : "ADD",
  }));
}

/**
 * Conserva los impuestos exactos de una línea mientras sigan cuadrando con su IVA y su retención.
 * Si el usuario cambia el IVA o la retención en el formulario, se sustituyen solo esos impuestos
 * (el recargo sigue al nuevo IVA) y se mantienen los demás.
 */
export function reconcileTemplateLineTaxes(line: Pick<RecurringTemplateLine, "taxRate" | "retentionRate" | "taxes">): RecurringTemplateLineTax[] | null {
  const taxes = line.taxes;
  if (!taxes || taxes.length === 0) return null;
  const summary = summarizeLineTaxes(taxes);
  const vatMatches = same(summary.taxRate, line.taxRate);
  const retentionMatches = same(summary.retentionRate, line.retentionRate);
  if (vatMatches && retentionMatches) return taxes;

  const result: RecurringTemplateLineTax[] = [];
  const hadSurcharge = taxes.some(isSurcharge);
  for (const tax of taxes) {
    if (!vatMatches && (isVat(tax) || isSurcharge(tax))) continue;
    if (!retentionMatches && isWithholding(tax)) continue;
    result.push(tax);
  }
  if (!vatMatches && line.taxRate > 0) {
    result.push({ taxId: null, name: `IVA ${line.taxRate.toLocaleString("es-ES")} %`, rate: line.taxRate, kind: "VAT", operation: "ADD" });
    const surchargeRate = SURCHARGE_BY_VAT_RATE[String(line.taxRate)];
    if (hadSurcharge && surchargeRate !== undefined) {
      result.push({ taxId: null, name: `Recargo de equivalencia ${surchargeRate.toLocaleString("es-ES")} %`, rate: surchargeRate, kind: "SURCHARGE", operation: "ADD" });
    }
  }
  if (!retentionMatches && line.retentionRate > 0) {
    result.push({ taxId: null, name: `Retención IRPF ${line.retentionRate.toLocaleString("es-ES")} %`, rate: line.retentionRate, kind: "WITHHOLDING", operation: "SUBTRACT" });
  }
  return result;
}

function fromCompanyTax(tax: CompanyTax): InvoiceCalculationTax {
  return { id: tax.id, name: tax.name, rate: Number(tax.rate), kind: tax.kind, operation: tax.operation === "SUBTRACT" ? "SUBTRACT" : "ADD" };
}

/**
 * Impuestos con los que se genera cada línea:
 * - con impuestos guardados, se copian tal cual (enlazando el impuesto de la empresa si sigue
 *   existiendo con el mismo tipo, o uno equivalente por tipo si el guardado no tiene id);
 * - sin ellos, IVA + recargo (si el cliente está en recargo de equivalencia) + retención.
 */
export function resolveRecurringLineTaxes(
  line: Pick<RecurringTemplateLine, "taxRate" | "retentionRate" | "taxes">,
  companyTaxes: CompanyTax[],
  options: { equivalenceSurcharge?: boolean } = {},
): InvoiceCalculationTax[] {
  const stored = reconcileTemplateLineTaxes(line);
  const usable = companyTaxes.filter((tax) => tax.isActive !== false);
  if (stored) {
    return stored.map((tax) => {
      const byId = tax.taxId ? usable.find((candidate) => candidate.id === tax.taxId && same(Number(candidate.rate), tax.rate)) : undefined;
      const byRate = byId ?? (tax.taxId ? undefined : isVat(tax)
        ? findVatTaxByRate(usable, tax.rate)
        : isWithholding(tax)
          ? findRetentionTaxByRate(usable, tax.rate)
          : usable.find((candidate) => kindOf(candidate) === kindOf(tax) && candidate.operation === tax.operation && same(Number(candidate.rate), tax.rate)));
      const match = byId ?? byRate ?? null;
      return match
        ? fromCompanyTax(match)
        : { id: null, name: tax.name, rate: tax.rate, kind: tax.kind, operation: tax.operation };
    });
  }

  const result: InvoiceCalculationTax[] = [];
  if (line.taxRate > 0) {
    const vat = findVatTaxByRate(usable, line.taxRate);
    result.push(vat ? fromCompanyTax(vat) : { id: null, name: `IVA ${line.taxRate.toLocaleString("es-ES")} %`, rate: line.taxRate, kind: "VAT", operation: "ADD" });
    if (options.equivalenceSurcharge) {
      const surcharge = findSurchargeTaxForVat(usable, line.taxRate);
      const surchargeRate = SURCHARGE_BY_VAT_RATE[String(line.taxRate)];
      if (surcharge) result.push(fromCompanyTax(surcharge));
      else if (surchargeRate !== undefined) {
        result.push({ id: null, name: `Recargo de equivalencia ${surchargeRate.toLocaleString("es-ES")} %`, rate: surchargeRate, kind: "SURCHARGE", operation: "ADD" });
      }
    }
  }
  if (line.retentionRate > 0) {
    const retention = findRetentionTaxByRate(usable, line.retentionRate);
    result.push(retention
      ? fromCompanyTax(retention)
      : { id: null, name: `Retención IRPF ${line.retentionRate.toLocaleString("es-ES")} %`, rate: line.retentionRate, kind: "WITHHOLDING", operation: "SUBTRACT" });
  }
  return result;
}

/** Impuestos de la plantilla en el formato del motor de totales (para importes estimados). */
export function templateTaxesForTotals(line: Pick<RecurringTemplateLine, "taxRate" | "retentionRate" | "taxes">): InvoiceCalculationTax[] | undefined {
  const stored = reconcileTemplateLineTaxes(line);
  return stored ? stored.map((tax) => ({ id: tax.taxId, name: tax.name, rate: tax.rate, kind: tax.kind, operation: tax.operation })) : undefined;
}
