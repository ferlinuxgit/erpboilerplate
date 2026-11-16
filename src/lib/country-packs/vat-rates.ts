/**
 * Tipos del impuesto sobre el consumo (IVA / VAT / GST) por país. Solo datos, sin dependencias:
 * lo usan la plantilla genérica y los paquetes de país.
 *
 * - `standard`: tipo general (el que se propone por defecto en las líneas).
 * - `reduced`: tipos reducidos habituales, de mayor a menor.
 * - `superReduced`: tipo superreducido, si existe.
 * - `system`: VAT (IVA con deducción), SALES_TAX (impuesto de ventas en destino, por estado o
 *   provincia: no se puede fijar un tipo nacional) o NONE (sin impuesto general al consumo).
 *
 * Revisado: 2026-11. Antes de pasar un país a cumplimiento completo hay que verificar sus tipos
 * con la fuente oficial (para la UE, la base de datos TEDB de la Comisión Europea).
 */

export type ConsumptionTaxSystem = "VAT" | "SALES_TAX" | "NONE";

export type CountryVatRates = {
  system: ConsumptionTaxSystem;
  /** Nombre local del impuesto, para nombrar los impuestos creados ("IVA", "TVA", "MwSt"…). */
  label: string;
  standard: number;
  reduced?: readonly number[];
  superReduced?: number;
  /** Tipos incrementados (IGIC: 9,5 % y 15 %). */
  increased?: readonly number[];
  /** Tipo cero explícito (IGIC). */
  zeroRated?: boolean;
  /**
   * Todos los tipos del territorio (IPSI de Ceuta y Melilla: dependen de la actividad). Se crean
   * todos; `standard` es el general que se propone por defecto.
   */
  allRates?: readonly number[];
};

export const VAT_RATES_REVIEWED_AT = "2026-11";

