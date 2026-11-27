import { normalizeCountryCode } from "@/lib/countries";
import { isIntraCommunity, normalizeHomeCountry, suggestSupplierVatTreatment, type SalesVatTreatment, type SupplierVatTreatment } from "@/lib/country-packs/vat-treatment";
import { centsToNumber, lineBaseCents, roundHalfAwayFromZero, taxOnBaseCents } from "@/server/taxation/engine";

export const spanishFiscalModelCodes = ["303", "390", "347", "111", "115", "349", "130", "420", "425", "450", "200", "202", "190", "180", "123", "193"] as const;

export type SpanishFiscalModelCode = (typeof spanishFiscalModelCodes)[number];

export type FiscalReportStatus = "DRAFT" | "READY" | "FILED";

export type SpanishFiscalModel = {
  code: SpanishFiscalModelCode;
  name: string;
  shortName: string;
  description: string;
  /** installments: pagos fraccionados del Impuesto sobre Sociedades (periodos 2026-1P, 2026-2P y 2026-3P). */
  cadence: "monthly-or-quarterly" | "quarterly" | "annual" | "installments";
  periodHint: string;
  /** Explicación en lenguaje llano: qué es y quién lo presenta. */
  plainHelp: string;
  /** Solo para autónomos (personas físicas en IRPF). */
  individualsOnly?: boolean;
  /** Ficha del trámite en la sede electrónica de la administración que lo gestiona (presentación y ayuda). */
  aeatUrl: string;
  /** Quién lo gestiona: AEAT (por defecto) o la Agencia Tributaria Canaria. */
  authority?: "AEAT" | "ATC";
  /** Solo para empresas de estos territorios fiscales (ES-CN…). */
  territories?: readonly string[];
  /** Solo si la empresa factura el AIEM (Canarias). */
  requiresAiem?: boolean;
  /** Pantalla propia donde se prepara (no es un borrador de `fiscal_report`). */
  assistantHref?: string;
};

/** Modelos de la Agencia Tributaria Canaria. */
export const CANARY_MODEL_CODES: ReadonlySet<SpanishFiscalModelCode> = new Set<SpanishFiscalModelCode>(["420", "425", "450"]);

export type TaxpayerType = "company" | "individual";

export function normalizeTaxpayerType(value: string | null | undefined): TaxpayerType {
  return value === "individual" ? "individual" : "company";
}

/** Modelos del IVA: no existen en Canarias (IGIC), Ceuta ni Melilla (IPSI). */
export const SPANISH_VAT_MODEL_CODES: ReadonlySet<SpanishFiscalModelCode> = new Set<SpanishFiscalModelCode>(["303", "390", "349"]);

/**
 * Modelos visibles según el tipo de contribuyente (el 130 solo aplica a autónomos) y el territorio
 * (`vatReturns: false` en Canarias, Ceuta y Melilla: sin 303, 390 ni 349).
 */
