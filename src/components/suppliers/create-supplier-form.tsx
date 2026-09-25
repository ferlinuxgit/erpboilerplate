"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  SupplierInvoiceDefaultsFields,
  emptySupplierInvoiceDefaults,
  supplierInvoiceDefaultsPayload,
  type SupplierInvoiceDefaultsDraft,
  type SupplierInvoiceDefaultsErrors,
} from "@/components/suppliers/supplier-invoice-defaults-fields";
import { AccessibleField, FormActions, FormErrorMessage, RequiredFieldsNote, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { createSupplierSchema } from "@/server/schemas/forms";

type CreatedSupplier = { id: string; number: string; name: string; taxId: string | null };

type CreateSupplierFormProps = {
  redirectHref?: string;
  /** Alta rápida desde otro formulario: recibe el proveedor creado en lugar de navegar. */
  onCreated?: (supplier: CreatedSupplier) => void;
  /** Cuentas imputables para elegir la cuenta de gasto habitual. */
  expenseAccounts?: Array<{ id: string; code: string; name: string }>;
  paymentMethods?: Array<{ id: string; name: string }>;
  defaultAccounts?: Array<{ id: string; code: string; name: string }>;
};

const paymentTermsRegisterOptions = {
  setValueAs: (value: unknown) => (typeof value === "number" ? value : value === "" || value === null || value === undefined ? Number.NaN : Number(value)),
} as const;

export function CreateSupplierForm({ defaultAccounts = [], expenseAccounts = [], onCreated, paymentMethods = [], redirectHref }: CreateSupplierFormProps = {}) {
  type CreateSupplierPayload = z.input<typeof createSupplierSchema>;
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [invoiceDefaults, setInvoiceDefaults] = useState<SupplierInvoiceDefaultsDraft>(emptySupplierInvoiceDefaults);
  const [invoiceDefaultsErrors, setInvoiceDefaultsErrors] = useState<SupplierInvoiceDefaultsErrors>({});
  const {
    register,
    reset,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateSupplierPayload>({
    resolver: zodResolver(createSupplierSchema),
    defaultValues: {
      name: "",
      taxId: "",
      address: "",
      addressLine2: "",
      postalCode: "",
      city: "",
      province: "",
      countryCode: "ES",
      email: "",
      phone: "",
      paymentTermsDays: 30,
      paymentMethodId: "",
      defaultAccountId: "",
      currencyCode: "EUR",
    },
  });
  const paymentTermsError = errors.paymentTermsDays
    ? errors.paymentTermsDays.type === "invalid_type"
      ? "Indica los días de pago (de 0 a 365)."
      : errors.paymentTermsDays.message
    : undefined;

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    const defaults = supplierInvoiceDefaultsPayload(invoiceDefaults);
    setInvoiceDefaultsErrors(defaults.errors);
    if (Object.keys(defaults.errors).length > 0) {
      setSubmitError("Revisa los valores habituales de sus facturas.");
      return;
    }
    try {
      const response = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ ...values, ...defaults.payload }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "No se pudo crear el proveedor."));
      }

      const created = (await response.json().catch(() => null)) as CreatedSupplier | null;
      reset();
      setInvoiceDefaults(emptySupplierInvoiceDefaults());
      toast.success("Proveedor creado correctamente.");
      if (onCreated && created?.id) {
        onCreated(created);
      } else if (redirectHref) {
        router.push(redirectHref);
      } else {
        router.refresh();
      }
    } catch (submissionError) {
      const message = errorMessage(submissionError, "No se pudo crear el proveedor. Inténtalo de nuevo.");
      setSubmitError(message);
      toast.error(message);
    }
  });

  return (
    <form className="grid gap-4 md:grid-cols-6" data-testid="supplier-create-form" noValidate onSubmit={onSubmit}>
      <RequiredFieldsNote className="md:col-span-6" />
      <AccessibleField id="supplier-name" label="Nombre" required error={errors.name?.message} helperText="Nombre fiscal o comercial del proveedor.">
        <Input autoFocus id="supplier-name" placeholder="Ej: Suministros Norte S.L." {...register("name")} />
      </AccessibleField>
      <AccessibleField id="supplier-tax-id" label="CIF/NIF/VAT" required error={errors.taxId?.message} helperText="Se normaliza sin espacios ni guiones.">
        <Input id="supplier-tax-id" placeholder="B12345674" {...register("taxId")} />
      </AccessibleField>
      <AccessibleField id="supplier-address" label="Dirección fiscal" required className="md:col-span-2" error={errors.address?.message}>
        <Input autoComplete="street-address" id="supplier-address" placeholder="Calle Mayor 1, 2A" {...register("address")} />
      </AccessibleField>
      <AccessibleField id="supplier-address-line-2" label="Dirección 2" className="md:col-span-2" error={errors.addressLine2?.message}>
        <Input id="supplier-address-line-2" placeholder="Polígono, edificio o referencia" {...register("addressLine2")} />
      </AccessibleField>
      <AccessibleField id="supplier-postal-code" label="Código postal" required error={errors.postalCode?.message}>
        <Input autoComplete="postal-code" id="supplier-postal-code" inputMode="numeric" placeholder="28013" {...register("postalCode")} />
      </AccessibleField>
      <AccessibleField id="supplier-city" label="Ciudad" required error={errors.city?.message}>
        <Input id="supplier-city" placeholder="Madrid" {...register("city")} />
      </AccessibleField>
      <AccessibleField id="supplier-province" label="Provincia" required error={errors.province?.message}>
        <Input id="supplier-province" placeholder="Madrid" {...register("province")} />
      </AccessibleField>
      <AccessibleField id="supplier-country-code" label="País" required error={errors.countryCode?.message} helperText="Código ISO de 2 letras (ES, FR…).">
        <Input id="supplier-country-code" maxLength={2} placeholder="ES" {...register("countryCode")} />
      </AccessibleField>
      <AccessibleField id="supplier-email" label="Email" error={errors.email?.message} helperText="Opcional; se usará para comunicaciones y facturas recibidas.">
        <Input autoComplete="email" id="supplier-email" placeholder="facturacion@proveedor.com" type="email" {...register("email")} />
      </AccessibleField>
      <AccessibleField id="supplier-phone" label="Teléfono" error={errors.phone?.message} helperText="Opcional; incluye prefijo si aplica.">
        <Input autoComplete="tel" id="supplier-phone" placeholder="+34 600 000 000" type="tel" {...register("phone")} />
      </AccessibleField>
      <AccessibleField id="supplier-payment-terms" label="Días pago" required error={paymentTermsError} helperText="Días que tienes para pagarle. El vencimiento de sus facturas se calcula solo (0 = al contado).">
        <Input className="text-right tabular-nums" id="supplier-payment-terms" inputMode="numeric" max="365" min="0" type="number" {...register("paymentTermsDays", paymentTermsRegisterOptions)} />
      </AccessibleField>
      <AccessibleField id="supplier-payment-method" label="Método pago" error={errors.paymentMethodId?.message}>
        <Select id="supplier-payment-method" {...register("paymentMethodId")}>
          <option value="">Sin método por defecto</option>
          {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
        </Select>
      </AccessibleField>
      <AccessibleField id="supplier-default-account" label="Cuenta del proveedor" error={errors.defaultAccountId?.message} helperText="Dónde se anota lo que le debes (grupo 410). Déjalo en la general salvo que tu gestor use subcuentas.">
        <Select id="supplier-default-account" {...register("defaultAccountId")}>
          <option value="">General de la empresa (410)</option>
          {defaultAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} - {account.name}</option>)}
        </Select>
      </AccessibleField>
      <AccessibleField id="supplier-currency" label="Moneda" required error={errors.currencyCode?.message} helperText="Código ISO de 3 letras (EUR, USD…).">
        <Input id="supplier-currency" maxLength={3} {...register("currencyCode")} />
      </AccessibleField>
      <SupplierInvoiceDefaultsFields accounts={expenseAccounts} draft={invoiceDefaults} errors={invoiceDefaultsErrors} onChange={(patch) => setInvoiceDefaults((current) => ({ ...current, ...patch }))} />
      <FormErrorMessage className="md:col-span-6">{submitError}</FormErrorMessage>
      <FormActions className="md:col-span-6">
        <SubmitButton data-testid="supplier-create-submit" pending={isSubmitting} pendingLabel="Creando…">
          Crear proveedor
        </SubmitButton>
      </FormActions>
    </form>
  );
}
