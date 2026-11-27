/**
 * Tabla de amortización lineal del artículo 12.1.a) de la Ley 27/2014, del Impuesto sobre
 * Sociedades (BOE-A-2014-12328): coeficiente lineal máximo y periodo máximo por tipo de elemento.
 *
 * Valores contrastados el 27-11-2026 con el texto consolidado del BOE mediante una lectura
 * automática de la página (33 filas, todas coincidentes). Es una ayuda para elegir el porcentaje:
 * el usuario puede poner el suyo y el programa solo avisa si se sale del rango fiscal.
 */

export type TaxCoefficient = {
  key: string;
  group: string;
  label: string;
  /** Coeficiente lineal máximo (% anual). */
  maxPct: number;
  /** Periodo máximo de amortización (años). */
  maxYears: number;
};

export const TAX_COEFFICIENTS: readonly TaxCoefficient[] = [
  { key: "obra-civil-general", group: "Obra civil", label: "Obra civil general", maxPct: 2, maxYears: 100 },
  { key: "pavimentos", group: "Obra civil", label: "Pavimentos", maxPct: 6, maxYears: 34 },
  { key: "infraestructuras-mineras", group: "Obra civil", label: "Infraestructuras y obras mineras", maxPct: 7, maxYears: 30 },

  { key: "centrales-hidraulicas", group: "Centrales", label: "Centrales hidráulicas", maxPct: 2, maxYears: 100 },
  { key: "centrales-nucleares", group: "Centrales", label: "Centrales nucleares", maxPct: 3, maxYears: 60 },
  { key: "centrales-carbon", group: "Centrales", label: "Centrales de carbón", maxPct: 4, maxYears: 50 },
  { key: "centrales-renovables", group: "Centrales", label: "Centrales renovables", maxPct: 7, maxYears: 30 },
  { key: "otras-centrales", group: "Centrales", label: "Otras centrales", maxPct: 5, maxYears: 40 },

  { key: "edificios-industriales", group: "Edificios", label: "Edificios industriales", maxPct: 3, maxYears: 68 },
  { key: "escombreras", group: "Edificios", label: "Terrenos dedicados exclusivamente a escombreras", maxPct: 4, maxYears: 50 },
  { key: "almacenes-depositos", group: "Edificios", label: "Almacenes y depósitos (gaseosos, líquidos y sólidos)", maxPct: 7, maxYears: 30 },
  { key: "edificios-comerciales", group: "Edificios", label: "Edificios comerciales, administrativos, de servicios y viviendas", maxPct: 2, maxYears: 100 },

  { key: "subestaciones-redes", group: "Instalaciones", label: "Subestaciones. Redes de transporte y distribución de energía", maxPct: 5, maxYears: 40 },
  { key: "cables", group: "Instalaciones", label: "Cables", maxPct: 7, maxYears: 30 },
  { key: "resto-instalaciones", group: "Instalaciones", label: "Resto de instalaciones", maxPct: 10, maxYears: 20 },
  { key: "maquinaria", group: "Instalaciones", label: "Maquinaria", maxPct: 12, maxYears: 18 },
  { key: "equipos-medicos", group: "Instalaciones", label: "Equipos médicos y asimilados", maxPct: 15, maxYears: 14 },

  { key: "locomotoras-vagones", group: "Elementos de transporte", label: "Locomotoras, vagones y equipos de tracción", maxPct: 8, maxYears: 25 },
  { key: "buques-aeronaves", group: "Elementos de transporte", label: "Buques, aeronaves", maxPct: 10, maxYears: 20 },
  { key: "transporte-interno", group: "Elementos de transporte", label: "Elementos de transporte interno", maxPct: 10, maxYears: 20 },
  { key: "transporte-externo", group: "Elementos de transporte", label: "Elementos de transporte externo (turismos, furgonetas…)", maxPct: 16, maxYears: 14 },
  { key: "autocamiones", group: "Elementos de transporte", label: "Autocamiones", maxPct: 20, maxYears: 10 },

  { key: "mobiliario", group: "Mobiliario y enseres", label: "Mobiliario", maxPct: 10, maxYears: 20 },
  { key: "lenceria", group: "Mobiliario y enseres", label: "Lencería", maxPct: 25, maxYears: 8 },
  { key: "cristaleria", group: "Mobiliario y enseres", label: "Cristalería", maxPct: 50, maxYears: 4 },
  { key: "utiles-herramientas", group: "Mobiliario y enseres", label: "Útiles y herramientas", maxPct: 25, maxYears: 8 },
  { key: "moldes-matrices", group: "Mobiliario y enseres", label: "Moldes, matrices y modelos", maxPct: 33, maxYears: 6 },
  { key: "otros-enseres", group: "Mobiliario y enseres", label: "Otros enseres", maxPct: 15, maxYears: 14 },

  { key: "equipos-electronicos", group: "Equipos electrónicos e informáticos. Sistemas y programas", label: "Equipos electrónicos", maxPct: 20, maxYears: 10 },
  { key: "equipos-informaticos", group: "Equipos electrónicos e informáticos. Sistemas y programas", label: "Equipos para procesos de información (ordenadores)", maxPct: 25, maxYears: 8 },
  { key: "programas-informaticos", group: "Equipos electrónicos e informáticos. Sistemas y programas", label: "Sistemas y programas informáticos", maxPct: 33, maxYears: 6 },
  { key: "producciones-audiovisuales", group: "Equipos electrónicos e informáticos. Sistemas y programas", label: "Producciones cinematográficas, fonográficas, vídeos y series audiovisuales", maxPct: 33, maxYears: 6 },

  { key: "otros-elementos", group: "Otros", label: "Otros elementos", maxPct: 10, maxYears: 20 },
];