export function spanishFiscalModelsFor(taxpayerType: TaxpayerType, options: { vatReturns?: boolean; territory?: string | null; aiem?: boolean } = {}) {
  const vatReturns = options.vatReturns ?? true;
  return spanishFiscalModels.filter((model) =>
    (!model.individualsOnly || taxpayerType === "individual")
    && (vatReturns || !SPANISH_VAT_MODEL_CODES.has(model.code))
    && (!model.territories || model.territories.includes(options.territory ?? ""))
    && (!model.requiresAiem || Boolean(options.aiem)));
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
    shortName: "Retenciones de nóminas y profesionales",
    description: "Retenciones de IRPF que practicas en las nóminas y en las facturas recibidas de profesionales (cuenta 4751).",
    cadence: "monthly-or-quarterly",
    periodHint: "2026-Q1 o 2026-04",
    plainHelp: "El IRPF que descuentas en las nóminas y el que te retienen en factura los profesionales (abogado, gestor, diseñador…) lo ingresas tú a Hacienda con este modelo.",
  },
  {
    code: "190",
    aeatUrl: "https://sede.agenciatributaria.gob.es/Sede/procedimientoini/GI10.shtml",
    name: "Modelo 190",
    shortName: "Resumen anual de retenciones",
    description: "Resumen anual de los 111: perceptores con su NIF, clave, percepciones y retenciones.",
    cadence: "annual",
    periodHint: "2026",
    plainHelp: "Lista de las personas a las que has retenido IRPF en el año (empleados, administradores y profesionales), con lo pagado y lo retenido. Se presenta en enero y debe cuadrar con los 111.",
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
    code: "180",
    aeatUrl: "https://sede.agenciatributaria.gob.es/Sede/procedimientoini/GI00.shtml",
    name: "Modelo 180",
    shortName: "Resumen anual de alquileres",
    description: "Resumen anual de los 115: arrendadores con su NIF, base, retención e inmueble alquilado.",
    cadence: "annual",
    periodHint: "2026",
    plainHelp: "Lista de tus caseros con lo que les has pagado y retenido en el año y la referencia catastral del local. Se presenta en enero y debe cuadrar con los 115.",
  },
  {
    code: "123",
    aeatUrl: "https://sede.agenciatributaria.gob.es/Sede/procedimientoini/GH04.shtml",
    name: "Modelo 123",
    shortName: "Retenciones de dividendos e intereses",
    description: "Retenciones sobre rendimientos del capital mobiliario pagados por la empresa (dividendos a socios, intereses de préstamos).",
    cadence: "monthly-or-quarterly",
    periodHint: "2026-Q1 o 2026-04",
    plainHelp: "Si la empresa reparte dividendos o paga intereses de un préstamo, retiene el 19 % y lo ingresa con este modelo.",
  },
  {
    code: "193",
    aeatUrl: "https://sede.agenciatributaria.gob.es/Sede/procedimientoini/GI12.shtml",
    name: "Modelo 193",
    shortName: "Resumen anual del capital mobiliario",
    description: "Resumen anual de los 123: perceptores de dividendos e intereses con lo pagado y lo retenido.",
    cadence: "annual",
    periodHint: "2026",
    plainHelp: "Lista de los socios y prestamistas a los que has pagado dividendos o intereses en el año. Se presenta en enero y debe cuadrar con los 123.",
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
  {
    code: "420",
    aeatUrl: "https://www3.gobiernodecanarias.org/tributos/atc/w/igic-impuesto-general-indirecto-canario-",
    authority: "ATC",
    territories: ["ES-CN"],
    name: "Modelo 420",
    shortName: "IGIC autoliquidación",
    description: "Borrador del IGIC devengado y deducible del trimestre por casillas (tipos, inversión del sujeto pasivo, exportaciones).",
    cadence: "quarterly",
    periodHint: "2026-Q1",
    plainHelp: "El IGIC que has cobrado en tus facturas menos el que has pagado en tus gastos. Se presenta cada trimestre ante la Agencia Tributaria Canaria (del 1 al 20 del mes siguiente; el cuarto, en enero).",
  },
  {
    code: "425",
    aeatUrl: "https://www3.gobiernodecanarias.org/tributos/atc/w/igic-impuesto-general-indirecto-canario-",
    authority: "ATC",
    territories: ["ES-CN"],
    name: "Modelo 425",
    shortName: "Resumen anual IGIC",
    description: "Declaración-resumen anual del IGIC: bases y cuotas del año y volumen de operaciones (en el REPEP, solo el volumen).",
    cadence: "annual",
    periodHint: "2026",
    plainHelp: "Resumen de todos los 420 del año. Se presenta en enero junto con el último trimestre; si estás en el REPEP, declaras aquí tu volumen de operaciones.",
  },
  {
    code: "450",
    aeatUrl: "https://www3.gobiernodecanarias.org/tributos/atc/",
    authority: "ATC",
    territories: ["ES-CN"],
    requiresAiem: true,
    name: "Modelo 450",
    shortName: "AIEM autoliquidación",
    description: "Cuotas del AIEM repercutidas en las entregas de mercancías del trimestre, por tipo.",
    cadence: "quarterly",
    periodHint: "2026-Q1",
    plainHelp: "Si fabricas en Canarias productos sujetos al AIEM, ingresas cada trimestre el arbitrio de tus entregas (del 1 al 20 del mes siguiente; el cuarto, en enero).",
  },
];

/**
 * Modelos del Impuesto sobre Sociedades (solo sociedades). Se preparan en su asistente
 * (`/fiscal/sociedades`), no como borradores de `fiscal_report`: por eso no están en
 * `spanishFiscalModels`, que es la lista de los modelos que se crean desde Fiscalidad › Nuevo.
 */
