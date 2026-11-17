"use client";

import { lineTaxSelects, lineTaxSummary, taxIdsFromSelects, type LineTaxSelectOption } from "@/components/invoices/line-tax-select";
import { ChoiceDialogButton } from "@/components/ui/choice-dialog";

/**
 * Impuestos de una línea de factura: un botón con lo elegido («IVA 21 % · IRPF 15 %») que abre un
 * diálogo con dos grupos de opciones, «IVA» y «Retención». Se aplica al pulsar «Aplicar».
 */
export function LineTaxDialog({
  describedBy,
  id,
  invalid,
  lineNumber,
  onChange,
  selectedTaxIds,
  taxes,
}: {
  describedBy?: string;
  id: string;
  invalid?: boolean;
  lineNumber: number;
  onChange?: (taxIds: string[]) => void;
  selectedTaxIds?: readonly string[];
  taxes: readonly LineTaxSelectOption[];
}) {
  const selects = lineTaxSelects(taxes, selectedTaxIds);
  const summary = lineTaxSummary(selects);
  return (
    <ChoiceDialogButton
      ariaLabel={`Impuestos de la línea ${lineNumber}: ${summary}. Cambiar`}
      describedBy={describedBy}
      groups={[
        { key: "added", legend: "IVA", choices: selects.added.choices, value: selects.added.value },
        ...(selects.hasWithholding ? [{ key: "withheld", legend: "Retención (IRPF)", choices: selects.withheld.choices, value: selects.withheld.value }] : []),
      ]}
      id={id}
      invalid={invalid}
      onApply={(values) => onChange?.(taxIdsFromSelects(values.added ?? "", values.withheld ?? ""))}
      summary={summary}
      title={`Impuestos de la línea ${lineNumber}`}
    />
  );
}
