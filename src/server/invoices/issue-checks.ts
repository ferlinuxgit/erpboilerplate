/**
 * Comprobaciones legales antes de emitir una factura (funciones puras, Reglamento de facturación,
 * Real Decreto 1619/2012). Devuelven el mensaje para el usuario o null si todo está bien; quien
 * emite decide cómo fallar.
 */

import type { InvoicePartySnapshot } from "@/db/schema";
import { companyInvoiceReadiness } from "@/lib/company-readiness";
import { isEuCountry } from "@/lib/countries";
import { hasSpanishTaxIdFormat, isValidSpanishTaxId, normalizeSpanishTaxId } from "@/lib/spanish-tax-id";
import { isSimplifiedClass, type InvoiceDocumentClass } from "@/server/invoices/document-class";

/** Límite general de la factura simplificada (art. 4.1) y el de las actividades del art. 4.2. */
export const SIMPLIFIED_INVOICE_GENERAL_LIMIT = 400;
export const SIMPLIFIED_INVOICE_EXTENDED_LIMIT = 3000;

/** Art. 6.1.c-e: nombre, NIF y domicilio del emisor. */
export function issuerDataProblem(issuer: InvoicePartySnapshot): string | null {
  const { missing } = companyInvoiceReadiness({
    legalName: issuer.legalName ?? issuer.name,
    vatNumber: issuer.taxId,
    fiscalAddress: issuer.address,
    postalCode: issuer.postalCode,
    city: issuer.city,
    province: issuer.province,
    countryCode: issuer.countryCode,
  });
  if (missing.length === 0) return null;
  return `Faltan datos de tu empresa obligatorios en una factura: ${missing.join(", ").toLowerCase()}. Complétalos en Configuración › Empresa antes de emitir.`;
}

/** ¿El NIF es de una entidad (CIF: empieza por letra distinta de las de NIE y de K, L, M)? */
export function isEntityTaxId(taxId: string | null | undefined) {
  const value = normalizeSpanishTaxId(taxId).replace(/^ES/, "");
  return /^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(value);
}

/**
 * Art. 6.1.e: domicilio del destinatario. No es obligatorio cuando el destinatario es una persona
 * física que no actúa como empresario; como no sabemos si actúa como tal, solo se exige a las
 * entidades (NIF de persona jurídica) y a los clientes de fuera de España con NIF-IVA.
 */
export function recipientDataProblem(customer: InvoicePartySnapshot, issuerCountry: string | null | undefined): string | null {
  const taxId = customer.taxId?.trim();
  if (!taxId) return null;
  const foreign = Boolean(customer.countryCode) && Boolean(issuerCountry) && customer.countryCode!.toUpperCase() !== issuerCountry!.toUpperCase();
  if (!foreign && !isEntityTaxId(taxId)) return null;
  const missing = [
    !customer.address?.trim() ? "dirección" : null,
    !foreign && !customer.postalCode?.trim() ? "código postal" : null,
    !customer.city?.trim() ? "población" : null,
  ].filter((value): value is string => Boolean(value));
  if (missing.length === 0) return null;
  return `La factura a ${customer.legalName?.trim() || customer.name} debe llevar su domicilio: falta ${missing.join(", ")} en la ficha del cliente.`;
}

/**
 * Arts. 4 y 7: la factura simplificada (con o sin los datos del destinatario) solo cabe hasta 400 €
 * (IVA incluido) o hasta 3.000 € en las actividades del art. 4.2 (venta al por menor, hostelería,
 * transporte de personas…). `limit` es el configurado por la empresa o por la caja.
 * `documentClass` es la clase con la que se emite; sin ella se deduce del NIF (sin NIF, simplificada).
 */
export function simplifiedLimitProblem(input: {
  documentClass?: InvoiceDocumentClass | null;
  customerTaxId?: string | null;
  totalAmount: number;
  limit: number;
}): string | null {
  const documentClass = input.documentClass ?? (input.customerTaxId?.trim() ? "FULL" : "SIMPLIFIED");
  if (!isSimplifiedClass(documentClass)) return null;
  const limit = Math.min(Math.max(input.limit, 0), SIMPLIFIED_INVOICE_EXTENDED_LIMIT);
  if (Math.abs(input.totalAmount) <= limit) return null;
  const formatted = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, useGrouping: "always" }).format(limit);
  if (documentClass === "SIMPLIFIED_QUALIFIED" || input.customerTaxId?.trim()) {
    return `Una factura simplificada no puede superar ${formatted} €. Emítela como factura completa (el cliente ya tiene NIF).`;
  }
  return `Sin el NIF del cliente esto es una factura simplificada y supera su límite de ${formatted} €. Completa el NIF en la ficha del cliente para emitir una factura completa.`;
}

