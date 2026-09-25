import {
  getDaysUntilDue,
  getFiscalDueStatus,
  getSpanishFiscalDueDate,
  getSpanishFiscalModel,
  parseSpanishFiscalPeriod,
  type FiscalDueStatus,
  type FiscalReportStatus,
  type SpanishFiscalModelCode,
  type TaxpayerType,
} from "@/lib/fiscal-spain";

/**
 * Calendario fiscal del año (función pura): todos los plazos que vencen en el año natural según
 * el perfil fiscal, existan o no borradores. Incluye el 4.º trimestre del año anterior (vence en
 * enero) y los resúmenes anuales 390 y 347 del año anterior.
 */

export type FiscalCalendarRequirement = "required" | "if-applicable";

export type FiscalCalendarEntry = {
  code: SpanishFiscalModelCode;
  name: string;
  period: string;
  periodLabel: string;
  dueDate: string;
  daysUntilDue: number;
  dueStatus: FiscalDueStatus;
  requirement: FiscalCalendarRequirement;
  reason: string;
  report: { id: string; status: FiscalReportStatus; amountDue: number | null } | null;
  /** Estado para mostrar: presentado, vencido (obligatorio sin presentar), próximo, planificado o pasado sin actividad. */
  state: "filed" | "overdue" | "due-soon" | "planned" | "past";
};

export type FiscalCalendarInput = {
  year: number;
  periodicity: "monthly" | "quarterly";
  taxpayerType: TaxpayerType;
  fiscalRegime: string;
  reports: Array<{ id: string; code: string; period: string; status: FiscalReportStatus; summary?: { amountDue: number | null } | null }>;
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
  const vatExempt = input.fiscalRegime === "recargo_equivalencia" || input.fiscalRegime === "exempt";
  const vatPeriods = vatPeriodsDueIn(input.year, input.periodicity);
  const planned: Array<{ code: SpanishFiscalModelCode; period: string; requirement: FiscalCalendarRequirement; reason: string }> = [];

  for (const period of vatPeriods) {
    if (!vatExempt) planned.push({ code: "303", period, requirement: "required", reason: "IVA del periodo; se presenta aunque salga a cero." });
    planned.push({ code: "111", period, requirement: "if-applicable", reason: CONDITIONAL_REASONS["111"] });
    planned.push({ code: "115", period, requirement: "if-applicable", reason: CONDITIONAL_REASONS["115"] });
    planned.push({ code: "349", period, requirement: "if-applicable", reason: CONDITIONAL_REASONS["349"] });
  }
  if (input.taxpayerType === "individual") {
    for (const period of quarterPeriodsDueIn(input.year)) {
      planned.push({ code: "130", period, requirement: "required", reason: "Pago a cuenta del IRPF (salvo que el 70 % de tus ingresos lleve retención)." });
    }
  }
  const previousYear = String(input.year - 1);
  if (!vatExempt) planned.push({ code: "390", period: previousYear, requirement: "required", reason: "Resumen anual del IVA del año anterior." });
  planned.push({ code: "347", period: previousYear, requirement: "if-applicable", reason: CONDITIONAL_REASONS["347"] });

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
      daysUntilDue: getDaysUntilDue(dueDate, now),
      dueStatus,
      requirement: entry.requirement,
      reason: entry.reason,
      report: report ? { id: report.id, status: report.status, amountDue: report.summary?.amountDue ?? null } : null,
      state,
    }];
  });

  return entries.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.code.localeCompare(b.code));
}
