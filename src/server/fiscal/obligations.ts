import { and, eq, gt, sql } from "drizzle-orm";

import { igicExemptRegime } from "@/lib/country-packs/igic";
import { getCountryFiscalProfile } from "@/lib/country-packs/profile";
import { companyHasAiem, getCompanyTaxTerritory } from "@/server/company/fiscal-context";
import { accountChart, companySettings, customer, invoice, partner, supplierInvoice, supplierInvoiceLine } from "@/db/schema";
import { db } from "@/lib/db";
import {
  getDaysUntilDue,
  getFiscalDueStatus,
  getSpanishFiscalDueDate,
  getSpanishFiscalModel,
  isIntraEuSalesTreatment,
  normalizeTaxpayerType,
  parseSpanishFiscalPeriod,
  resolveSalesVatTreatment,
  resolveSupplierVatTreatment,
  type FiscalDueStatus,
  type FiscalReportStatus,
  type SpanishFiscalModelCode,
} from "@/lib/fiscal-spain";
import { upcomingCorporateDeadlines } from "@/server/corporate-tax/calendar";
import { getCorporateTaxCalendarData } from "@/server/corporate-tax/service";
import { issuedInvoiceFiscalFilter, supplierInvoiceFiscalFilter } from "@/server/fiscal/spain";

/**
 * "Qué tengo que presentar": modelos del próximo plazo de presentación según el perfil fiscal y la
 * actividad del periodo, con su fecha límite y si ya hay borrador o está presentado.
 */

export type FiscalObligation = {
  code: SpanishFiscalModelCode;
  name: string;
  plainHelp: string;
  period: string;
  periodLabel: string;
  dueDate: string;
  daysUntilDue: number;
  dueStatus: FiscalDueStatus;
  /** required: hay que presentarlo; not-needed: sin actividad, no hace falta (se muestra para tranquilizar). */
  requirement: "required" | "not-needed";
  reason: string;
  report: { id: string; status: FiscalReportStatus; amountDue: number | null } | null;
  /** Pantalla propia donde se prepara (modelos 200 y 202); sin ella, el borrador de Fiscalidad. */
  href?: string;
};

type ExistingReport = { id: string; code: string; period: string; status: FiscalReportStatus; summary: { amountDue: number | null } | null };

function quarterPeriod(year: number, quarter: number) {
  return `${year}-Q${quarter}`;
}

