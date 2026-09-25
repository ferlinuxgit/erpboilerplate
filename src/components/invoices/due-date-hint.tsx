"use client";

import { describeDueDate, paymentTermsLabel } from "@/server/invoices/due-dates";

/** Ayuda bajo la fecha de vencimiento: "Vence en 30 días (plazo del cliente: 30 días)". */
export function DueDateHint({ dueDate, termsDays, termsSource }: { dueDate: string | null | undefined; termsDays: number; termsSource: "customer" | "company" }) {
  const status = dueDate ? describeDueDate(dueDate) : null;
  const source = termsSource === "customer" ? "plazo del cliente" : "plazo general de tu empresa";
  return (
    <span data-testid="invoice-due-date-hint">
      {status ? `${status.label}. ` : "Sin vencimiento. "}
      Se propone la fecha de emisión + {paymentTermsLabel(termsDays)} ({source}); puedes cambiarla.
    </span>
  );
}
