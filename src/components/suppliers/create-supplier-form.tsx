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
import { createSupplierSchema } from "@/server/schemas/forms";

type CreateSupplierFormProps = {
  redirectHref?: string;
  paymentMethods?: Array<{ id: string; name: string }>;
  defaultAccounts?: Array<{ id: string; code: string; name: string }>;
};

const paymentTermsRegisterOptions = {
  setValueAs: (value: unknown) => (typeof value === "number" ? value : value === "" || value === null || value === undefined ? Number.NaN : Number(value)),
} as const;

export function CreateSupplierForm({ defaultAccounts = [], paymentMethods = [], redirectHref }: CreateSupplierFormProps = {}) {
  type CreateSupplierPayload = z.input<typeof createSupplierSchema>;
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
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
      defaultAccountId: defaultAccounts[0]?.id ?? "",
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
    try {
      const response = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "No se pudo crear el proveedor."));
      }

      reset();
      toast.success("Proveedor creado correctamente.");
      if (redirectHref) {
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
      <FormErrorMessage className="md:col-span-6">{submitError}</FormErrorMessage>
      <FormActions className="md:col-span-6">
        <SubmitButton data-testid="supplier-create-submit" pending={isSubmitting} pendingLabel="Creando…">
          Crear proveedor
        </SubmitButton>
      </FormActions>
    </form>
  );
}
