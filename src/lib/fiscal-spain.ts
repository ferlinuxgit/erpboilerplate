import { centsToNumber, lineBaseCents, roundHalfAwayFromZero, taxOnBaseCents } from "@/server/taxation/engine";

export const spanishFiscalModelCodes = ["303", "390", "347", "111", "115", "349", "130"] as const;

export type SpanishFiscalModelCode = (typeof spanishFiscalModelCodes)[number];

export type FiscalReportStatus = "DRAFT" | "READY" | "FILED";

export type SpanishFiscalModel = {
  code: SpanishFiscalModelCode;
  name: string;
  shortName: string;
  description: string;
  cadence: "monthly-or-quarterly" | "quarterly" | "annual";
  periodHint: string;
  /** Explicación en lenguaje llano: qué es y quién lo presenta. */
  plainHelp: string;
  /** Solo para autónomos (personas físicas en IRPF). */
  individualsOnly?: boolean;
  /** Ficha del trámite en la sede electrónica de la AEAT (presentación y ayuda). */
  aeatUrl: string;
};

export type TaxpayerType = "company" | "individual";

export function normalizeTaxpayerType(value: string | null | undefined): TaxpayerType {
  return value === "individual" ? "individual" : "company";
}

/** Modelos visibles según el tipo de contribuyente (el 130 solo aplica a autónomos). */
export function spanishFiscalModelsFor(taxpayerType: TaxpayerType) {
  return spanishFiscalModels.filter((model) => !model.individualsOnly || taxpayerType === "individual");
}

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
  taxes?: Array<{
    rate: string | number;
    kind?: string | null;
    operation: "ADD" | "SUBTRACT";
  }> | null;
};

type WithholdingLine = {
  quantity: string | number;
  unitPrice: string | number;
  retentionRate?: string | number | null;
  discountPct?: string | number | null;
  taxes?: Array<{
    rate: string | number;
    kind?: string | null;
    operation: "ADD" | "SUBTRACT";
  }> | null;
};

