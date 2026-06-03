export const spanishFiscalModelCodes = ["303", "390", "347", "111", "115"] as const;

export type SpanishFiscalModelCode = (typeof spanishFiscalModelCodes)[number];

export type FiscalReportStatus = "DRAFT" | "READY" | "FILED";

export type SpanishFiscalModel = {
  code: SpanishFiscalModelCode;
  name: string;
  shortName: string;
  description: string;
  cadence: "monthly-or-quarterly" | "annual";
  periodHint: string;
};

export type FiscalPeriodRange = {
  label: string;
  start: Date;
  endExclusive: Date;
};

export type FiscalDueStatus = "upcoming" | "due-soon" | "overdue";

export type VatBucket = {
  rate: number;
  base: number;
  tax: number;
};

type VatLine = {
  quantity: string | number;
  unitPrice: string | number;
  taxRate: string | number;
  discountPct?: string | number | null;
  taxDeductiblePct?: string | number | null;
};

type WithholdingLine = {
  quantity: string | number;
  unitPrice: string | number;
  retentionRate?: string | number | null;
  discountPct?: string | number | null;
};

export const spanishFiscalModels: SpanishFiscalModel[] = [
  {
    code: "303",
    name: "Modelo 303",
    shortName: "IVA autoliquidación",
    description: "Borrador de IVA repercutido del periodo con desglose por tipo impositivo.",
    cadence: "monthly-or-quarterly",
    periodHint: "2026-Q1 o 2026-04",
  },
  {
    code: "390",
    name: "Modelo 390",
    shortName: "Resumen anual IVA",
    description: "Resumen anual de IVA a partir de facturación emitida.",
    cadence: "annual",
    periodHint: "2026",
  },
  {
    code: "347",
    name: "Modelo 347",
    shortName: "Operaciones con terceros",
    description: "Control anual de operaciones por cliente por encima de 3.005,06 EUR.",
    cadence: "annual",
    periodHint: "2026",
  },
  {
    code: "111",
    name: "Modelo 111",
    shortName: "Retenciones profesionales",
    description: "Seguimiento de retenciones IRPF cuando las líneas soporten retención.",
    cadence: "monthly-or-quarterly",
    periodHint: "2026-Q1 o 2026-04",
  },
  {
    code: "115",
    name: "Modelo 115",
    shortName: "Retenciones alquileres",
    description: "Seguimiento de retenciones de alquiler cuando compras soporten esa clasificación.",
    cadence: "monthly-or-quarterly",
    periodHint: "2026-Q1 o 2026-04",
  },
];

export const fiscalStatusLabels: Record<FiscalReportStatus, string> = {
  DRAFT: "Borrador",
  READY: "Preparado",
  FILED: "Presentado",
};

export function isSpanishFiscalModelCode(value: string): value is SpanishFiscalModelCode {
  return spanishFiscalModelCodes.includes(value as SpanishFiscalModelCode);
}

export function getSpanishFiscalModel(code: string) {
  return spanishFiscalModels.find((model) => model.code === code);
}

export function normalizeSpanishFiscalCode(value: string) {
  return value.trim().toUpperCase();
}

export function parseSpanishFiscalPeriod(period: string, modelCode: SpanishFiscalModelCode): FiscalPeriodRange | null {
  const value = period.trim().toUpperCase();
  const annualMatch = /^(20\d{2})$/.exec(value);
  const quarterMatch = /^(20\d{2})-Q([1-4])$/.exec(value);
  const monthMatch = /^(20\d{2})-(0[1-9]|1[0-2])$/.exec(value);
  const model = getSpanishFiscalModel(modelCode);

  if (!model) return null;

  if (model.cadence === "annual") {
    if (!annualMatch) return null;
    const year = Number(annualMatch[1]);
    return {
      label: `${year}`,
      start: new Date(Date.UTC(year, 0, 1)),
      endExclusive: new Date(Date.UTC(year + 1, 0, 1)),
    };
  }

  if (quarterMatch) {
    const year = Number(quarterMatch[1]);
    const quarter = Number(quarterMatch[2]);
    const startMonth = (quarter - 1) * 3;
    return {
      label: `${year} T${quarter}`,
      start: new Date(Date.UTC(year, startMonth, 1)),
      endExclusive: new Date(Date.UTC(year, startMonth + 3, 1)),
    };
  }

  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const month = Number(monthMatch[2]);
    return {
      label: `${year}-${String(month).padStart(2, "0")}`,
      start: new Date(Date.UTC(year, month - 1, 1)),
      endExclusive: new Date(Date.UTC(year, month, 1)),
    };
  }

  return null;
}