export const corporateTaxFiscalModels: SpanishFiscalModel[] = [
  {
    code: "200",
    aeatUrl: "https://sede.agenciatributaria.gob.es/Sede/procedimientoini/GE04.shtml",
    assistantHref: "/fiscal/sociedades",
    name: "Modelo 200",
    shortName: "Impuesto sobre Sociedades",
    description: "Liquidación anual del Impuesto sobre Sociedades: del resultado contable a la cuota a ingresar o a devolver.",
    cadence: "annual",
    periodHint: "2026",
    plainHelp: "El impuesto sobre el beneficio de la sociedad. Se presenta una vez al año con Sociedades WEB, del 1 al 25 de julio si el ejercicio coincide con el año natural.",
  },
  {
    code: "202",
    aeatUrl: "https://sede.agenciatributaria.gob.es/Sede/procedimientoini/GE00.shtml",
    assistantHref: "/fiscal/sociedades/pagos-fraccionados",
    name: "Modelo 202",
    shortName: "Pago fraccionado de Sociedades",
    description: "Pago a cuenta del Impuesto sobre Sociedades del ejercicio en curso.",
    cadence: "installments",
    periodHint: "2026-1P",
    plainHelp: "Adelanto del Impuesto sobre Sociedades de este año. Se ingresa del 1 al 20 de abril, octubre y diciembre; si no sale nada a pagar, en general no hay que presentarlo.",
  },
];

/** Los modelos de sociedades tienen su propio asistente y no se guardan en `fiscal_report`. */
export function isCorporateTaxModelCode(code: string) {
  return code === "200" || code === "202";
}

export const fiscalStatusLabels: Record<FiscalReportStatus, string> = {
  DRAFT: "Borrador",
  READY: "Preparado",
  FILED: "Presentado",
};

export function isSpanishFiscalModelCode(value: string): value is SpanishFiscalModelCode {
  return spanishFiscalModelCodes.includes(value as SpanishFiscalModelCode);
}