const BY_KEY = new Map(TAX_COEFFICIENTS.map((entry) => [entry.key, entry]));

export function findTaxCoefficient(key: string | null | undefined): TaxCoefficient | null {
  return (key && BY_KEY.get(key)) || null;
}

/** Tipo de elemento que se propone según la cuenta del inmovilizado (solo donde la correspondencia es clara). */
const SUGGESTED_BY_ACCOUNT: Record<string, string> = {
  "206": "programas-informaticos",
  "211": "edificios-comerciales",
  "212": "resto-instalaciones",
  "213": "maquinaria",
  "214": "utiles-herramientas",
  "215": "resto-instalaciones",
  "216": "mobiliario",
  "217": "equipos-informaticos",
  "218": "transporte-externo",
  "219": "otros-elementos",
  "221": "edificios-comerciales",
};

export function suggestedTaxCoefficientKey(assetAccountCode: string): string | null {
  return SUGGESTED_BY_ACCOUNT[assetAccountCode.slice(0, 3)] ?? null;
}

const pctFormat = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });

/**
 * Aviso (no bloquea) si el porcentaje anual se sale del rango fiscal del tipo de elemento:
 * por encima del coeficiente máximo (el exceso no es deducible) o por debajo del mínimo que
 * resulta del periodo máximo.
 */
export function taxCoefficientWarning(annualPct: number | null | undefined, key: string | null | undefined): string | null {
  const coefficient = findTaxCoefficient(key);
  if (!coefficient || annualPct === null || annualPct === undefined || !Number.isFinite(annualPct) || annualPct <= 0) return null;
  if (annualPct > coefficient.maxPct + 1e-9) {
    return `El ${pctFormat.format(annualPct)} % supera el coeficiente máximo fiscal del ${pctFormat.format(coefficient.maxPct)} % para «${coefficient.label}» (art. 12.1.a de la Ley 27/2014). El exceso de amortización no es deducible salvo que se justifique la depreciación efectiva o se aplique un régimen especial (libertad de amortización, empresas de reducida dimensión…).`;
  }
  const minPct = 100 / coefficient.maxYears;
  if (annualPct < minPct - 1e-9) {
    return `El ${pctFormat.format(annualPct)} % alarga la amortización más allá del periodo máximo fiscal de ${coefficient.maxYears} años para «${coefficient.label}» (mínimo ${pctFormat.format(minPct)} % anual).`;
  }
  return null;
}
