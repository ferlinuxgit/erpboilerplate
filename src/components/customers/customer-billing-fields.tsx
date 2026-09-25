"use client";

import type { FieldErrors, UseFormRegister } from "react-hook-form";

import { AccessibleField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { countriesForSelect, isEuCountry } from "@/lib/countries";
import type { CustomerUpdateFormInput } from "@/server/customers/schemas";
import { salesVatTreatmentOptions } from "@/server/invoices/lifecycle";

type Values = CustomerUpdateFormInput;

const COUNTRY_OPTIONS = countriesForSelect();
export const RETENTION_OPTIONS = [0, 1, 2, 7, 15, 19];

/** "" → null; "30" → 30 (el esquema rechaza lo que no sea entero). */
export const integerOrNull = {
  setValueAs: (value: unknown) => {
    if (typeof value === "number") return value;
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return null;
    const parsed = Number(text.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  },
} as const;

export const numberOrNull = {
  setValueAs: (value: unknown) => {
    if (typeof value === "number") return value;
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  },
} as const;

/** Selector de país ISO con nombres en español (España y la UE primero). */
export function CountrySelectField({
  error,
  id,
  register,
  testId,
}: {
  error?: string;
  id: string;
  register: UseFormRegister<Values>;
  testId?: string;
}) {
  return (
    <AccessibleField error={error} helperText="Define si la factura lleva IVA español o es intracomunitaria/exportación." id={id} label="País" required>
      <Select data-testid={testId} id={id} {...register("countryCode", { setValueAs: (value: unknown) => (typeof value === "string" ? value.toUpperCase() : value) })}>
        {COUNTRY_OPTIONS.map((country, index) => (
          <option key={country.code} value={country.code}>
            {country.name}{index > 0 && isEuCountry(country.code) ? " (UE)" : ""}
          </option>
        ))}
      </Select>
    </AccessibleField>
  );
}

/**
 * Condiciones de facturación del cliente: se aplican solas en cada factura nueva
 * (vencimiento, retención, tratamiento de IVA, recargo de equivalencia).
 */
export function CustomerBillingFields({
  errors,
  idPrefix = "customer",
  register,
}: {
  errors: FieldErrors<Values>;
  idPrefix?: string;
  register: UseFormRegister<Values>;
}) {
  return (
    <fieldset className="grid gap-4 rounded-[2px] border border-window-dark-shadow bg-window-panel p-3 md:col-span-6 md:grid-cols-6" data-testid="customer-billing-fields">
      <legend className="px-1 font-mono text-xs font-bold uppercase tracking-wide">Condiciones de facturación</legend>
      <p className="text-xs text-muted-foreground md:col-span-6">
        Se aplican automáticamente en cada factura nueva de este cliente. Puedes cambiarlas en cada factura.
      </p>
      <AccessibleField
        error={errors.paymentTermsDays?.message}
        helperText="Vencimiento = fecha de la factura + estos días. 0 = al contado. Vacío = el plazo de tu empresa."
        id={`${idPrefix}-payment-terms`}
        label="Días de pago"
      >
        <Input data-testid={`${idPrefix}-payment-terms-input`} id={`${idPrefix}-payment-terms`} inputMode="numeric" placeholder="30" {...register("paymentTermsDays", integerOrNull)} />
      </AccessibleField>
      <AccessibleField
        error={errors.defaultRetentionRate?.message}
        helperText="Para clientes empresa que te retienen IRPF (profesionales: 15 %, o 7 % los tres primeros años)."
        id={`${idPrefix}-retention`}
        label="Retención IRPF habitual"
      >
        <Select data-testid={`${idPrefix}-retention-select`} id={`${idPrefix}-retention`} {...register("defaultRetentionRate", numberOrNull)}>
          {RETENTION_OPTIONS.map((rate) => (
            <option key={rate} value={rate === 0 ? "" : String(rate)}>{rate === 0 ? "Sin retención" : `${rate} %`}</option>
          ))}
        </Select>
      </AccessibleField>
      <AccessibleField
        className="md:col-span-2"
        error={errors.defaultVatTreatment?.message}
        helperText="Déjalo en automático salvo que siempre factures igual a este cliente (p. ej. servicios a una empresa de la UE)."
        id={`${idPrefix}-vat-treatment`}
        label="Tipo de operación (IVA)"
      >
        <Select data-testid={`${idPrefix}-vat-treatment-select`} id={`${idPrefix}-vat-treatment`} {...register("defaultVatTreatment", { setValueAs: (value: unknown) => (value === "" ? null : value) })}>
          <option value="">Automático según el país</option>
          {salesVatTreatmentOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
      </AccessibleField>
      <AccessibleField error={errors.invoiceEmail?.message} helperText="Opcional; si el cliente recibe las facturas en otro buzón (p. ej. administración)." id={`${idPrefix}-invoice-email`} label="Correo para facturas">
        <Input autoComplete="off" data-testid={`${idPrefix}-invoice-email-input`} id={`${idPrefix}-invoice-email`} placeholder="facturas@cliente.com" type="email" {...register("invoiceEmail")} />
      </AccessibleField>
      <AccessibleField error={errors.iban?.message} helperText="Opcional; solo si le cobras por domiciliación." id={`${idPrefix}-iban`} label="IBAN del cliente">
        <Input autoComplete="off" data-testid={`${idPrefix}-iban-input`} id={`${idPrefix}-iban`} placeholder="ES91 2100 0418 4502 0005 1332" {...register("iban")} />
      </AccessibleField>
      <label className="flex items-start gap-2 text-sm md:col-span-6" htmlFor={`${idPrefix}-equivalence-surcharge`}>
        <input className="mt-1 size-4 accent-primary" data-testid={`${idPrefix}-equivalence-surcharge`} id={`${idPrefix}-equivalence-surcharge`} type="checkbox" {...register("equivalenceSurcharge")} />
        <span>
          <span className="block font-medium">Está en recargo de equivalencia</span>
          <span className="text-xs text-muted-foreground">Comercios minoristas (autónomos) a los que debes cobrar el recargo además del IVA. Se añadirá solo en sus facturas.</span>
        </span>
      </label>
    </fieldset>
  );
}
