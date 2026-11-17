"use client";

import { useController, type Control, type FieldValues, type Path } from "react-hook-form";

import { ChoiceDialogButton } from "@/components/ui/choice-dialog";
import { salesVatTreatmentOptions, vatTreatmentLegalNotes } from "@/server/invoices/lifecycle";

type InvoiceVatTreatmentFieldProps<T extends FieldValues> = {
  control: Control<T>;
  name: Path<T>;
  /** El usuario lo ha cambiado a mano (deja de seguir al cliente). */
  onUserChange?: () => void;
  /** Hay IVA o recargo repercutido en alguna línea. */
  hasChargedVat: boolean;
  error?: string;
};

/**
 * "Tratamiento de IVA" de la factura: un botón con el elegido que abre un diálogo con cada opción
 * y su explicación. El valor por defecto se deduce del país del cliente; la ayuda explica qué
 * implica la opción elegida y avisa si las líneas llevan IVA con un tratamiento sin IVA.
 */
export function InvoiceVatTreatmentField<T extends FieldValues>({ control, error, hasChargedVat, name, onUserChange }: InvoiceVatTreatmentFieldProps<T>) {
  const { field } = useController({ control, name });
  const selected = salesVatTreatmentOptions.find((option) => option.value === field.value) ?? salesVatTreatmentOptions[0]!;
  const legalNote = vatTreatmentLegalNotes[selected.value];
  const conflict = selected.value !== "DOMESTIC" && hasChargedVat;
  const helpId = "invoice-vat-treatment-help";
  const errorId = error ? "invoice-vat-treatment-error" : undefined;
  return (
    <div className="space-y-1.5">
      <p className="font-mono text-xs font-bold">Tratamiento de IVA</p>
      <ChoiceDialogButton
        ariaLabel={`Tratamiento de IVA: ${selected.label}. Cambiar`}
        describedBy={[helpId, errorId].filter(Boolean).join(" ")}
        description="Según dónde está el cliente y qué vendes. Normalmente se propone solo."
        groups={[{
          key: "treatment",
          legend: "Tratamiento de IVA",
          choices: salesVatTreatmentOptions.map((option) => ({ value: option.value, label: option.label, description: option.help })),
          value: selected.value,
        }]}
        id="invoice-vat-treatment"
        invalid={Boolean(error)}
        onApply={(values) => {
          if (!values.treatment || values.treatment === field.value) return;
          field.onChange(values.treatment);
          field.onBlur();
          onUserChange?.();
        }}
        summary={selected.label}
        testId="invoice-vat-treatment-picker"
        title="Tratamiento de IVA"
      />
      <p className="text-xs text-muted-foreground" id={helpId}>
        {selected.help}{legalNote ? ` En el PDF se añadirá: «${legalNote}»` : ""}
      </p>
      {error ? <p className="font-mono text-xs text-danger-text" id={errorId} role="alert">{error}</p> : null}
      {conflict ? (
        <p className="mt-1 font-mono text-xs text-danger-text" data-testid="invoice-vat-treatment-conflict" role="status">
          Con «{selected.label}» las líneas no deben llevar IVA ni recargo: quítalos antes de emitir.
        </p>
      ) : null}
    </div>
  );
}
