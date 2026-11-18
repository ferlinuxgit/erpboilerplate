import { MODULE_IDS, type ModuleId } from "@/modules/registry";

/**
 * Catálogo de precios del SaaS (código puro: lo usan servidor, pantallas y tests). Precios en
 * céntimos de euro al mes, IVA no incluido (Stripe Tax añade el que corresponda al cliente).
 *
 * - Plan base «Contabilidad y facturación» (9 €/mes): el núcleo de la aplicación (facturas, gastos,
 *   contabilidad, impuestos, clientes, proveedores, artículos, cuentas bancarias…).
 * - Cada módulo opcional (src/modules/registry.ts) se contrata aparte por un precio mensual.
 * - La lectura de facturas con IA consume créditos prepagados (packs), que cubren el coste real de
 *   la API de OpenAI con margen. Ver `creditsForUsage`.
 *
 * Cambiar un precio aquí crea un precio nuevo en Stripe la próxima vez que se contrate; las
 * suscripciones existentes conservan el suyo.
 */

export const BILLING_CURRENCY = "eur";

/** Días de prueba gratuita con todo incluido para un espacio nuevo. */
export const TRIAL_DAYS = 14;
/** Créditos de lectura de facturas incluidos al darse de alta. */
export const WELCOME_OCR_CREDITS = 25;
/** Días que sigue funcionando todo tras un pago fallido antes de pasar a solo lectura. */
export const PAST_DUE_GRACE_DAYS = 7;
/** Días entre la solicitud de baja de un espacio y el borrado de sus datos (se puede anular). */
export const TENANT_DELETION_GRACE_DAYS = 30;

export const BASE_PLAN = {
  code: "base",
  name: "Contabilidad y facturación",
  monthlyCents: 900,
  description: "Todo lo esencial para facturar y llevar la contabilidad de tu empresa.",
  features: [
    "Facturas, abonos y facturas recurrentes con VERI*FACTU",
    "Gastos y facturas de proveedores",
    "Contabilidad automática, libros y cuentas anuales",
    "Impuestos: modelos 303, 111, 115, 130, 347, 390…",
    "Clientes, proveedores, artículos y cuentas bancarias",
    "Usuarios ilimitados y conexión con Claude y ChatGPT",
  ],
} as const;

/** Precio mensual de cada módulo opcional (céntimos, IVA no incluido). */
export const MODULE_MONTHLY_CENTS: Record<ModuleId, number> = {
  "sales-documents": 300,
  "purchase-orders": 300,
  inventory: 600,
  banking: 600,
  "invoice-reading": 300,
  crm: 500,
  pos: 900,
  hospitality: 1200,
  timesheets: 400,
};

export type OcrPack = { code: string; credits: number; cents: number };

/** Packs de créditos de lectura de facturas con IA (pago único, IVA no incluido). */
export const OCR_PACKS: readonly OcrPack[] = [
  { code: "ocr-100", credits: 100, cents: 500 },
  { code: "ocr-500", credits: 500, cents: 1900 },
  { code: "ocr-2000", credits: 2000, cents: 5900 },
];

/**
 * Precio de la API de OpenAI por millón de tokens (USD) de los modelos de lectura de facturas.
 * Fuente: tarifa pública de gpt-6-luna (0,10 $ entrada, 0,01 $ entrada en caché, 0,50 $ salida).
 */
export const OCR_MODEL_PRICES_USD_PER_MTOK: Record<string, { input: number; cachedInput: number; output: number }> = {
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5 },
};
/** Si el modelo no está en la tabla se presupone uno caro para no perder dinero. */
const UNKNOWN_MODEL_PRICE = { input: 2.5, cachedInput: 1.25, output: 10 };

/**
 * Un crédito cubre hasta 0,002 $ de coste de API: una factura normal de 1-3 páginas (≈6.000
 * tokens de entrada y ≈2.000 de salida con gpt-6-luna ≈ 0,0016 $) gasta 1 crédito; un PDF largo,
 * proporcionalmente más. Con el pack más barato (5 € / 100) el crédito se vende a 0,05 €.
 */
export const OCR_CREDIT_COVERS_MICRO_USD = 2_000;

export type OcrUsage = { model: string; inputTokens: number; cachedInputTokens?: number; outputTokens: number };

/** Coste real de una lectura en millonésimas de dólar. */
export function ocrUsageCostMicroUsd(usage: OcrUsage) {
  const price = OCR_MODEL_PRICES_USD_PER_MTOK[usage.model] ?? UNKNOWN_MODEL_PRICE;
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const fresh = usage.inputTokens - cached;
  // Precio por millón de tokens = millonésimas de dólar por token.
  return Math.ceil(fresh * price.input + cached * price.cachedInput + usage.outputTokens * price.output);
}

/** Créditos que descuenta una lectura: al menos 1, y uno más por cada tramo de coste. */
export function creditsForUsage(usage: OcrUsage) {
  return Math.max(1, Math.ceil(ocrUsageCostMicroUsd(usage) / OCR_CREDIT_COVERS_MICRO_USD));
}

export function modulePriceCode(moduleId: ModuleId) {
  return `module:${moduleId}`;
}

export function isPaidModule(value: string): value is ModuleId {
  return (MODULE_IDS as readonly string[]).includes(value);
}

/** Total mensual en céntimos de un plan base con estos módulos. */
export function monthlyTotalCents(modules: readonly ModuleId[]) {
  return BASE_PLAN.monthlyCents + [...new Set(modules)].reduce((total, moduleId) => total + MODULE_MONTHLY_CENTS[moduleId], 0);
}

export function formatEuros(cents: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}