export type SurchargeCheckLine = {
  description: string;
  /** null: línea sin artículo (no se sabe si es un bien: no se comprueba). */
  isService: boolean | null;
  taxes: Array<{ kind?: string | null; operation?: string | null; rate: number }>;
};

/**
 * Arts. 154-163 de la Ley del IVA: en las entregas de bienes a un comerciante minorista en recargo
 * de equivalencia el proveedor debe repercutir el recargo junto al IVA.
 */
export function equivalenceSurchargeProblem(lines: SurchargeCheckLine[]): string | null {
  const missing = lines.filter((line) => {
    if (line.isService !== false) return false;
    const kinds = line.taxes.filter((tax) => (tax.operation ?? "ADD").toUpperCase() === "ADD" && tax.rate > 0).map((tax) => (tax.kind ?? "").toUpperCase());
    return kinds.includes("VAT") && !kinds.includes("SURCHARGE");
  });
  if (missing.length === 0) return null;
  const names = missing.slice(0, 3).map((line) => `«${line.description.slice(0, 40)}»`).join(", ");
  return `El cliente está en recargo de equivalencia y ${missing.length === 1 ? "la línea" : "las líneas"} ${names}${missing.length > 3 ? "…" : ""} no ${missing.length === 1 ? "lo lleva" : "lo llevan"}. Añade el recargo que corresponde a su IVA (5,2 %, 1,4 % o 0,5 %) o quita la marca en la ficha del cliente.`;
}

