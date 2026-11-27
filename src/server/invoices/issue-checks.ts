/**
 * Comprobaciones legales antes de emitir una factura (funciones puras, Reglamento de facturación,
 * Real Decreto 1619/2012). Devuelven el mensaje para el usuario o null si todo está bien; quien
 * emite decide cómo fallar.
 */

import type { InvoicePartySnapshot } from "@/db/schema";
import { companyInvoiceReadiness } from "@/lib/company-readiness";
import { normalizeSpanishTaxId } from "@/lib/spanish-tax-id";

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
 * Arts. 4 y 7: sin NIF del destinatario el documento es una factura simplificada, que solo cabe
 * hasta 400 € (IVA incluido) o hasta 3.000 € en las actividades del art. 4.2 (venta al por menor,
 * hostelería, transporte de personas…). `limit` es el configurado por la empresa o por la caja.
 */
export function simplifiedLimitProblem(input: { customerTaxId: string | null | undefined; totalAmount: number; limit: number }): string | null {
  if (input.customerTaxId?.trim()) return null;
  const limit = Math.min(Math.max(input.limit, 0), SIMPLIFIED_INVOICE_EXTENDED_LIMIT);
  if (Math.abs(input.totalAmount) <= limit) return null;
  const formatted = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, useGrouping: "always" }).format(limit);
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
