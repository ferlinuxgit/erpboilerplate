import type Stripe from "stripe";

import { isEuCountry } from "@/lib/countries";

/**
 * Traducción de una factura pagada de Stripe a la factura legal del ERP (código puro y probado):
 * IVA según lo que calculó Stripe Tax, cliente con su NIF y dirección, y líneas con su importe.
 */

export type PlatformInvoiceDraft = {
  stripeInvoiceId: string;
  issueDate: string;
  customer: { name: string; taxId: string; address: string; addressLine2: string; postalCode: string; city: string; province: string; countryCode: string; email: string };
  vatTreatment: "DOMESTIC" | "INTRA_EU_SERVICES" | "NOT_SUBJECT";
  taxRate: number;
  lines: Array<{ description: string; quantity: number; unitPrice: number; taxRate: number }>;
  notes: string;
};

export type DraftProblem = { problem: string };

const SPANISH_SPECIAL_POSTAL = /^(35|38|51|52)/;

function amount(cents: number | null | undefined) {
  return Math.round(cents ?? 0) / 100;
}

/** Traduce una factura pagada de Stripe a una factura del ERP (o explica por qué no se puede). */
export function stripeInvoiceToDraft(stripeInvoice: Stripe.Invoice): PlatformInvoiceDraft | DraftProblem {
  const address = stripeInvoice.customer_address;
  const countryCode = address?.country?.toUpperCase() ?? "";
  const taxId = stripeInvoice.customer_tax_ids?.[0]?.value?.replace(/\s+/g, "").toUpperCase() ?? "";
  if (!taxId) return { problem: "el cliente no tiene NIF/VAT en Stripe" };
  if (!countryCode || !address?.line1 || !address.postal_code || !address.city) return { problem: "el cliente no tiene la dirección completa en Stripe" };
  const subtotal = stripeInvoice.subtotal_excluding_tax ?? stripeInvoice.subtotal;
  const tax = stripeInvoice.total - (stripeInvoice.total_excluding_tax ?? subtotal);
  const rate = subtotal > 0 ? Math.round((tax / subtotal) * 1000) / 10 : 0;

  let vatTreatment: PlatformInvoiceDraft["vatTreatment"];
  if (rate === 21) vatTreatment = "DOMESTIC";
  else if (rate !== 0) return { problem: `IVA del ${rate} % (de otro país): emítela a mano` };
  else if (countryCode === "ES" && !SPANISH_SPECIAL_POSTAL.test(address.postal_code)) return { problem: "cliente español sin IVA: revisa Stripe Tax" };
  else if (countryCode !== "ES" && isEuCountry(countryCode)) vatTreatment = "INTRA_EU_SERVICES";
  else vatTreatment = "NOT_SUBJECT";

  const lines = (stripeInvoice.lines?.data ?? [])
    .filter((line) => line.amount !== 0)
    .map((line) => {
      const quantity = line.quantity && line.quantity > 0 ? line.quantity : 1;
      return { description: (line.description ?? "Suscripción").slice(0, 500), quantity, unitPrice: Math.round((line.amount / quantity)) / 100, taxRate: rate };
    });
  if (lines.length === 0) return { problem: "la factura no tiene líneas con importe" };
  return {
    stripeInvoiceId: stripeInvoice.id!,
    issueDate: new Date((stripeInvoice.status_transitions?.paid_at ?? stripeInvoice.created) * 1000).toISOString().slice(0, 10),
    customer: {
      name: (stripeInvoice.customer_name ?? stripeInvoice.customer_email ?? "Cliente").slice(0, 200),
      taxId,
      address: address.line1,
      addressLine2: address.line2 ?? "",
      postalCode: address.postal_code,
      city: address.city,
      province: address.state || address.city,
      countryCode,
      email: stripeInvoice.customer_email ?? "",
    },
    vatTreatment,
    taxRate: rate,
    lines,
    notes: `Cobrada con Stripe (${stripeInvoice.id}). Importe total ${amount(stripeInvoice.total).toFixed(2)} €.`,
  };
}