/** Día civil (AAAA-MM-DD) de un instante en la zona horaria de la empresa. */
export function civilDateKey(date: Date, timeZone = "Europe/Madrid") {
  // Las fechas elegidas en un formulario se guardan a las 00:00 UTC: ese es ya su día civil.
  if (date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0) {
    return date.toISOString().slice(0, 10);
  }
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/**
 * Art. 6.1.a: numeración correlativa. Dentro de una serie la fecha de expedición no puede ser
 * anterior a la de la última factura ya emitida (los números y las fechas avanzan juntos).
 */
export function chronologicalOrderProblem(input: { issueDate: Date; lastIssued: { number: string; issueDate: Date } | null; timeZone?: string }): string | null {
  if (!input.lastIssued) return null;
  const current = civilDateKey(input.issueDate, input.timeZone);
  const last = civilDateKey(input.lastIssued.issueDate, input.timeZone);
  if (current >= last) return null;
  const [year, month, day] = last.split("-");
  return `La última factura de esta serie (${input.lastIssued.number}) es del ${day}/${month}/${year}: no puedes emitir otra con fecha anterior. Usa la fecha de hoy (y, si hace falta, indica la fecha de la operación) o una serie distinta.`;
}

/** Art. 7 de la Ley 7/2012: operaciones de 1.000 € o más (10.000 € si el pagador es un particular no residente). */
export const CASH_PAYMENT_LIMIT = 1000;
export const CASH_PAYMENT_LIMIT_NON_RESIDENT = 10_000;

/**
 * Cobro en efectivo de una operación en la que interviene un empresario: prohibido desde 1.000 €
 * (cuenta el importe de la operación, no el de cada pago). La multa es del 25 % de lo pagado y
 * responden cobrador y pagador.
 */
export function cashPaymentProblem(input: { methodType: string | null | undefined; invoiceTotal: number; customerCountry: string | null | undefined; customerTaxId?: string | null }): string | null {
  if ((input.methodType ?? "").toUpperCase() !== "CASH") return null;
  const country = (input.customerCountry ?? "ES").toUpperCase();
  // Particular con domicilio fiscal fuera de España: límite de 10.000 €.
  const nonResidentIndividual = country !== "ES" && !isEntityTaxId(input.customerTaxId);
  const limit = nonResidentIndividual ? CASH_PAYMENT_LIMIT_NON_RESIDENT : CASH_PAYMENT_LIMIT;
  if (Math.abs(input.invoiceTotal) < limit) return null;
  const formatted = new Intl.NumberFormat("es-ES", { useGrouping: "always" }).format(limit);
  return `Esta factura es de ${formatted} € o más y no se puede cobrar en efectivo, ni siquiera en parte (art. 7 de la Ley 7/2012). Regístralo con transferencia, tarjeta u otro medio bancario.`;
}

/** País sin subdivisión fiscal: «ES-CN» → «ES». */
function baseCountry(code: string | null | undefined) {
  return (code ?? "").trim().toUpperCase().slice(0, 2);
}

/**
 * Art. 25 de la Ley del IVA (art. 138 de la Directiva 2006/112/CE): la entrega intracomunitaria
 * exenta exige un adquirente identificado a efectos del IVA en un Estado miembro DISTINTO del de
 * quien vende. Lo mismo vale para los servicios B2B que se localizan en destino.
 */
export function intraEuCustomerProblem(input: { customerCountry: string | null | undefined; issuerCountry: string | null | undefined }): string | null {
  const customerCountry = baseCountry(input.customerCountry);
  const issuerCountry = baseCountry(input.issuerCountry);
  if (!customerCountry || !isEuCountry(customerCountry)) {
    return "Una operación intracomunitaria necesita un cliente de otro país de la Unión Europea. El país de la ficha del cliente no es de la UE: corrígelo o cambia el tratamiento de IVA (para fuera de la UE, «Exportación»).";
  }
  if (customerCountry === issuerCountry) {
    return "Una operación intracomunitaria necesita un cliente de OTRO país de la Unión Europea. El cliente tiene el mismo país que tu empresa: revisa su ficha o cambia el tratamiento de IVA.";
  }
  return null;
}

/** Días durante los que se da por buena una comprobación del NIF-IVA en VIES (criterio del programa, no de la norma). */
export const VIES_VALIDITY_DAYS = 90;

/**
 * El NIF-IVA del cliente debe estar comprobado en VIES (censo de operadores intracomunitarios) y
 * la comprobación debe ser reciente; si no, quien emite tiene que confirmarlo expresamente.
 * Devuelve el motivo por el que hace falta esa confirmación, o null si la comprobación vale.
 */
export function viesValidationProblem(input: { status: string | null | undefined; checkedAt: Date | null | undefined; at?: Date }): string | null {
  const how = "Compruébalo en la ficha del cliente («Comprobar en VIES») o, si ya lo has verificado por otro medio, emite la factura desde su ficha marcando la confirmación.";
  if (input.status === "INVALID") return `El NIF-IVA del cliente NO consta como válido en VIES: sin un NIF-IVA válido la operación no puede ir sin IVA. ${how}`;
  if (input.status !== "VALID" || !input.checkedAt) return `El NIF-IVA del cliente no está comprobado en VIES, y sin un NIF-IVA válido la operación no puede ir sin IVA. ${how}`;
  const reference = (input.at ?? new Date()).getTime();
  const ageDays = (reference - input.checkedAt.getTime()) / 86_400_000;
  if (ageDays > VIES_VALIDITY_DAYS) {
    return `La comprobación del NIF-IVA del cliente en VIES tiene más de ${VIES_VALIDITY_DAYS} días. ${how}`;
  }
  return null;
}

/** Plazo máximo de pago entre empresas (art. 4.3 de la Ley 3/2004, de lucha contra la morosidad). */
export const MAX_PAYMENT_TERM_DAYS = 60;

/** Aviso (no bloquea): plazo de pago pactado superior a 60 días naturales. */
export function paymentTermWarning(days: number | null | undefined): string | null {
  if (days === null || days === undefined || !Number.isFinite(days) || days <= MAX_PAYMENT_TERM_DAYS) return null;
  return `El plazo de pago es de ${Math.round(days)} días. Entre empresas la ley no permite pactar más de ${MAX_PAYMENT_TERM_DAYS} días naturales (art. 4.3 de la Ley 3/2004): un plazo mayor es nulo.`;
}

/** Días naturales entre la fecha de la factura y su vencimiento (null si falta alguna). */
export function paymentTermDays(issueDate: Date | null | undefined, dueDate: Date | null | undefined) {
  if (!issueDate || !dueDate) return null;
  return Math.round((dueDate.getTime() - issueDate.getTime()) / 86_400_000);
}

/**
 * Aviso (no bloquea, decisión del commit 91a893d): NIF con forma española cuyo dígito o letra de
 * control no cuadra. Casi siempre es una errata, y la AEAT rechazará el registro de la factura.
 */
export function spanishTaxIdCheckDigitWarning(taxId: string | null | undefined, countryCode: string | null | undefined): string | null {
  const country = baseCountry(countryCode) || "ES";
  if (country !== "ES" || !taxId?.trim()) return null;
  if (!hasSpanishTaxIdFormat(taxId) || isValidSpanishTaxId(taxId)) return null;
  return `El NIF ${normalizeSpanishTaxId(taxId)} tiene el formato correcto pero su letra o dígito de control no cuadra: probablemente hay una errata. Revísalo, porque Hacienda no admitirá facturas con un NIF que no existe.`;
}

export type IssueWarningInput = {
  invoiceType: string;
  vatTreatment: string;
  customerTaxId: string | null | undefined;
  customerCountry: string | null | undefined;
  issuerCountry: string | null | undefined;
  issueDate: Date;
  dueDate: Date | null;
  /** Días de pago que se aplicarán si la factura no tiene vencimiento. */
  defaultTermDays?: number | null;
  vies?: { status: string | null; checkedAt: Date | null } | null;
  /** Bases sin IVA en una factura nacional (tipo 0 o líneas sin impuesto). */
  hasUntaxedDomesticBase?: boolean;
  hasExemptionCause?: boolean;
};

export type IssueWarning = { code: "TAX_ID" | "VIES" | "PAYMENT_TERM" | "EXPORT_COUNTRY" | "UNTAXED_BASE"; message: string; requiresConfirmation?: boolean };

/** Avisos que conviene leer antes de emitir un borrador. Ninguno bloquea; el de VIES pide confirmación. */
export function issueWarnings(input: IssueWarningInput): IssueWarning[] {
  const warnings: IssueWarning[] = [];
  const taxIdWarning = spanishTaxIdCheckDigitWarning(input.customerTaxId, input.customerCountry);
  if (taxIdWarning) warnings.push({ code: "TAX_ID", message: taxIdWarning });
  if (input.invoiceType !== "INVOICE") return warnings;

  if ((input.vatTreatment === "INTRA_EU" || input.vatTreatment === "INTRA_EU_SERVICES") && isEuCountry(baseCountry(input.issuerCountry))) {
    const viesProblem = viesValidationProblem({ status: input.vies?.status, checkedAt: input.vies?.checkedAt, at: input.issueDate });
    if (viesProblem) warnings.push({ code: "VIES", message: viesProblem, requiresConfirmation: true });
  }
  if (input.vatTreatment === "EXPORT" && isEuCountry(baseCountry(input.customerCountry))) {
    warnings.push({
      code: "EXPORT_COUNTRY",
      message: "La factura va como exportación pero el país del cliente es de la Unión Europea. La exención de exportación (art. 21 de la Ley del IVA) exige que la mercancía salga de la UE: comprueba que es así y guarda el documento de aduanas (DUA).",
    });
  }
  const termWarning = paymentTermWarning(input.dueDate ? paymentTermDays(input.issueDate, input.dueDate) : input.defaultTermDays);
  if (termWarning && input.customerTaxId?.trim()) warnings.push({ code: "PAYMENT_TERM", message: termWarning });
  if (input.vatTreatment === "DOMESTIC" && input.hasUntaxedDomesticBase && !input.hasExemptionCause) {
    warnings.push({
      code: "UNTAXED_BASE",
      message: "Hay importes sin IVA en una factura nacional. La factura debe decir por qué (art. 6.1.j del Reglamento de facturación): elige la causa de exención o añade la mención legal al editarla. Si no eliges nada se imprimirá «Operación exenta de IVA (art. 20 de la Ley 37/1992)».",
    });
  }
  return warnings;
}
