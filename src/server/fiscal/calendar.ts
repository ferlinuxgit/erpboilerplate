import { igicExemptRegime } from "@/lib/country-packs/igic";
import {
  getDaysUntilDue,
  getFiscalDueStatus,
  getSpanishFiscalDirectDebitDate,
  getSpanishFiscalDueDate,
  getSpanishFiscalModel,
  parseSpanishFiscalPeriod,
  type FiscalDueStatus,
  type FiscalReportStatus,
  type SpanishFiscalModelCode,
  type TaxpayerType,
} from "@/lib/fiscal-spain";
import { corporateDeadlinesDueIn, type CorporateCalendarInput } from "@/server/corporate-tax/calendar";
import type { CorporateReminderCode } from "@/server/corporate-tax/deadlines";

/**
 * Calendario fiscal del año (función pura): todos los plazos que vencen en el año natural según
 * el perfil fiscal, existan o no borradores. Incluye el 4.º trimestre del año anterior (vence en
 * enero) y los resúmenes anuales 390 y 347 del año anterior.
 */

/** reminder: recordatorio informativo (libros, cuentas anuales, modelo 232); el programa no lo calcula. */
export type FiscalCalendarRequirement = "required" | "if-applicable" | "reminder";

export type FiscalCalendarEntry = {
  code: SpanishFiscalModelCode | CorporateReminderCode;
  name: string;
  period: string;
  periodLabel: string;
  dueDate: string;
  /** Último día para presentar con domiciliación bancaria; null en modelos sin ingreso o de la ATC. */
  directDebitDate: string | null;
  daysUntilDue: number;
  dueStatus: FiscalDueStatus;
  requirement: FiscalCalendarRequirement;
  reason: string;
  report: { id: string; status: FiscalReportStatus; amountDue: number | null } | null;
  /** Estado para mostrar: presentado, vencido (obligatorio sin presentar), próximo, planificado o pasado sin actividad. */
  state: "filed" | "overdue" | "due-soon" | "planned" | "past";
  /** Pantalla propia donde se prepara (modelos de sociedades y recordatorios); sin ella, el borrador de Fiscalidad. */
  href?: string;
};

export type FiscalCalendarInput = {
  year: number;
  periodicity: "monthly" | "quarterly";
  taxpayerType: TaxpayerType;
  fiscalRegime: string;
  /** false en Canarias, Ceuta y Melilla: sin modelos de IVA (303, 390, 349). */
  vatReturns?: boolean;
  /** Territorio fiscal: en Canarias (ES-CN) se añaden el 420 y el 425 (y el 450 con AIEM). */
  territory?: string;
  /** La empresa factura el AIEM (Canarias). */
  aiem?: boolean;
  reports: Array<{ id: string; code: string; period: string; status: FiscalReportStatus; summary?: { amountDue: number | null } | null }>;
  /** Solo sociedades: modelos 200 y 202 y recordatorios mercantiles. Sin él, el calendario no cambia. */
  corporateTax?: CorporateCalendarInput | null;
  /**
   * Retenciones: qué hay en el año anterior (para los resúmenes anuales 190, 180 y 193) y en este
   * (para el 123), y qué modelos ha activado el usuario. Sin este dato no se añade ninguno.
   */
  withholding?: {
    previousYear: { payroll: boolean; professional: boolean; rent: boolean; capitalIncome: boolean };
    currentYear: { capitalIncome: boolean };
    enabledModels: string[];
  };
  now?: Date;
};

const CONDITIONAL_REASONS: Record<"111" | "115" | "349" | "347", string> = {
  "111": "Solo si has pagado a profesionales con retención de IRPF o tienes nóminas.",
  "115": "Solo si pagas el alquiler de un local con retención.",
  "349": "Solo si has vendido o comprado a empresas de otros países de la UE.",
  "347": "Solo si algún cliente o proveedor superó 3.005,06 € en el año.",
};