export function getSpanishFiscalModel(code: string) {
  return spanishFiscalModels.find((model) => model.code === code) ?? corporateTaxFiscalModels.find((model) => model.code === code);
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

  // Pagos fraccionados de sociedades: 1P (enero-marzo), 2P (enero-septiembre) y 3P (enero-noviembre).
  if (model.cadence === "installments") {
    const installmentMatch = /^(20\d{2})-([123])P$/.exec(value);
    if (!installmentMatch) return null;
    const year = Number(installmentMatch[1]);
    return {
      label: `${year} ${installmentMatch[2]}P`,
      start: new Date(Date.UTC(year, 0, 1)),
      endExclusive: new Date(Date.UTC(year, [3, 9, 11][Number(installmentMatch[2]) - 1], 1)),
    };
  }

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

/**
 * HORA LOCAL DE LOS PERIODOS FISCALES
 *
 * Las fechas se guardan de dos formas: como fecha civil (lo elegido en un formulario: las 00:00:00
 * UTC exactas de ese día) o como instante real (tickets del TPV, rectificativas y duplicados, que
 * usan «ahora»). Regla única para decidir a qué periodo pertenece una fecha:
 *
 *   los límites de un periodo son la medianoche local de la empresa (Europe/Madrid; Atlantic/Canary
 *   en Canarias), no la medianoche UTC.
 *
 * Con esa regla las dos formas caen en su día civil: España va siempre entre UTC+0 y UTC+2, así
 * que las 00:00 UTC de un día son las 00:00, 01:00 o 02:00 locales de ese mismo día (la fecha civil
 * guardada a medianoche UTC no cambia de día), y un ticket del 1 de abril a las 00:30 de Madrid
 * (31-03 22:30 UTC) queda ya en el segundo trimestre.
 */
export const FISCAL_TIME_ZONE_PENINSULA = "Europe/Madrid";
export const FISCAL_TIME_ZONE_CANARY = "Atlantic/Canary";

/** Zona horaria fiscal según el territorio de la empresa (ES-CN → Canarias; resto → península). */
export function fiscalTimeZoneFor(territory?: string | null) {
  return territory === "ES-CN" ? FISCAL_TIME_ZONE_CANARY : FISCAL_TIME_ZONE_PENINSULA;
}

const civilDateFormatters = new Map<string, Intl.DateTimeFormat>();

function civilDateFormatter(timeZone: string) {
  let formatter = civilDateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    civilDateFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function localParts(instant: Date, timeZone: string) {
  const parts: Record<string, number> = {};
  for (const part of civilDateFormatter(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return parts as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Fecha civil (año, mes 1-12, día) de un instante en la zona horaria fiscal. */
export function fiscalCivilDate(instant: Date, timeZone: string = FISCAL_TIME_ZONE_PENINSULA) {
  const { year, month, day } = localParts(instant, timeZone);
  return { year, month, day };
}

/** Instante en que empieza (medianoche local) el día civil indicado; `monthIndex` de 0 a 11 y admite desbordes como `Date.UTC`. */
export function localMidnightInstant(year: number, monthIndex: number, day: number, timeZone: string = FISCAL_TIME_ZONE_PENINSULA) {
  const utcMidnight = Date.UTC(year, monthIndex, day);
  const offsetAt = (instant: number) => {
    const local = localParts(new Date(instant), timeZone);
    return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - Math.floor(instant / 1000) * 1000;
  };
  // Dos pasadas por si el desfase cambia entre la medianoche UTC y la local (cambio de hora).
  const first = utcMidnight - offsetAt(utcMidnight);
  return new Date(utcMidnight - offsetAt(first));
}

/**
 * Límite de periodo como instante real. Un límite expresado como fecha civil (00:00:00.000 UTC, lo
 * que devuelve `parseSpanishFiscalPeriod`) pasa a la medianoche local de ese día; cualquier otro
 * valor ya es un instante y se deja igual (la conversión es idempotente).
 */
export function fiscalBoundaryInstant(boundary: Date, timeZone: string = FISCAL_TIME_ZONE_PENINSULA) {
  if (boundary.getTime() % 86_400_000 !== 0) return boundary;
  return localMidnightInstant(boundary.getUTCFullYear(), boundary.getUTCMonth(), boundary.getUTCDate(), timeZone);
}

/** Rango [inicio, fin) de un periodo en instantes reales (medianoche local). */
export function fiscalRangeInstants(range: { start: Date; endExclusive: Date }, timeZone: string = FISCAL_TIME_ZONE_PENINSULA) {
  return { start: fiscalBoundaryInstant(range.start, timeZone), endExclusive: fiscalBoundaryInstant(range.endExclusive, timeZone) };
}

/** Trimestre (0-3) de un instante según su fecha civil local. */
export function fiscalQuarterIndex(instant: Date, timeZone: string = FISCAL_TIME_ZONE_PENINSULA) {
  return Math.floor((fiscalCivilDate(instant, timeZone).month - 1) / 3);
}

/** Último periodo de liquidación del ejercicio (4T o mes 12). */
export function isLastVatPeriodOfYear(period: string) {
  return /^(20\d{2})-(Q4|12)$/.test(period.trim().toUpperCase());
}

/** Periodos anteriores del mismo ejercicio y con la misma forma (trimestres o meses) que el indicado. */
export function previousPeriodsOfYear(period: string): string[] {
  const value = period.trim().toUpperCase();
  const quarter = /^(20\d{2})-Q([1-4])$/.exec(value);
  if (quarter) return Array.from({ length: Number(quarter[2]) - 1 }, (_, index) => `${quarter[1]}-Q${index + 1}`);
  const month = /^(20\d{2})-(0[1-9]|1[0-2])$/.exec(value);
  if (month) return Array.from({ length: Number(month[2]) - 1 }, (_, index) => `${month[1]}-${String(index + 1).padStart(2, "0")}`);
  return [];
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
const JANUARY_30_MODELS = new Set<SpanishFiscalModelCode>(["303", "130", "349", "420", "450"]);

/**
 * Si el último día del plazo es sábado o domingo, pasa al lunes (los plazos tributarios que
 * terminan en día inhábil se trasladan al primer día hábil siguiente). Los festivos nacionales,
 * autonómicos y locales no se tienen en cuenta: dependen del domicilio fiscal.
 */
export function nextBusinessDay(date: Date) {
  const day = date.getUTCDay();
  const shift = day === 6 ? 2 : day === 0 ? 1 : 0;
  return shift === 0 ? date : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + shift));
}

/** Último día del plazo de presentación, ya trasladado si cae en fin de semana. */
export function getSpanishFiscalDueDate(period: string, modelCode: SpanishFiscalModelCode) {
  const nominal = nominalSpanishFiscalDueDate(period, modelCode);
  return nominal ? nextBusinessDay(nominal) : null;
}

/** Modelos con ingreso que admiten domiciliación bancaria en la AEAT (los informativos y los de la ATC, no). */
const DIRECT_DEBIT_MODELS = new Set<SpanishFiscalModelCode>(["303", "111", "115", "130", "123"]);

/**
 * Último día para presentar con domiciliación bancaria: tres días hábiles antes del fin del plazo
 * de presentación (ya trasladado si cae en fin de semana). Da el 15 cuando el plazo acaba el 20 y
 * el 25 cuando acaba el 30, y los traslada como la AEAT cuando esos días no son hábiles.
 *
 * CONTRASTADO con «Plazos de presentación de autoliquidaciones con domiciliación bancaria» del
 * calendario del contribuyente 2026 de la AEAT (actualizado el 17-12-2025) para el 303 trimestral:
 * 4T 2025 del 1 al 27 de enero (presentación hasta el 30); 1T, 2T y 3T de 2026 hasta el 15 de
 * abril, julio y octubre (presentación hasta el 20). La página dice que entre el fin de la
 * domiciliación y el del plazo debe haber al menos tres días hábiles o cinco naturales; la fórmula
 * de «tres días hábiles» reproduce las cuatro fechas publicadas.
 *
 * NO CONTRASTADO: que el 111, el 115 y el 130 sigan la misma regla (es la general de la Orden
 * EHA/1658/2009, pero la página consultada solo lista el 303), el 303 mensual, y los festivos
 * (solo se descuentan sábados y domingos).
 */
export function getSpanishFiscalDirectDebitDate(period: string, modelCode: SpanishFiscalModelCode) {
  if (!DIRECT_DEBIT_MODELS.has(modelCode)) return null;
  const dueDate = getSpanishFiscalDueDate(period, modelCode);
  if (!dueDate) return null;
  let date = dueDate;
  for (let businessDays = 0; businessDays < 3;) {
    date = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - 1));
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) businessDays += 1;
  }
  return date;
}

function nominalSpanishFiscalDueDate(period: string, modelCode: SpanishFiscalModelCode) {
  const value = period.trim().toUpperCase();
  const annualMatch = /^(20\d{2})$/.exec(value);
  const quarterMatch = /^(20\d{2})-Q([1-4])$/.exec(value);
  const monthMatch = /^(20\d{2})-(0[1-9]|1[0-2])$/.exec(value);

  // Modelo 202: 20 de abril, octubre y diciembre (art. 40.1 de la Ley 27/2014).
  const installmentMatch = modelCode === "202" ? /^(20\d{2})-([123])P$/.exec(value) : null;
  if (installmentMatch) return new Date(Date.UTC(Number(installmentMatch[1]), [3, 9, 11][Number(installmentMatch[2]) - 1], 20));

  if (annualMatch) {
    const year = Number(annualMatch[1]);
    // Modelo 200 de un ejercicio que coincide con el año natural: 25 de julio (art. 124.1 de la Ley 27/2014).
    // Para otros cierres, ver `corporateTaxReturnWindow` en `@/server/corporate-tax/deadlines`.
    if (modelCode === "200") return new Date(Date.UTC(year + 1, 6, 25));
    if (modelCode === "390" || modelCode === "425") return new Date(Date.UTC(year + 1, 0, 30));
    if (modelCode === "347") return lastDayOfMonthUtc(year + 1, 2);
    // Resúmenes anuales de retenciones: del 1 al 31 de enero (Órdenes EHA/3127/2009 y EHA/3377/2011; el 180, según la sede).
    if (modelCode === "190" || modelCode === "180" || modelCode === "193") return new Date(Date.UTC(year + 1, 0, 31));
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
    // 303 mensual: del 1 al 30 del mes siguiente; el de enero, hasta el último día de febrero.
    if (modelCode === "303") return month === 1 ? lastDayOfMonthUtc(year, 2) : new Date(Date.UTC(dueYear, dueMonth, 30));
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
export type { SalesVatTreatment, SupplierVatTreatment };

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

/**
 * Tratamiento IVA de una venta ya registrada: el explícito o, en datos antiguos sin él, el que
 * resulta del país del cliente respecto al de la empresa (por defecto España).
 */
export function resolveSalesVatTreatment(
  explicit: string | null | undefined,
  customerCountryCode: string | null | undefined,
  homeCountry?: string | null,
): SalesVatTreatment {
  if (explicit && salesVatTreatments.has(explicit as SalesVatTreatment)) return explicit as SalesVatTreatment;
  const home = normalizeHomeCountry(homeCountry);
  const country = normalizeCountryCode(customerCountryCode) || home;
  if (country === home) return "DOMESTIC";
  return isIntraCommunity(home, country) ? "INTRA_EU" : "EXPORT";
}

/**
 * Tratamiento IVA de una compra: explícito o deducido del país y del tipo de proveedor.
 * Proveedor UE → adquisición intracomunitaria (autorepercusión). Fuera de la UE: servicios →
 * inversión del sujeto pasivo (art. 84.Uno.2º LIVA, se autorepercute); bienes → importación
 * (el IVA se liquida en aduana con el DUA, no en la factura del proveedor).
 */
export function resolveSupplierVatTreatment(
  explicit: string | null | undefined,
  supplierCountryCode: string | null | undefined,
  supplierKind?: string | null,
  homeCountry?: string | null,
): SupplierVatTreatment {
  if (explicit && supplierVatTreatments.has(explicit as SupplierVatTreatment)) return explicit as SupplierVatTreatment;
  return suggestSupplierVatTreatment({ countryCode: supplierCountryCode, supplierKind }, { homeCountry });
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
export function reverseChargeTaxAmount(subtotal: number, lineTaxAmount: number, defaultRate = REVERSE_CHARGE_DEFAULT_RATE) {
  if (lineTaxAmount !== 0) return roundMoney(lineTaxAmount);
  return roundMoney((subtotal * defaultRate) / 100);
}

type Modelo303RateBoxes = Record<string, { base: string; rate: string; tax: string }>;

/**
 * Recargo de equivalencia → casillas del modelo 303 (instrucciones AEAT del ejercicio 2025 en
 * adelante): 1,75 % en 156-158, 0,5 % en 168-170, 1,4 % en 19-21 y 5,2 % en 22-24.
 */
export const surchargeBoxesByRate: Modelo303RateBoxes = {
  "0.5": { base: "168", rate: "169", tax: "170" },
  "1.4": { base: "19", rate: "20", tax: "21" },
  "5.2": { base: "22", rate: "23", tax: "24" },
  "1.75": { base: "156", rate: "157", tax: "158" },
};

/** Diseño de 2023-2024 (tipos transitorios del 0 % y 5 % con sus recargos del 0 % y 0,62 %). */
const surchargeBoxesByRateUntil2024: Modelo303RateBoxes = {
  "0.5": { base: "16", rate: "17", tax: "18" },
  "1.4": { base: "19", rate: "20", tax: "21" },
  "5.2": { base: "22", rate: "23", tax: "24" },
  "1.75": { base: "156", rate: "157", tax: "158" },
  "0.62": { base: "168", rate: "169", tax: "170" },
};

/** IVA devengado régimen general → casillas del modelo 303 (2025 en adelante: 0, 4, 10 y 21 %). */
export const outputVatBoxesByRate: Modelo303RateBoxes = {
  "0": { base: "150", rate: "151", tax: "152" },
  "4": { base: "01", rate: "02", tax: "03" },
  "10": { base: "04", rate: "05", tax: "06" },
  "21": { base: "07", rate: "08", tax: "09" },
};

const outputVatBoxesByRateUntil2024: Modelo303RateBoxes = {
  ...outputVatBoxesByRate,
  "5": { base: "153", rate: "154", tax: "155" },
};

/** Casillas por tipo del 303 según el ejercicio del periodo declarado. */
export function modelo303RateBoxes(periodYear: number) {
  return periodYear <= 2024
    ? { output: outputVatBoxesByRateUntil2024, surcharge: surchargeBoxesByRateUntil2024 }
    : { output: outputVatBoxesByRate, surcharge: surchargeBoxesByRate };
}

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
