"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { CountrySelectField, CustomerBillingFields } from "@/components/customers/customer-billing-fields";
import { AccessibleField, FormActions, FormErrorMessage, RequiredFieldsNote, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { getCsrfHeader } from "@/lib/csrf-client";
import { customerUpdateFormSchema, type CustomerUpdateFormInput } from "@/server/customers/schemas";

type CreateCustomerFormProps = {
  redirectHref?: string;
};

export function CreateCustomerForm({ redirectHref }: CreateCustomerFormProps = {}) {
  type CreateCustomerPayload = CustomerUpdateFormInput;
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    reset,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateCustomerPayload>({
    resolver: zodResolver(customerUpdateFormSchema),
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
      paymentTermsDays: null,
      defaultRetentionRate: null,
      defaultVatTreatment: null,
      invoiceEmail: "",
      iban: "",
      equivalenceSurcharge: false,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const response = await fetch("/api/customers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getCsrfHeader(),
        },
        body: JSON.stringify({ ...values, status: undefined }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "No se pudo crear el cliente."));
      }

      reset();
      toast.success("Cliente creado correctamente.");
      if (redirectHref) {
        router.push(redirectHref);
      } else {
        router.refresh();
      }
    } catch (submissionError) {
      const message = errorMessage(submissionError, "No se pudo crear el cliente. Inténtalo de nuevo.");
      setSubmitError(message);
      toast.error(message);
    }
  });

  return (
    <form className="grid gap-4 md:grid-cols-6" data-testid="customer-create-form" noValidate onSubmit={onSubmit}>
      <RequiredFieldsNote className="md:col-span-6" />
      <AccessibleField id="customer-name" label="Nombre" required error={errors.name?.message} helperText="Nombre fiscal o comercial del cliente.">
        <Input autoFocus data-testid="customer-name-input" id="customer-name" placeholder="Ej: Acme S.L." {...register("name")} />
      </AccessibleField>
      <AccessibleField id="customer-tax-id" label="CIF/NIF/VAT" required error={errors.taxId?.message} helperText="Para clientes de otros países de la UE, su NIF-IVA con prefijo (FR…, DE…).">
        <Input data-testid="customer-tax-id-input" id="customer-tax-id" placeholder="B12345674" {...register("taxId")} />
      </AccessibleField>
      <AccessibleField id="customer-address" label="Dirección fiscal" required className="md:col-span-2" error={errors.address?.message}>
        <Input autoComplete="street-address" data-testid="customer-address-input" id="customer-address" placeholder="Calle Mayor 1, 2A" {...register("address")} />
      </AccessibleField>
      <AccessibleField id="customer-address-line-2" label="Dirección 2" className="md:col-span-2" error={errors.addressLine2?.message}>
        <Input data-testid="customer-address-line-2-input" id="customer-address-line-2" placeholder="Polígono, edificio o referencia" {...register("addressLine2")} />
      </AccessibleField>
      <AccessibleField id="customer-postal-code" label="Código postal" required error={errors.postalCode?.message}>
        <Input autoComplete="postal-code" data-testid="customer-postal-code-input" id="customer-postal-code" inputMode="numeric" placeholder="28013" {...register("postalCode")} />
      </AccessibleField>
      <AccessibleField id="customer-city" label="Ciudad" required error={errors.city?.message}>
        <Input data-testid="customer-city-input" id="customer-city" placeholder="Madrid" {...register("city")} />
      </AccessibleField>
      <AccessibleField id="customer-province" label="Provincia" required error={errors.province?.message}>
        <Input data-testid="customer-province-input" id="customer-province" placeholder="Madrid" {...register("province")} />
      </AccessibleField>
      <CountrySelectField error={errors.countryCode?.message} id="customer-country-code" register={register} testId="customer-country-code-input" />
      <AccessibleField id="customer-email" label="Email" error={errors.email?.message} helperText="Opcional; se usará para comunicaciones comerciales.">
        <Input autoComplete="email" data-testid="customer-email-input" id="customer-email" placeholder="contacto@acme.com" type="email" {...register("email")} />
      </AccessibleField>
      <AccessibleField id="customer-phone" label="Teléfono" error={errors.phone?.message} helperText="Opcional; incluye prefijo si aplica.">
        <Input autoComplete="tel" data-testid="customer-phone-input" id="customer-phone" placeholder="+34 600 000 000" type="tel" {...register("phone")} />
      </AccessibleField>
      <CustomerBillingFields errors={errors} register={register} />
      <FormErrorMessage className="md:col-span-6">{submitError}</FormErrorMessage>
      <FormActions className="md:col-span-6">
        <SubmitButton data-testid="customer-create-submit" pending={isSubmitting} pendingLabel="Creando…">
          Crear cliente
        </SubmitButton>
      </FormActions>
    </form>
  );
}