function vatPeriodsDueIn(year: number, periodicity: "monthly" | "quarterly") {
  if (periodicity === "monthly") {
    return [`${year - 1}-12`, ...Array.from({ length: 11 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`)];
  }
  return [`${year - 1}-Q4`, `${year}-Q1`, `${year}-Q2`, `${year}-Q3`];
}

function quarterPeriodsDueIn(year: number) {
  return [`${year - 1}-Q4`, `${year}-Q1`, `${year}-Q2`, `${year}-Q3`];
}

export function buildFiscalCalendar(input: FiscalCalendarInput): FiscalCalendarEntry[] {
  const now = input.now ?? new Date();
  const vatReturns = input.vatReturns ?? true;
  const vatExempt = !vatReturns || input.fiscalRegime === "recargo_equivalencia" || input.fiscalRegime === "exempt";
  const vatPeriods = vatPeriodsDueIn(input.year, input.periodicity);
  const planned: Array<{ code: SpanishFiscalModelCode; period: string; requirement: FiscalCalendarRequirement; reason: string }> = [];

  for (const period of vatPeriods) {
    if (!vatExempt) planned.push({ code: "303", period, requirement: "required", reason: "IVA del periodo; se presenta aunque salga a cero." });
    planned.push({ code: "111", period, requirement: "if-applicable", reason: CONDITIONAL_REASONS["111"] });
    planned.push({ code: "115", period, requirement: "if-applicable", reason: CONDITIONAL_REASONS["115"] });
    if (vatReturns) planned.push({ code: "349", period, requirement: "if-applicable", reason: CONDITIONAL_REASONS["349"] });
  }
  if (input.territory === "ES-CN") {
    const igicExempt = igicExemptRegime(input.territory, input.fiscalRegime);
    for (const period of quarterPeriodsDueIn(input.year)) {
      if (!igicExempt) planned.push({ code: "420", period, requirement: "required", reason: "IGIC del trimestre ante la Agencia Tributaria Canaria; se presenta aunque salga a cero." });
      if (input.aiem) planned.push({ code: "450", period, requirement: "required", reason: "AIEM de las entregas de mercancías del trimestre." });
    }
    planned.push({
      code: "425",
      period: String(input.year - 1),
      requirement: "required",
      reason: input.fiscalRegime === "pequeno_empresario" ? "Volumen de operaciones del REPEP del año anterior." : "Resumen anual del IGIC del año anterior.",
    });
  }
  if (input.taxpayerType === "individual") {
    for (const period of quarterPeriodsDueIn(input.year)) {
      planned.push({ code: "130", period, requirement: "required", reason: "Pago a cuenta del IRPF (salvo que el 70 % de tus ingresos lleve retención)." });
    }
  }
  const previousYear = String(input.year - 1);
  if (!vatExempt) planned.push({ code: "390", period: previousYear, requirement: "required", reason: "Resumen anual del IVA del año anterior." });
  planned.push({ code: "347", period: previousYear, requirement: "if-applicable", reason: CONDITIONAL_REASONS["347"] });

  // Retenciones: resúmenes anuales en enero y 123 periódico, solo con datos o si el usuario los activa.
  if (input.withholding) {
    const { previousYear: before, currentYear: current, enabledModels } = input.withholding;
    const hasReport = (code: string, year: string) => input.reports.some((report) => report.code === code && report.period.startsWith(year));
    const enabled = (code: string) => enabledModels.includes(code);
    const has190 = before.payroll || before.professional || hasReport("111", previousYear);
    if (has190 || enabled("190")) {
      planned.push({ code: "190", period: previousYear, requirement: has190 ? "required" : "if-applicable", reason: has190 ? "Resumen anual de las retenciones de nóminas y profesionales del año anterior (los 111)." : "Solo si retuviste IRPF en nóminas o a profesionales el año anterior." });
    }
    const has180 = before.rent || hasReport("115", previousYear);
    if (has180 || enabled("180")) {
      planned.push({ code: "180", period: previousYear, requirement: has180 ? "required" : "if-applicable", reason: has180 ? "Resumen anual de las retenciones de alquileres del año anterior (los 115)." : "Solo si pagaste alquileres con retención el año anterior." });
    }
    const has193 = before.capitalIncome || hasReport("123", previousYear);
    if (has193 || enabled("193")) {
      planned.push({ code: "193", period: previousYear, requirement: has193 ? "required" : "if-applicable", reason: has193 ? "Resumen anual de las retenciones de dividendos e intereses del año anterior (los 123)." : "Solo si pagaste dividendos o intereses con retención el año anterior." });
    }
    if (before.capitalIncome || current.capitalIncome || enabled("123") || hasReport("123", previousYear) || hasReport("123", String(input.year))) {
      for (const period of vatPeriods) {
        planned.push({ code: "123", period, requirement: "if-applicable", reason: "Solo si en el periodo has pagado dividendos o intereses con retención." });
      }
    }
  }

  const entries = planned.flatMap((entry): FiscalCalendarEntry[] => {
    const model = getSpanishFiscalModel(entry.code);
    const range = parseSpanishFiscalPeriod(entry.period, entry.code);
    const dueDate = getSpanishFiscalDueDate(entry.period, entry.code);
    if (!model || !range || !dueDate) return [];
    const report = input.reports.find((candidate) => candidate.code === entry.code && candidate.period === entry.period) ?? null;
    const dueStatus = getFiscalDueStatus(dueDate, now);
    const state: FiscalCalendarEntry["state"] =
      report?.status === "FILED"
        ? "filed"
        : dueStatus === "overdue"
          ? entry.requirement === "required" || report ? "overdue" : "past"
          : dueStatus === "due-soon"
            ? "due-soon"
            : "planned";
    return [{
      code: entry.code,
      name: model.name,
      period: entry.period,
      periodLabel: range.label,
      dueDate: dueDate.toISOString(),
      directDebitDate: getSpanishFiscalDirectDebitDate(entry.period, entry.code)?.toISOString() ?? null,
      daysUntilDue: getDaysUntilDue(dueDate, now),
      dueStatus,
      requirement: entry.requirement,
      reason: entry.reason,
      report: report ? { id: report.id, status: report.status, amountDue: report.summary?.amountDue ?? null } : null,
      state,
    }];
  });

  // Sociedades: el 200 solo figura como vencido si la liquidación se empezó en el programa y no se
  // marcó como presentada; quien no usa el asistente lo ve como plazo pasado, no como aviso.
  for (const deadline of input.corporateTax && input.taxpayerType === "company" ? corporateDeadlinesDueIn(input.corporateTax, input.year) : []) {
    const dueStatus = getFiscalDueStatus(deadline.dueDate, now);
    entries.push({
      code: deadline.code,
      name: deadline.name,
      period: deadline.period,
      periodLabel: deadline.periodLabel,
      dueDate: deadline.dueDate.toISOString(),
      directDebitDate: null,
      daysUntilDue: getDaysUntilDue(deadline.dueDate, now),
      dueStatus,
      requirement: deadline.requirement,
      reason: deadline.reason,
      report: null,
      state: deadline.status === "filed"
        ? "filed"
        : dueStatus === "overdue"
          ? deadline.status === "draft" && deadline.requirement === "required" ? "overdue" : "past"
          : dueStatus === "due-soon" ? "due-soon" : "planned",
      href: deadline.href,
    });
  }

  return entries.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.code.localeCompare(b.code));
}