export function normalizeSpanishFiscalPeriod(period: string, modelCode: SpanishFiscalModelCode) {
  const trimmed = period.trim().toUpperCase();
  return parseSpanishFiscalPeriod(trimmed, modelCode) ? trimmed : null;
}

function lastDayOfMonthUtc(year: number, monthOneBased: number) {
  return new Date(Date.UTC(year, monthOneBased, 0));
}

export function getSpanishFiscalDueDate(period: string, modelCode: SpanishFiscalModelCode) {
  const value = period.trim().toUpperCase();
  const annualMatch = /^(20\d{2})$/.exec(value);
  const quarterMatch = /^(20\d{2})-Q([1-4])$/.exec(value);
  const monthMatch = /^(20\d{2})-(0[1-9]|1[0-2])$/.exec(value);

  if (annualMatch) {
    const year = Number(annualMatch[1]);
    if (modelCode === "390") return new Date(Date.UTC(year + 1, 0, 30));
    if (modelCode === "347") return lastDayOfMonthUtc(year + 1, 2);
    return null;
  }

  if (quarterMatch) {
    const year = Number(quarterMatch[1]);
    const quarter = Number(quarterMatch[2]);
    if (quarter === 4) return new Date(Date.UTC(year + 1, 0, modelCode === "303" ? 30 : 20));
    return new Date(Date.UTC(year, quarter * 3, 20));
  }

  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const month = Number(monthMatch[2]);
    const dueMonth = month === 12 ? 0 : month;
    const dueYear = month === 12 ? year + 1 : year;
    return new Date(Date.UTC(dueYear, dueMonth, modelCode === "303" && month === 12 ? 30 : 20));
  }

  return null;
}

export function getFiscalDueStatus(dueDate: Date, now = new Date()): FiscalDueStatus {
  const days = getDaysUntilDue(dueDate, now);
  if (days < 0) return "overdue";
  if (days <= 7) return "due-soon";
  return "upcoming";
}

export function getDaysUntilDue(dueDate: Date, now = new Date()) {
  const dueDay = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const currentDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.ceil((dueDay - currentDay) / 86_400_000);
}

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function aggregateOutputVat(lines: VatLine[]): VatBucket[] {
  const buckets = new Map<number, VatBucket>();

  for (const line of lines) {
    const rate = roundMoney(toNumber(line.taxRate));
    const discountPct = Math.min(Math.max(toNumber(line.discountPct), 0), 100);
    const deductiblePct = Math.min(Math.max(toNumber(line.taxDeductiblePct ?? 100), 0), 100);
    const base = roundMoney(toNumber(line.quantity) * toNumber(line.unitPrice) * (1 - discountPct / 100));
    const tax = roundMoney(((base * rate) / 100) * (deductiblePct / 100));
    const bucket = buckets.get(rate) ?? { rate, base: 0, tax: 0 };
    bucket.base = roundMoney(bucket.base + base);
    bucket.tax = roundMoney(bucket.tax + tax);
    buckets.set(rate, bucket);
  }

  return [...buckets.values()].sort((left, right) => right.rate - left.rate);
}

export function roundFiscalMoney(value: number) {
  return roundMoney(value);
}

export function aggregateWithholdings(lines: WithholdingLine[]): VatBucket[] {
  const buckets = new Map<number, VatBucket>();

  for (const line of lines) {
    const rate = roundMoney(toNumber(line.retentionRate));
    if (rate <= 0) continue;

    const discountPct = Math.min(Math.max(toNumber(line.discountPct), 0), 100);
    const base = roundMoney(toNumber(line.quantity) * toNumber(line.unitPrice) * (1 - discountPct / 100));
    const tax = roundMoney((base * rate) / 100);
    const bucket = buckets.get(rate) ?? { rate, base: 0, tax: 0 };
    bucket.base = roundMoney(bucket.base + base);
    bucket.tax = roundMoney(bucket.tax + tax);
    buckets.set(rate, bucket);
  }

  return [...buckets.values()].sort((left, right) => right.rate - left.rate);
}
