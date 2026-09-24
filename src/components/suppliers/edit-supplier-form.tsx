"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { AccessibleField, FormActions, FormErrorMessage, RequiredFieldsNote, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { updateSupplierSchema } from "@/server/schemas/forms";

type UpdateSupplierPayload = z.input<typeof updateSupplierSchema>;

const paymentTermsRegisterOptions = {
  setValueAs: (value: unknown) => (typeof value === "number" ? value : value === "" || value === null || value === undefined ? Number.NaN : Number(value)),
} as const;

export function EditSupplierForm({
  defaultAddress,
  defaultAddressLine2,
  defaultCity,
  defaultCountryCode,
  defaultCurrencyCode,
  defaultAccountId,
  defaultAccounts = [],
  defaultEmail,
  defaultName,
  defaultPaymentMethodId,
  defaultPaymentTermsDays,
  defaultPhone,
  defaultPostalCode,
  defaultProvince,
  defaultStatus,
  defaultTaxId,
  id,
  paymentMethods = [],
}: {
  id: string;
  defaultName: string;
  defaultTaxId: string;
  defaultAddress: string;
  defaultAddressLine2: string | null;
  defaultPostalCode: string;
  defaultCity: string;
  defaultProvince: string;
  defaultCountryCode: string;
  defaultEmail: string | null;
  defaultPhone: string | null;
  defaultStatus: "ACTIVE" | "INACTIVE";
  defaultPaymentTermsDays: number | null;
  defaultPaymentMethodId: string | null;
  defaultAccountId: string | null;
  defaultCurrencyCode: string;
  paymentMethods?: Array<{ id: string; name: string }>;
  defaultAccounts?: Array<{ id: string; code: string; name: string }>;
}) {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdateSupplierPayload>({
    resolver: zodResolver(updateSupplierSchema),
    defaultValues: {
      name: defaultName,
      taxId: defaultTaxId,
      address: defaultAddress,
      addressLine2: defaultAddressLine2 ?? "",
      postalCode: defaultPostalCode,
      city: defaultCity,
      province: defaultProvince,
      countryCode: defaultCountryCode,
      email: defaultEmail ?? "",
      phone: defaultPhone ?? "",
      status: defaultStatus,
      paymentTermsDays: defaultPaymentTermsDays ?? 30,
      paymentMethodId: defaultPaymentMethodId ?? "",
      defaultAccountId: defaultAccountId ?? "",
      currencyCode: defaultCurrencyCode,
    },
  });

  const paymentTermsError = errors.paymentTermsDays
    ? errors.paymentTermsDays.type === "invalid_type"
      ? "Indica los días de pago (de 0 a 365)."
      : errors.paymentTermsDays.message
    : undefined;

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const response = await fetch(`/api/suppliers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "No se pudo actualizar el proveedor."));
      }

      toast.success("Proveedor actualizado correctamente.");
      router.push("/suppliers");
      router.refresh();
    } catch (error) {
      const message = errorMessage(error, "No se pudo actualizar el proveedor. Inténtalo de nuevo.");
      setSubmitError(message);
      toast.error(message);
    }
  });

  return (
    <form className="grid gap-4 md:grid-cols-6" noValidate onSubmit={onSubmit}>
      <RequiredFieldsNote className="md:col-span-6" />
      <AccessibleField id="supplier-name" label="Nombre" required error={errors.name?.message}>
        <Input id="supplier-name" {...register("name")} />
      </AccessibleField>
      <AccessibleField id="supplier-tax-id" label="CIF/NIF/VAT" required error={errors.taxId?.message} helperText="Se normaliza sin espacios ni guiones.">
        <Input id="supplier-tax-id" {...register("taxId")} />
      </AccessibleField>
      <AccessibleField id="supplier-address" label="Dirección fiscal" required className="md:col-span-2" error={errors.address?.message}>
        <Input autoComplete="street-address" id="supplier-address" {...register("address")} />
      </AccessibleField>
      <AccessibleField id="supplier-address-line-2" label="Dirección 2" className="md:col-span-2" error={errors.addressLine2?.message}>
        <Input id="supplier-address-line-2" {...register("addressLine2")} />
      </AccessibleField>
      <AccessibleField id="supplier-postal-code" label="Código postal" required error={errors.postalCode?.message}>
        <Input autoComplete="postal-code" id="supplier-postal-code" inputMode="numeric" {...register("postalCode")} />
      </AccessibleField>
      <AccessibleField id="supplier-city" label="Ciudad" required error={errors.city?.message}>
        <Input id="supplier-city" {...register("city")} />
      </AccessibleField>
      <AccessibleField id="supplier-province" label="Provincia" required error={errors.province?.message}>
        <Input id="supplier-province" {...register("province")} />
      </AccessibleField>
      <AccessibleField id="supplier-country-code" label="País" required error={errors.countryCode?.message} helperText="Código ISO de 2 letras (ES, FR…).">
        <Input id="supplier-country-code" maxLength={2} {...register("countryCode")} />
      </AccessibleField>
      <AccessibleField id="supplier-email" label="Email" error={errors.email?.message}>
        <Input autoComplete="email" id="supplier-email" type="email" {...register("email")} />
      </AccessibleField>
      <AccessibleField id="supplier-phone" label="Teléfono" error={errors.phone?.message}>
        <Input autoComplete="tel" id="supplier-phone" type="tel" {...register("phone")} />
      </AccessibleField>
      <AccessibleField id="supplier-payment-terms" label="Días pago" required error={paymentTermsError} helperText="Plazo de pago en días (0 = al contado).">
        <Input className="text-right tabular-nums" id="supplier-payment-terms" inputMode="numeric" max="365" min="0" type="number" {...register("paymentTermsDays", paymentTermsRegisterOptions)} />
      </AccessibleField>
      <AccessibleField id="supplier-payment-method" label="Método pago" error={errors.paymentMethodId?.message}>
        <Select id="supplier-payment-method" {...register("paymentMethodId")}>
          <option value="">Sin método por defecto</option>
          {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
        </Select>
      </AccessibleField>
      <AccessibleField id="supplier-default-account" label="Cuenta proveedor" error={errors.defaultAccountId?.message} helperText="Cuenta contable para sus facturas.">
        <Select id="supplier-default-account" {...register("defaultAccountId")}>
          <option value="">Cuenta por defecto de empresa</option>
          {defaultAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} - {account.name}</option>)}
        </Select>
      </AccessibleField>
      <AccessibleField id="supplier-currency" label="Moneda" required error={errors.currencyCode?.message} helperText="Código ISO de 3 letras (EUR, USD…).">
        <Input id="supplier-currency" maxLength={3} {...register("currencyCode")} />
      </AccessibleField>
      <AccessibleField id="supplier-status" label="Estado" error={errors.status?.message}>
        <Select id="supplier-status" {...register("status")}>
          <option value="ACTIVE">Activo</option>
          <option value="INACTIVE">Inactivo</option>
        </Select>
      </AccessibleField>
      <FormErrorMessage className="md:col-span-6">{submitError}</FormErrorMessage>
      <FormActions className="md:col-span-6">
        <SubmitButton pending={isSubmitting}>Guardar cambios</SubmitButton>
      </FormActions>
    </form>
  );
}