function monthPeriod(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function startOfDayUtc(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Próximo periodo a presentar: el más antiguo (anterior o actual) cuyo plazo no ha terminado. */
export function nextFilingPeriod(code: SpanishFiscalModelCode, periodicity: "monthly" | "quarterly", now: Date) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const candidates: string[] = [];
  if (periodicity === "monthly" && code !== "130") {
    const previous = month === 1 ? monthPeriod(year - 1, 12) : monthPeriod(year, month - 1);
    candidates.push(previous, monthPeriod(year, month));
  } else {
    const quarter = Math.floor((month - 1) / 3) + 1;
    const previous = quarter === 1 ? quarterPeriod(year - 1, 4) : quarterPeriod(year, quarter - 1);
    candidates.push(previous, quarterPeriod(year, quarter));
  }
  const today = startOfDayUtc(now);
  return candidates.find((period) => {
    const due = getSpanishFiscalDueDate(period, code);
    return due ? startOfDayUtc(due) >= today : false;
  }) ?? candidates[candidates.length - 1];
}

async function periodActivity(companyId: string, start: Date, endExclusive: Date) {
  const withholdings = await db
    .select({
      rent: sql<string>`coalesce(sum(case when ${accountChart.code} like '621%' then ${supplierInvoiceLine.retentionAmount} else 0 end), 0)`,
      professional: sql<string>`coalesce(sum(case when ${accountChart.code} like '621%' then 0 else ${supplierInvoiceLine.retentionAmount} end), 0)`,
    })
    .from(supplierInvoiceLine)
    .innerJoin(supplierInvoice, eq(supplierInvoice.id, supplierInvoiceLine.supplierInvoiceId))
    .leftJoin(accountChart, eq(accountChart.id, supplierInvoiceLine.expenseAccountId))
    .where(and(supplierInvoiceFiscalFilter(companyId, start, endExclusive), gt(supplierInvoiceLine.retentionAmount, "0")));

  const [salesTreatments, purchaseTreatments] = await Promise.all([
    db
      .selectDistinct({ vatTreatment: invoice.vatTreatment, countryCode: partner.countryCode })
      .from(invoice)
      .innerJoin(customer, eq(customer.id, invoice.customerId))
      .leftJoin(partner, eq(partner.id, customer.partnerId))
      .where(issuedInvoiceFiscalFilter(companyId, start, endExclusive)),
    db
      .selectDistinct({ vatTreatment: supplierInvoice.vatTreatment, countryCode: partner.countryCode })
      .from(supplierInvoice)
      .leftJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
      .where(supplierInvoiceFiscalFilter(companyId, start, endExclusive)),
  ]);
  const intraEu = salesTreatments.some((row) => isIntraEuSalesTreatment(resolveSalesVatTreatment(row.vatTreatment, row.countryCode)))
    || purchaseTreatments.some((row) => resolveSupplierVatTreatment(row.vatTreatment, row.countryCode) === "INTRA_EU");
  return {
    rentWithholding: Number(withholdings[0]?.rent ?? 0),
    professionalWithholding: Number(withholdings[0]?.professional ?? 0),
    intraEu,
  };
}

export async function getCurrentFiscalObligations(companyId: string, reports: ExistingReport[], now = new Date()): Promise<FiscalObligation[]> {
  const [settings] = await db
    .select({ taxPeriodicity: companySettings.taxPeriodicity, taxpayerType: companySettings.taxpayerType, fiscalRegime: companySettings.fiscalRegime })
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);
  const periodicity = settings?.taxPeriodicity === "monthly" ? "monthly" : "quarterly";
  const taxpayerType = normalizeTaxpayerType(settings?.taxpayerType);
  const regime = settings?.fiscalRegime ?? "general";
  // Canarias, Ceuta y Melilla: sin modelos de IVA (IGIC / IPSI se resumen aparte).
  const territory = await getCompanyTaxTerritory(companyId);
  const vatReturns = getCountryFiscalProfile(territory).features.vatReturns;
  const canary = territory === "ES-CN";
  const igicExempt = igicExemptRegime(territory, regime);
  const aiem = canary && (await companyHasAiem(companyId));

  const vatPeriod = nextFilingPeriod("303", periodicity, now);
  const vatRange = parseSpanishFiscalPeriod(vatPeriod, "303");
  const activity = vatRange ? await periodActivity(companyId, vatRange.start, vatRange.endExclusive) : null;

  const entries: Array<{ code: SpanishFiscalModelCode; period: string; requirement: FiscalObligation["requirement"]; reason: string }> = [];
  const vatExempt = regime === "recargo_equivalencia" || regime === "exempt";
  if (vatReturns) entries.push({
    code: "303",
    period: vatPeriod,
    requirement: vatExempt ? "not-needed" : "required",
    reason: vatExempt ? "Con tu régimen de IVA no presentas el 303 por esta actividad." : "Obligatorio cada periodo, aunque no hayas facturado (se presenta a cero).",
  });
  entries.push({
    code: "111",
    period: vatPeriod,
    requirement: (activity?.professionalWithholding ?? 0) > 0 ? "required" : "not-needed",
    reason: (activity?.professionalWithholding ?? 0) > 0 ? "Has recibido facturas de profesionales con retención." : "No hay facturas de profesionales con retención en el periodo.",
  });
  entries.push({
    code: "115",
    period: vatPeriod,
    requirement: (activity?.rentWithholding ?? 0) > 0 ? "required" : "not-needed",
    reason: (activity?.rentWithholding ?? 0) > 0 ? "Pagas un alquiler con retención." : "No hay alquileres con retención en el periodo.",
  });
  if (vatReturns) entries.push({
    code: "349",
    period: vatPeriod,
    requirement: activity?.intraEu ? "required" : "not-needed",
    reason: activity?.intraEu ? "Has operado con empresas de otros países de la UE." : "Sin operaciones con empresas de la UE en el periodo.",
  });
  if (canary) {
    entries.push({
      code: "420",
      period: nextFilingPeriod("420", "quarterly", now),
      requirement: igicExempt ? "not-needed" : "required",
      reason: igicExempt
        ? "En el régimen de comerciante minorista o del pequeño empresario no presentas el 420 por esas ventas."
        : "IGIC del trimestre ante la Agencia Tributaria Canaria; se presenta aunque salga a cero.",
    });
    if (aiem) {
      entries.push({ code: "450", period: nextFilingPeriod("450", "quarterly", now), requirement: "required", reason: "Entregas de mercancías sujetas al AIEM en el trimestre." });
    }
  }
  if (taxpayerType === "individual") {
    entries.push({
      code: "130",
      period: nextFilingPeriod("130", "quarterly", now),
      requirement: "required",
      reason: "Autónomo en estimación directa: pago a cuenta del IRPF (salvo que el 70 % de tus ingresos lleve retención).",
    });
  }
  const month = now.getUTCMonth() + 1;
  if (month <= 2) {
    const previousYear = String(now.getUTCFullYear() - 1);
    if (month === 1 && !vatExempt && vatReturns) entries.push({ code: "390", period: previousYear, requirement: "required", reason: "Resumen anual del IVA del año pasado." });
    entries.push({ code: "347", period: previousYear, requirement: "required", reason: "Obligatorio si algún cliente o proveedor superó 3.005,06 € en el año." });
    if (month === 1 && canary) {
      entries.push({
        code: "425",
        period: previousYear,
        requirement: "required",
        reason: regime === "pequeno_empresario" ? "Declaración del volumen de operaciones del REPEP del año pasado." : "Resumen anual del IGIC del año pasado, con el 420 del cuarto trimestre.",
      });
    }
  }

  // Sociedades: modelos 200 y 202 cuando se acerca su plazo (se preparan en su asistente).
  const corporateData = taxpayerType === "company" ? await getCorporateTaxCalendarData(companyId, territory) : null;
  const corporate = (corporateData ? upcomingCorporateDeadlines(corporateData, now) : []).flatMap((deadline): FiscalObligation[] => {
    const model = deadline.code === "200" || deadline.code === "202" ? getSpanishFiscalModel(deadline.code) : null;
    if (!model || (deadline.code !== "200" && deadline.code !== "202")) return [];
    const notNeeded = deadline.kind === "installment" && deadline.status !== "none" && deadline.amountDue === 0;
    return [{
      code: deadline.code,
      name: model.name,
      plainHelp: model.plainHelp,
      period: deadline.period,
      periodLabel: deadline.periodLabel,
      dueDate: deadline.dueDate.toISOString(),
      daysUntilDue: getDaysUntilDue(deadline.dueDate, now),
      dueStatus: getFiscalDueStatus(deadline.dueDate, now),
      requirement: notNeeded ? "not-needed" : "required",
      reason: deadline.reason,
      report: deadline.status === "none" ? null : { id: "", status: deadline.status === "filed" ? "FILED" : "DRAFT", amountDue: deadline.amountDue !== null && deadline.amountDue < 0 ? null : deadline.amountDue },
      href: deadline.href,
    }];
  });

  return [...entries.flatMap((entry) => {
    const model = getSpanishFiscalModel(entry.code);
    const range = parseSpanishFiscalPeriod(entry.period, entry.code);
    const dueDate = getSpanishFiscalDueDate(entry.period, entry.code);
    if (!model || !range || !dueDate) return [];
    const report = reports.find((candidate) => candidate.code === entry.code && candidate.period === entry.period) ?? null;
    return [{
      code: entry.code,
      name: model.name,
      plainHelp: model.plainHelp,
      period: entry.period,
      periodLabel: range.label,
      dueDate: dueDate.toISOString(),
      daysUntilDue: getDaysUntilDue(dueDate, now),
      dueStatus: getFiscalDueStatus(dueDate, now),
      requirement: entry.requirement,
      reason: entry.reason,
      report: report ? { id: report.id, status: report.status, amountDue: report.summary?.amountDue ?? null } : null,
    }];
  }), ...corporate];
}