export const spanishFiscalModels: SpanishFiscalModel[] = [
  {
    code: "303",
    aeatUrl: "https://sede.agenciatributaria.gob.es/Sede/procedimientoini/G414.shtml",
    name: "Modelo 303",
    shortName: "IVA autoliquidación",
    description: "Borrador de IVA devengado y deducible del periodo por casillas (tipos, recargo, intracomunitarias e ISP).",
    cadence: "monthly-or-quarterly",
    periodHint: "2026-Q1 o 2026-04",
    plainHelp: "El IVA que has cobrado en tus facturas menos el IVA que has pagado en tus gastos. Se presenta cada trimestre aunque salga a cero.",
  },
  {
    code: "390",
    aeatUrl: "https://sede.agenciatributaria.gob.es/Sede/procedimientoini/G412.shtml",
    name: "Modelo 390",
    shortName: "Resumen anual IVA",
    description: "Resumen anual de IVA a partir de facturas emitidas y recibidas.",
    cadence: "annual",
    periodHint: "2026",
    plainHelp: "Resumen de todos los 303 del año. Se presenta en enero junto con el último trimestre.",
  },
  {
    code: "347",
    aeatUrl: "https://sede.agenciatributaria.gob.es/Sede/procedimientoini/GI27.shtml",
    name: "Modelo 347",
    shortName: "Operaciones con terceros",
    description: "Operaciones anuales con clientes y proveedores españoles por encima de 3.005,06 EUR.",
    cadence: "annual",
    periodHint: "2026",
    plainHelp: "Lista de clientes y proveedores con los que has operado más de 3.005,06 € en el año. Se presenta en febrero.",
  },
  {
    code: "111",
    aeatUrl: "https://sede.agenciatributaria.gob.es/Sede/procedimientoini/GH01.shtml",
    name: "Modelo 111",
    shortName: "Retenciones profesionales",
    description: "Retenciones IRPF que practicas en facturas recibidas de profesionales (cuenta 4751).",
    cadence: "monthly-or-quarterly",
    periodHint: "2026-Q1 o 2026-04",
    plainHelp: "Si un profesional (abogado, gestor, diseñador…) te factura con retención de IRPF, esa retención la ingresas tú a Hacienda con este modelo.",
  },
  {
    code: "115",
    aeatUrl: "https://sede.agenciatributaria.gob.es/Sede/procedimientoini/GH02.shtml",
    name: "Modelo 115",
    shortName: "Retenciones alquileres",
    description: "Retenciones que practicas en facturas de alquiler de locales (gastos en cuenta 621).",
    cadence: "monthly-or-quarterly",
    periodHint: "2026-Q1 o 2026-04",
    plainHelp: "Si alquilas un local u oficina, la retención de las facturas del casero la ingresas tú con este modelo.",
  },
  {
    code: "349",
    aeatUrl: "https://sede.agenciatributaria.gob.es/Sede/procedimientoini/GI28.shtml",
    name: "Modelo 349",
    shortName: "Operaciones intracomunitarias",
    description: "Declaración recapitulativa de ventas y compras de bienes y servicios con empresas de otros países de la UE, por NIF-IVA y clave.",
    cadence: "monthly-or-quarterly",
    periodHint: "2026-Q1 o 2026-04",
    plainHelp: "Solo si vendes o compras a empresas de otros países de la UE (con NIF-IVA). Informa a quién y cuánto; no se paga nada.",
  },
  {
    code: "130",
    aeatUrl: "https://sede.agenciatributaria.gob.es/Sede/procedimientoini/G601.shtml",
    name: "Modelo 130",
    shortName: "Pago fraccionado IRPF",
    description: "Pago a cuenta del IRPF de autónomos en estimación directa: 20 % del rendimiento neto acumulado del año, menos retenciones y pagos anteriores.",
    cadence: "quarterly",
    periodHint: "2026-Q1",
    plainHelp: "Para autónomos: cada trimestre adelantas el 20 % de lo que has ganado en el año (ingresos − gastos), descontando lo que ya te han retenido y lo que ya pagaste.",
    individualsOnly: true,
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

  if (model.cadence === "quarterly" && !quarterMatch) return null;

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

export type FiscalPeriodPart = { value: string; label: string };

const MONTH_LABELS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/**
 * Opciones del selector de periodo según la cadencia del modelo: anual (sin subperiodo),
 * trimestral (T1–T4) o mensual/trimestral (T1–T4 y meses). Evita escribir "2026-Q1" a mano.
 */
export function fiscalPeriodPartsFor(modelCode: SpanishFiscalModelCode): FiscalPeriodPart[] {
  const model = getSpanishFiscalModel(modelCode);
  if (!model || model.cadence === "annual") return [];
  const quarters = [1, 2, 3, 4].map((quarter) => ({ value: `Q${quarter}`, label: `${quarter}.º trimestre` }));
  if (model.cadence === "quarterly") return quarters;
  return [...quarters, ...MONTH_LABELS.map((label, index) => ({ value: String(index + 1).padStart(2, "0"), label }))];
}

/** Compone el periodo normalizado ("2026", "2026-Q1", "2026-04") a partir de año y subperiodo. */
export function composeFiscalPeriod(year: number | string, part: string | null | undefined) {
  return part ? `${year}-${part}` : String(year);
}

/** Separa un periodo normalizado en año y subperiodo (inverso de `composeFiscalPeriod`). */
export function splitFiscalPeriod(period: string | null | undefined): { year: number | null; part: string | null } {
  const match = /^(20\d{2})(?:-(Q[1-4]|0[1-9]|1[0-2]))?$/.exec((period ?? "").trim().toUpperCase());
  if (!match) return { year: null, part: null };
  return { year: Number(match[1]), part: match[2] ?? null };
}

export function normalizeSpanishFiscalPeriod(period: string, modelCode: SpanishFiscalModelCode) {
  const trimmed = period.trim().toUpperCase();
  return parseSpanishFiscalPeriod(trimmed, modelCode) ? trimmed : null;
}

function lastDayOfMonthUtc(year: number, monthOneBased: number) {
  return new Date(Date.UTC(year, monthOneBased, 0));
}

/** Modelos cuyo último periodo del año vence el 30 de enero (el resto, el 20). */
const JANUARY_30_MODELS = new Set<SpanishFiscalModelCode>(["303", "130", "349"]);

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
    if (quarter === 4) return new Date(Date.UTC(year + 1, 0, JANUARY_30_MODELS.has(modelCode) ? 30 : 20));
    return new Date(Date.UTC(year, quarter * 3, 20));
  }

  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const month = Number(monthMatch[2]);
    const dueMonth = month === 12 ? 0 : month;
    const dueYear = month === 12 ? year + 1 : year;
    return new Date(Date.UTC(dueYear, dueMonth, JANUARY_30_MODELS.has(modelCode) && month === 12 ? 30 : 20));
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

type CentsRateBucket = { rate: number; baseCents: number; baseCentsByDeductiblePct: Map<number, number> };

/** Base de la línea en céntimos con el motor fiscal único (admite negativos de rectificativas). */
function fiscalLineBaseCents(line: { quantity: string | number; unitPrice: string | number; discountPct?: string | number | null }) {
  return lineBaseCents(
    { quantity: toNumber(line.quantity), unitPrice: toNumber(line.unitPrice), discountPct: toNumber(line.discountPct) },
    { allowNegative: true },
  );
}

function addToRateBucket(buckets: Map<number, CentsRateBucket>, rate: number, baseCents: number, deductiblePct = 100) {
  const bucket = buckets.get(rate) ?? { rate, baseCents: 0, baseCentsByDeductiblePct: new Map<number, number>() };
  bucket.baseCents += baseCents;
  bucket.baseCentsByDeductiblePct.set(deductiblePct, (bucket.baseCentsByDeductiblePct.get(deductiblePct) ?? 0) + baseCents);
  buckets.set(rate, bucket);
}

/**
 * Cuota por tipo: base sumada por tipo y cuota calculada sobre la base del bucket (práctica
 * española). Con deducibilidad parcial, la cuota se calcula por subgrupo de % deducible.
 */
function finalizeRateBuckets(buckets: Map<number, CentsRateBucket>): VatBucket[] {
  return [...buckets.values()]
    .map((bucket) => {
      let taxCents = 0;
      for (const [deductiblePct, baseCents] of bucket.baseCentsByDeductiblePct) {
        const fullTax = taxOnBaseCents(baseCents, bucket.rate);
        taxCents += deductiblePct === 100 ? fullTax : roundHalfAwayFromZero((fullTax * deductiblePct) / 100);
      }
      return { rate: bucket.rate, base: centsToNumber(bucket.baseCents), tax: centsToNumber(taxCents) };
    })
    .sort((left, right) => right.rate - left.rate);
}

export function aggregateOutputVat(lines: VatLine[]): VatBucket[] {
  const buckets = new Map<number, CentsRateBucket>();

  for (const line of lines) {
    const deductiblePct = Math.min(Math.max(toNumber(line.taxDeductiblePct ?? 100), 0), 100);
    const baseCents = fiscalLineBaseCents(line);
    const vatTaxes = line.taxes?.length
      ? line.taxes.filter((selectedTax) => selectedTax.operation === "ADD" && selectedTax.kind === "VAT")
      : [{ rate: line.taxRate }];
    for (const selectedTax of vatTaxes) {
      addToRateBucket(buckets, roundMoney(toNumber(selectedTax.rate)), baseCents, deductiblePct);
    }
  }

  return finalizeRateBuckets(buckets);
}

export function roundFiscalMoney(value: number) {
  return roundMoney(value);
}

/** Estados miembros de la UE (códigos ISO-3166 alfa-2; Grecia también como "EL" en VIES). */
export const EU_COUNTRY_CODES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "GR", "HR", "HU", "IE",
  "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]);

/**
 * INTRA_EU: entrega intracomunitaria de bienes (exenta, art. 25 LIVA).
 * INTRA_EU_SERVICES: servicio a empresa de otro país de la UE, no sujeto por reglas de localización
 * (arts. 69.Uno.1º y 84.Uno.2º LIVA). Ambos van en la casilla 59 del 303 y en el 349 (claves E y S).
 */
export type SalesVatTreatment = "DOMESTIC" | "INTRA_EU" | "INTRA_EU_SERVICES" | "EXPORT" | "EXEMPT" | "REVERSE_CHARGE" | "NOT_SUBJECT";
export type SupplierVatTreatment = "DOMESTIC" | "INTRA_EU" | "REVERSE_CHARGE" | "IMPORT" | "NOT_SUBJECT";

const salesVatTreatments = new Set<SalesVatTreatment>(["DOMESTIC", "INTRA_EU", "INTRA_EU_SERVICES", "EXPORT", "EXEMPT", "REVERSE_CHARGE", "NOT_SUBJECT"]);
const supplierVatTreatments = new Set<SupplierVatTreatment>(["DOMESTIC", "INTRA_EU", "REVERSE_CHARGE", "IMPORT", "NOT_SUBJECT"]);

export const salesVatTreatmentLabels: Record<SalesVatTreatment, string> = {
  DOMESTIC: "Nacional",
  INTRA_EU: "Entrega intracomunitaria",
  INTRA_EU_SERVICES: "Servicios a empresa de la UE",
  EXPORT: "Exportación",
  EXEMPT: "Exenta",
  REVERSE_CHARGE: "Inversión del sujeto pasivo",
  NOT_SUBJECT: "No sujeta",
};

export const supplierVatTreatmentLabels: Record<SupplierVatTreatment, string> = {
  DOMESTIC: "Nacional",
  INTRA_EU: "Adquisición intracomunitaria",
  REVERSE_CHARGE: "Inversión del sujeto pasivo",
  IMPORT: "Importación",
  NOT_SUBJECT: "No sujeta",
};

function normalizeCountry(countryCode: string | null | undefined) {
  return (countryCode ?? "ES").trim().toUpperCase() || "ES";
}

/** Tratamiento IVA de una venta: explícito o deducido del país del cliente. */
export function resolveSalesVatTreatment(explicit: string | null | undefined, customerCountryCode: string | null | undefined): SalesVatTreatment {
  if (explicit && salesVatTreatments.has(explicit as SalesVatTreatment)) return explicit as SalesVatTreatment;
  const country = normalizeCountry(customerCountryCode);
  if (country === "ES") return "DOMESTIC";
  return EU_COUNTRY_CODES.has(country) ? "INTRA_EU" : "EXPORT";
}

/**
 * Tratamiento IVA de una compra: explícito o deducido del país del proveedor.
 * Proveedor UE → adquisición intracomunitaria (autorepercusión). Fuera de la UE → importación
 * (el IVA se liquida en aduana con el DUA, no en la factura del proveedor).
 */
export function resolveSupplierVatTreatment(explicit: string | null | undefined, supplierCountryCode: string | null | undefined): SupplierVatTreatment {
  if (explicit && supplierVatTreatments.has(explicit as SupplierVatTreatment)) return explicit as SupplierVatTreatment;
  const country = normalizeCountry(supplierCountryCode);
  if (country === "ES") return "DOMESTIC";
  return EU_COUNTRY_CODES.has(country) ? "INTRA_EU" : "IMPORT";
}

/** Venta a empresa de otro país de la UE (bienes o servicios): casilla 59 del 303 y modelo 349. */
export function isIntraEuSalesTreatment(treatment: SalesVatTreatment) {
  return treatment === "INTRA_EU" || treatment === "INTRA_EU_SERVICES";
}

export function isSelfAssessedTreatment(treatment: SupplierVatTreatment) {
  return treatment === "INTRA_EU" || treatment === "REVERSE_CHARGE";
}

/** Tipo general usado para la autorepercusión cuando la línea no indica tipo. */
export const REVERSE_CHARGE_DEFAULT_RATE = 21;

/**
 * Cuota autorepercutida (ISP / adquisición intracomunitaria) de una línea.
 * Si la línea trae cuota calculada se usa esa; si no, se aplica el tipo general.
 */
export function reverseChargeTaxAmount(subtotal: number, lineTaxAmount: number) {
  if (lineTaxAmount > 0) return roundMoney(lineTaxAmount);
  return roundMoney((subtotal * REVERSE_CHARGE_DEFAULT_RATE) / 100);
}

/** Recargo de equivalencia → casillas del modelo 303 (diseño vigente AEAT). */
export const surchargeBoxesByRate: Record<string, { base: string; rate: string; tax: string }> = {
  "0.5": { base: "16", rate: "17", tax: "18" },
  "1.4": { base: "19", rate: "20", tax: "21" },
  "5.2": { base: "22", rate: "23", tax: "24" },
  "1.75": { base: "156", rate: "157", tax: "158" },
  "0.62": { base: "168", rate: "169", tax: "170" },
};

/** IVA devengado régimen general → casillas del modelo 303. */
export const outputVatBoxesByRate: Record<string, { base: string; rate: string; tax: string }> = {
  "0": { base: "150", rate: "151", tax: "152" },
  "4": { base: "01", rate: "02", tax: "03" },
  "5": { base: "153", rate: "154", tax: "155" },
  "10": { base: "04", rate: "05", tax: "06" },
  "21": { base: "07", rate: "08", tax: "09" },
};

/** Agrupa recargos de equivalencia (impuestos de tipo SURCHARGE) por tipo. */
export function aggregateSurcharges(lines: VatLine[]): VatBucket[] {
  const buckets = new Map<number, CentsRateBucket>();

  for (const line of lines) {
    const baseCents = fiscalLineBaseCents(line);
    const surcharges = line.taxes?.filter((selectedTax) => selectedTax.operation === "ADD" && selectedTax.kind === "SURCHARGE") ?? [];
    for (const selectedTax of surcharges) {
      addToRateBucket(buckets, roundMoney(toNumber(selectedTax.rate)), baseCents);
    }
  }

  return finalizeRateBuckets(buckets);
}

export function aggregateWithholdings(lines: WithholdingLine[]): VatBucket[] {
  const buckets = new Map<number, CentsRateBucket>();

  for (const line of lines) {
    const baseCents = fiscalLineBaseCents(line);
    const withholdingTaxes = line.taxes?.length
      ? line.taxes.filter((selectedTax) => selectedTax.operation === "SUBTRACT")
      : [{ rate: line.retentionRate ?? 0 }];
    for (const selectedTax of withholdingTaxes) {
      const rate = roundMoney(toNumber(selectedTax.rate));
      if (rate <= 0) continue;
      addToRateBucket(buckets, rate, baseCents);
    }
  }

  return finalizeRateBuckets(buckets);
}
