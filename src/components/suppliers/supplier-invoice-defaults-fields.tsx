"use client";

import { AccountPicker } from "@/components/ui/account-picker";
import { AccessibleField } from "@/components/ui/form";
import { PercentInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import type { AccountOption } from "@/lib/account-aliases";
import { supplierVatTreatmentLabels, type SupplierVatTreatment } from "@/lib/fiscal-spain";
import { parseDecimalInput } from "@/lib/format";
import { parseSupplierVatTreatment, SUPPLIER_VAT_TREATMENTS } from "@/lib/supplier-defaults";

export type SupplierInvoiceDefaultsDraft = {
  expenseAccountId: string;
  retentionRate: string;
  taxDeductiblePct: string;
  vatTreatment: SupplierVatTreatment | "";
};

export type SupplierInvoiceDefaultsErrors = Partial<Record<"retentionRate" | "taxDeductiblePct", string>>;

const vatOptions = SUPPLIER_VAT_TREATMENTS.map((treatment) => [treatment, supplierVatTreatmentLabels[treatment]] as const);

export function emptySupplierInvoiceDefaults(): SupplierInvoiceDefaultsDraft {
  return { expenseAccountId: "", retentionRate: "", taxDeductiblePct: "", vatTreatment: "" };
}

/** Convierte el borrador del formulario en el payload de la API (vacío = sin valor habitual). */
export function supplierInvoiceDefaultsPayload(draft: SupplierInvoiceDefaultsDraft) {
  const errors: SupplierInvoiceDefaultsErrors = {};
  const parsePct = (raw: string, key: keyof SupplierInvoiceDefaultsErrors) => {
    if (!raw.trim()) return null;
    const value = parseDecimalInput(raw, { maximumFractionDigits: 3 });
    if (value === null || value < 0 || value > 100) {
      errors[key] = "Indica un porcentaje entre 0 y 100.";
      return null;
    }
    return value;
  };
  const payload = {
    defaultExpenseAccountId: draft.expenseAccountId,
    defaultRetentionRate: parsePct(draft.retentionRate, "retentionRate"),
    defaultTaxDeductiblePct: parsePct(draft.taxDeductiblePct, "taxDeductiblePct"),
    defaultVatTreatment: draft.vatTreatment || null,
  };
  return { payload, errors };
}

/**
 * Valores que se proponen al registrar facturas de este proveedor (por OCR o a mano).
 * Todo es opcional y editable en cada factura.
 */
export function SupplierInvoiceDefaultsFields({
  accounts,
  draft,
  errors = {},
  onChange,
}: {
  accounts: readonly AccountOption[];
  draft: SupplierInvoiceDefaultsDraft;
  errors?: SupplierInvoiceDefaultsErrors;
  onChange: (patch: Partial<SupplierInvoiceDefaultsDraft>) => void;
}) {
  return (
    <fieldset className="grid gap-3 border border-window-dark-shadow bg-window-panel p-3 md:col-span-6 md:grid-cols-4">
      <legend className="px-1 font-mono text-xs font-bold">Valores habituales de sus facturas (opcional)</legend>
      <p className="text-xs text-muted-foreground md:col-span-4">
        Se rellenan solos al registrar una factura de este proveedor, con OCR o a mano, y siempre puedes cambiarlos.
      </p>
      <AccessibleField
        className="md:col-span-2"
        helperText="En qué se gasta normalmente (p. ej. 628 Suministros para la luz o el teléfono)."
        id="supplier-default-expense-account"
        label="Cuenta de gasto habitual"
      >
        <AccountPicker
          accounts={accounts}
          groupFilter={["6", "2"]}
          id="supplier-default-expense-account"
          onChange={(accountId) => onChange({ expenseAccountId: accountId })}
          placeholder="Sin cuenta habitual: se elige en cada factura"
          value={draft.expenseAccountId}
        />
      </AccessibleField>
      <AccessibleField
        error={errors.retentionRate}
        helperText="Retención de IRPF que te aplica en sus facturas: 15 % (7 % los primeros años) si es un profesional, 19 % si es un alquiler. Vacío = sin retención."
        id="supplier-default-retention"
        label="Retención IRPF habitual"
      >
        <PercentInput id="supplier-default-retention" onChange={(event) => onChange({ retentionRate: event.target.value })} placeholder="0" value={draft.retentionRate} />
      </AccessibleField>
      <AccessibleField
        error={errors.taxDeductiblePct}
        helperText="Parte del IVA que puedes recuperar. 100 % en gastos del negocio; p. ej. 50 % en un vehículo de uso mixto. Vacío = 100 %."
        id="supplier-default-deductible"
        label="IVA deducible habitual"
      >
        <PercentInput id="supplier-default-deductible" onChange={(event) => onChange({ taxDeductiblePct: event.target.value })} placeholder="100" value={draft.taxDeductiblePct} />
      </AccessibleField>
      <AccessibleField
        className="md:col-span-2"
        helperText="Déjalo en automático salvo que sus facturas tengan un tratamiento especial (p. ej. inversión del sujeto pasivo)."
        id="supplier-default-vat-treatment"
        label="Tratamiento de IVA habitual"
      >
        <Select id="supplier-default-vat-treatment" onChange={(event) => onChange({ vatTreatment: parseSupplierVatTreatment(event.target.value) ?? "" })} value={draft.vatTreatment}>
          <option value="">Automático según el país</option>
          {vatOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
      </AccessibleField>
    </fieldset>
  );
}
