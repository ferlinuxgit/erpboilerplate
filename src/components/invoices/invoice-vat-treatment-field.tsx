"use client";

import type { UseFormRegisterReturn } from "react-hook-form";

import { AccessibleField } from "@/components/ui/form";
import { Select } from "@/components/ui/select";
import { salesVatTreatmentOptions, vatTreatmentLegalNotes, type SalesVatTreatmentCode } from "@/server/invoices/lifecycle";

type InvoiceVatTreatmentFieldProps = {
  binding: UseFormRegisterReturn;
  value: SalesVatTreatmentCode | null | undefined;
  /** Hay IVA o recargo repercutido en alguna línea. */
  hasChargedVat: boolean;
  error?: string;
};

/**
 * "Tratamiento de IVA" de la factura. El valor por defecto se deduce del país del cliente; la ayuda
 * explica qué implica cada opción y avisa si las líneas llevan IVA con un tratamiento sin IVA.
 */
export function InvoiceVatTreatmentField({ binding, error, hasChargedVat, value }: InvoiceVatTreatmentFieldProps) {
  const selected = salesVatTreatmentOptions.find((option) => option.value === value) ?? salesVatTreatmentOptions[0]!;
  const legalNote = vatTreatmentLegalNotes[selected.value];
  const conflict = selected.value !== "DOMESTIC" && hasChargedVat;
  return (
    <AccessibleField
      error={error}
      helperText={`${selected.help}${legalNote ? ` En el PDF se añadirá: «${legalNote}»` : ""}`}
      id="invoice-vat-treatment"
      label="Tratamiento de IVA"
    >
      <Select data-testid="invoice-vat-treatment-select" id="invoice-vat-treatment" {...binding}>
        {salesVatTreatmentOptions.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </Select>
      {conflict ? (
        <p className="mt-1 font-mono text-xs text-destructive" data-testid="invoice-vat-treatment-conflict" role="status">
          Con «{selected.label}» las líneas no deben llevar IVA ni recargo: quítalos antes de emitir.
        </p>
      ) : null}
    </AccessibleField>
  );
}