export const COUNTRY_VAT_RATES: Readonly<Record<string, CountryVatRates>> = {
  // Unión Europea
  AT: { system: "VAT", label: "USt", standard: 20, reduced: [13, 10] },
  BE: { system: "VAT", label: "TVA/BTW", standard: 21, reduced: [12, 6] },
  BG: { system: "VAT", label: "ДДС", standard: 20, reduced: [9] },
  CY: { system: "VAT", label: "ΦΠΑ", standard: 19, reduced: [9, 5] },
  CZ: { system: "VAT", label: "DPH", standard: 21, reduced: [12] },
  DE: { system: "VAT", label: "MwSt", standard: 19, reduced: [7] },
  DK: { system: "VAT", label: "Moms", standard: 25 },
  EE: { system: "VAT", label: "KM", standard: 24, reduced: [13, 9] },
  ES: { system: "VAT", label: "IVA", standard: 21, reduced: [10], superReduced: 4 },
  FI: { system: "VAT", label: "ALV", standard: 25.5, reduced: [13.5, 10] },
  FR: { system: "VAT", label: "TVA", standard: 20, reduced: [10, 5.5], superReduced: 2.1 },
  GR: { system: "VAT", label: "ΦΠΑ", standard: 24, reduced: [13, 6] },
  HR: { system: "VAT", label: "PDV", standard: 25, reduced: [13, 5] },
  HU: { system: "VAT", label: "ÁFA", standard: 27, reduced: [18, 5] },
  IE: { system: "VAT", label: "VAT", standard: 23, reduced: [13.5, 9], superReduced: 4.8 },
  IT: { system: "VAT", label: "IVA", standard: 22, reduced: [10, 5], superReduced: 4 },
  LT: { system: "VAT", label: "PVM", standard: 21, reduced: [9, 5] },
  LU: { system: "VAT", label: "TVA", standard: 17, reduced: [14, 8], superReduced: 3 },
  LV: { system: "VAT", label: "PVN", standard: 21, reduced: [12, 5] },
  MT: { system: "VAT", label: "VAT", standard: 18, reduced: [7, 5] },
  NL: { system: "VAT", label: "BTW", standard: 21, reduced: [9] },
  PL: { system: "VAT", label: "VAT", standard: 23, reduced: [8, 5] },
  PT: { system: "VAT", label: "IVA", standard: 23, reduced: [13, 6] },
  RO: { system: "VAT", label: "TVA", standard: 21, reduced: [11] },
  SE: { system: "VAT", label: "Moms", standard: 25, reduced: [12, 6] },
  SI: { system: "VAT", label: "DDV", standard: 22, reduced: [9.5, 5] },
  SK: { system: "VAT", label: "DPH", standard: 23, reduced: [19, 5] },

  // Territorios españoles fuera del IVA (códigos ISO 3166-2)
  "ES-CN": { system: "VAT", label: "IGIC", standard: 7, reduced: [3], increased: [9.5, 15], zeroRated: true },
  // IPSI de Ceuta: art. 33 de su ordenanza fiscal (texto refundido con modificaciones hasta el
  // BOCCE 6391 de 15-03-2024). Servicios e inmuebles al 4 % general; 10 % telecomunicaciones y obra
  // pública; 9 % agrupaciones 84 y 92 del IAE; 6 % agrupación 75 y 9221.1; 2 % restauración de un
  // tenedor, bares, taxis y VPO; 1 % agua y electricidad; 0,5 % servicios electrónicos, publicidad,
  // call center y proyectos estratégicos. La producción e importación de bienes, por su anexo 1.
  "ES-CE": { system: "VAT", label: "IPSI", standard: 4, allRates: [10, 9, 6, 4, 2, 1, 0.5] },
  // IPSI de Melilla: tipos publicados por la Ciudad Autónoma (actualizado 28-01-2026). Servicios e
  // inmuebles al 4 % general; 8 % telecomunicaciones; 10 % construcción y obra inmobiliaria; 2 %
  // restauración de dos o más tenedores y hostelería; 1 % taxis, bares y electricidad; 0,5 %
  // transporte colectivo, publicidad, servicios electrónicos y VPO.
  "ES-ML": { system: "VAT", label: "IPSI", standard: 4, allRates: [10, 8, 4, 2, 1, 0.5] },

  // Resto de Europa
  AD: { system: "VAT", label: "IGI", standard: 4.5, reduced: [2.5, 1] },
  AL: { system: "VAT", label: "TVSH", standard: 20, reduced: [6] },
  BA: { system: "VAT", label: "PDV", standard: 17 },
  CH: { system: "VAT", label: "MWST", standard: 8.1, reduced: [3.8, 2.6] },
  GB: { system: "VAT", label: "VAT", standard: 20, reduced: [5] },
  GE: { system: "VAT", label: "VAT", standard: 18 },
  IS: { system: "VAT", label: "VSK", standard: 24, reduced: [11] },
  LI: { system: "VAT", label: "MWST", standard: 8.1, reduced: [3.8, 2.6] },
  MC: { system: "VAT", label: "TVA", standard: 20, reduced: [10, 5.5], superReduced: 2.1 },
  MD: { system: "VAT", label: "TVA", standard: 20, reduced: [8] },
  ME: { system: "VAT", label: "PDV", standard: 21, reduced: [7] },
  MK: { system: "VAT", label: "ДДВ", standard: 18, reduced: [10, 5] },
  NO: { system: "VAT", label: "MVA", standard: 25, reduced: [15, 12] },
  RS: { system: "VAT", label: "ПДВ", standard: 20, reduced: [10] },
  TR: { system: "VAT", label: "KDV", standard: 20, reduced: [10, 1] },
  UA: { system: "VAT", label: "ПДВ", standard: 20, reduced: [14, 7] },

  // América
  AR: { system: "VAT", label: "IVA", standard: 21, reduced: [10.5] },
  BO: { system: "VAT", label: "IVA", standard: 13 },
  BR: { system: "SALES_TAX", label: "Impostos", standard: 0 },
  CA: { system: "VAT", label: "GST", standard: 5 },
  CL: { system: "VAT", label: "IVA", standard: 19 },
  CO: { system: "VAT", label: "IVA", standard: 19, reduced: [5] },
  CR: { system: "VAT", label: "IVA", standard: 13, reduced: [4, 2, 1] },
  DO: { system: "VAT", label: "ITBIS", standard: 18, reduced: [16] },
  EC: { system: "VAT", label: "IVA", standard: 15, reduced: [5] },
  GT: { system: "VAT", label: "IVA", standard: 12 },
  HN: { system: "VAT", label: "ISV", standard: 15, reduced: [18] },
  MX: { system: "VAT", label: "IVA", standard: 16, reduced: [8] },
  NI: { system: "VAT", label: "IVA", standard: 15 },
  PA: { system: "VAT", label: "ITBMS", standard: 7, reduced: [10] },
  PE: { system: "VAT", label: "IGV", standard: 18 },
  PY: { system: "VAT", label: "IVA", standard: 10, reduced: [5] },
  SV: { system: "VAT", label: "IVA", standard: 13 },
  US: { system: "SALES_TAX", label: "Sales tax", standard: 0 },
  UY: { system: "VAT", label: "IVA", standard: 22, reduced: [10] },
  VE: { system: "VAT", label: "IVA", standard: 16, reduced: [8] },

  // África, Asia y Oceanía
  AE: { system: "VAT", label: "VAT", standard: 5 },
  AU: { system: "VAT", label: "GST", standard: 10 },
  CN: { system: "VAT", label: "增值税", standard: 13, reduced: [9, 6] },
  DZ: { system: "VAT", label: "TVA", standard: 19, reduced: [9] },
  EG: { system: "VAT", label: "VAT", standard: 14 },
  GQ: { system: "VAT", label: "IVA", standard: 15, reduced: [6] },
  IL: { system: "VAT", label: "VAT", standard: 18 },
  IN: { system: "VAT", label: "GST", standard: 18, reduced: [5] },
  JP: { system: "VAT", label: "消費税", standard: 10, reduced: [8] },
  KR: { system: "VAT", label: "VAT", standard: 10 },
  MA: { system: "VAT", label: "TVA", standard: 20, reduced: [14, 10, 7] },
  NZ: { system: "VAT", label: "GST", standard: 15 },
  PH: { system: "VAT", label: "VAT", standard: 12 },
  SA: { system: "VAT", label: "VAT", standard: 15 },
  SG: { system: "VAT", label: "GST", standard: 9 },
  TN: { system: "VAT", label: "TVA", standard: 19, reduced: [13, 7] },
  ZA: { system: "VAT", label: "VAT", standard: 15 },
};

/**
 * Tipo general del IVA del país (el que se usa para autorepercutir cuando la factura del proveedor
 * no indica tipo). 0 en países sin IVA nacional o sin datos.
 */
export function standardVatRate(countryCode: string | null | undefined): number {
  const rates = countryVatRates(countryCode || "ES");
  return rates?.system === "VAT" ? rates.standard : 0;
}

/** Todos los tipos del impuesto del territorio, de mayor a menor (sin duplicados). */
export function allVatRates(countryCode: string | null | undefined): number[] {
  const rates = countryVatRates(countryCode || "ES");
  if (!rates || rates.system !== "VAT") return [];
  const values = [
    ...(rates.allRates ?? []),
    ...(rates.standard > 0 ? [rates.standard] : []),
    ...(rates.increased ?? []),
    ...(rates.reduced ?? []),
    ...(rates.superReduced ? [rates.superReduced] : []),
    ...(rates.zeroRated ? [0] : []),
  ];
  return [...new Set(values)].sort((left, right) => right - left);
}

export function countryVatRates(countryCode: string | null | undefined): CountryVatRates | null {
  const code = (countryCode ?? "").trim().toUpperCase();
  return COUNTRY_VAT_RATES[code === "EL" ? "GR" : code] ?? null;
}
