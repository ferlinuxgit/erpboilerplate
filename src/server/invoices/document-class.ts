/**
 * Clase de documento de una factura emitida (código puro, también usable en cliente).
 *
 * Real Decreto 1619/2012 (Reglamento de facturación):
 * - art. 6: factura completa;
 * - arts. 4 y 7.1: factura simplificada (hasta 400 €, o 3.000 € en las actividades del art. 4.2);
 * - arts. 7.2 y 7.3: factura simplificada «cualificada», que además identifica al destinatario
 *   (NIF y domicilio) y desglosa la cuota, para que este pueda deducir el IVA.
 *
 * La clase se fija al emitir y queda congelada en `invoice.documentClass`. En las facturas
 * anteriores a esta columna (null) se deduce como se hacía: con NIF del cliente es completa y sin
 * NIF es simplificada.
 */

export type InvoiceDocumentClass = "FULL" | "SIMPLIFIED" | "SIMPLIFIED_QUALIFIED";

export const INVOICE_DOCUMENT_CLASSES: InvoiceDocumentClass[] = ["FULL", "SIMPLIFIED", "SIMPLIFIED_QUALIFIED"];

export const documentClassLabels: Record<InvoiceDocumentClass, string> = {
  FULL: "Factura completa",
  SIMPLIFIED: "Factura simplificada",
  SIMPLIFIED_QUALIFIED: "Factura simplificada con datos del destinatario",
};

/** Etiqueta corta para listados y distintivos. */
export const documentClassShortLabels: Record<InvoiceDocumentClass, string> = {
  FULL: "Completa",
  SIMPLIFIED: "Simplificada",
  SIMPLIFIED_QUALIFIED: "Simplificada con destinatario",
};

export const documentClassHelp: Record<InvoiceDocumentClass, string> = {
  FULL: "La factura de siempre, con todos los datos del cliente (NIF y domicilio).",
  SIMPLIFIED: "Ticket sin datos del cliente. Solo hasta el límite legal (400 € o 3.000 € según la actividad).",
  SIMPLIFIED_QUALIFIED: "Ticket que además lleva el NIF y el domicilio del cliente, para que pueda deducir el IVA (arts. 7.2 y 7.3).",
};

export function isInvoiceDocumentClass(value: unknown): value is InvoiceDocumentClass {
  return typeof value === "string" && (INVOICE_DOCUMENT_CLASSES as string[]).includes(value);
}

export function isSimplifiedClass(value: InvoiceDocumentClass | null | undefined) {
  return value === "SIMPLIFIED" || value === "SIMPLIFIED_QUALIFIED";
}

/** Clase de una factura ya guardada: la congelada o, en las antiguas, la que resulta del NIF del cliente. */
export function effectiveDocumentClass(input: { documentClass?: string | null; customerTaxId: string | null | undefined }): InvoiceDocumentClass {
  if (isInvoiceDocumentClass(input.documentClass)) return input.documentClass;
  return input.customerTaxId?.trim() ? "FULL" : "SIMPLIFIED";
}

/**
 * Art. 4.4: no cabe factura simplificada en las entregas intracomunitarias de bienes (art. 25 de la
 * Ley del IVA) ni en las operaciones con inversión del sujeto pasivo localizadas en otro Estado
 * miembro (art. 2.3); tampoco la usamos en la inversión del sujeto pasivo interior, que exige las
 * menciones de la factura completa (art. 6.1.m). Las ventas a distancia (art. 68.Tres y Cinco)
 * no tienen tratamiento propio en el programa: no se pueden detectar aquí.
 */
const TREATMENTS_WITHOUT_SIMPLIFIED = new Set(["INTRA_EU", "INTRA_EU_SERVICES", "REVERSE_CHARGE"]);

export function simplifiedAllowedForTreatment(vatTreatment: string | null | undefined) {
  return !TREATMENTS_WITHOUT_SIMPLIFIED.has(vatTreatment ?? "DOMESTIC");
}

export type ResolveDocumentClassInput = {
  /** Clase elegida en el borrador; null o undefined = automática. */
  requested?: string | null;
  customerTaxId: string | null | undefined;
  vatTreatment: string | null | undefined;
  /** Venta del TPV: con NIF del cliente es una simplificada cualificada, no una factura completa. */
  ticket?: boolean;
  totalAmount: number;
  /** Límite de la simplificada que aplica (empresa o caja), en la moneda de la factura. */
  limit: number;
};

export type ResolvedDocumentClass = { documentClass: InvoiceDocumentClass; problem: null } | { documentClass: null; problem: string };

/**
 * Clase con la que se emite una factura. Sin elección expresa nunca falla por la clase: elige la
 * que la ley permite (un ticket con NIF por encima del límite, o intracomunitario, sale como
 * factura completa). Con elección expresa se comprueba que sea posible y se explica por qué no.
 */
export function resolveDocumentClass(input: ResolveDocumentClassInput): ResolvedDocumentClass {
  const hasTaxId = Boolean(input.customerTaxId?.trim());
  const treatmentAllows = simplifiedAllowedForTreatment(input.vatTreatment);
  const requested = isInvoiceDocumentClass(input.requested) ? input.requested : null;

  if (!requested) {
    if (!hasTaxId) return { documentClass: "SIMPLIFIED", problem: null };
    if (input.ticket && treatmentAllows && Math.abs(input.totalAmount) <= input.limit) return { documentClass: "SIMPLIFIED_QUALIFIED", problem: null };
    return { documentClass: "FULL", problem: null };
  }
  if (requested === "FULL") {
    if (!hasTaxId) return { documentClass: null, problem: "Una factura completa necesita el NIF del cliente. Complétalo en su ficha o emítela como factura simplificada." };
    return { documentClass: "FULL", problem: null };
  }
  if (!treatmentAllows) {
    return { documentClass: null, problem: "Las operaciones intracomunitarias y las de inversión del sujeto pasivo no admiten factura simplificada (art. 4.4 del Reglamento de facturación). Emítela como factura completa." };
  }
  if (requested === "SIMPLIFIED_QUALIFIED" && !hasTaxId) {
    return { documentClass: null, problem: "La factura simplificada con datos del destinatario necesita el NIF del cliente (art. 7.2 del Reglamento de facturación). Complétalo en su ficha o emítela como simplificada sin datos." };
  }
  return { documentClass: requested, problem: null };
}

/** Título impreso del documento (PDF y ticket). */
export function documentClassTitle(documentClass: InvoiceDocumentClass) {
  return documentClass === "FULL" ? "Factura" : "Factura simplificada";
}
