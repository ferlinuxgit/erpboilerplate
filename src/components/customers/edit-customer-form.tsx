"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { CountrySelectField, CustomerBillingFields } from "@/components/customers/customer-billing-fields";
import { ViesCheck, type ViesSnapshot } from "@/components/customers/vies-check";
import { AccessibleField, FormActions, FormErrorMessage, RequiredFieldsNote, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { isEuCountry } from "@/lib/countries";
import { customerUpdateFormSchema, type CustomerUpdateFormInput } from "@/server/customers/schemas";

export type EditCustomerDefaults = {
  name: string;
  taxId: string;
  address: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  province: string;
  countryCode: string;
  email: string | null;
  phone: string | null;
  status: "ACTIVE" | "INACTIVE";
  paymentTermsDays: number | null;
  defaultRetentionRate: number | null;
  defaultVatTreatment: string | null;
  invoiceEmail: string | null;
  iban: string | null;
  equivalenceSurcharge: boolean;
};

export function EditCustomerForm({ defaults, id, vies }: { id: string; defaults: EditCustomerDefaults; vies?: ViesSnapshot | null }) {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CustomerUpdateFormInput>({
    resolver: zodResolver(customerUpdateFormSchema),
    defaultValues: {
      name: defaults.name,
      taxId: defaults.taxId,
      address: defaults.address,
      addressLine2: defaults.addressLine2 ?? "",
      postalCode: defaults.postalCode,
      city: defaults.city,
      province: defaults.province,
      countryCode: defaults.countryCode,
      email: defaults.email ?? "",
      phone: defaults.phone ?? "",
      status: defaults.status,
      paymentTermsDays: defaults.paymentTermsDays,
      defaultRetentionRate: defaults.defaultRetentionRate,
      defaultVatTreatment: (defaults.defaultVatTreatment as CustomerUpdateFormInput["defaultVatTreatment"]) ?? null,
      invoiceEmail: defaults.invoiceEmail ?? "",
      iban: defaults.iban ?? "",
      equivalenceSurcharge: defaults.equivalenceSurcharge,
    },
  });
  const countryCode = useWatch({ control, name: "countryCode" });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const response = await fetch(`/api/customers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "No se pudo actualizar el cliente."));
      }

      toast.success("Cliente actualizado correctamente.");
      router.push(`/customers/${id}`);
      router.refresh();
    } catch (error) {
      const message = errorMessage(error, "No se pudo actualizar el cliente. Inténtalo de nuevo.");
      setSubmitError(message);
      toast.error(message);
    }
  });

  return (
    <form className="grid gap-4 md:grid-cols-6" data-testid="customer-edit-form" noValidate onSubmit={onSubmit}>
      <RequiredFieldsNote className="md:col-span-6" />
      <AccessibleField id="customer-name" label="Nombre" required error={errors.name?.message}>
        <Input id="customer-name" {...register("name")} />
      </AccessibleField>
      <AccessibleField id="customer-tax-id" label="CIF/NIF/VAT" required error={errors.taxId?.message} helperText="Para clientes de otros países de la UE, su NIF-IVA con prefijo (FR…, DE…).">
        <Input id="customer-tax-id" {...register("taxId")} />
      </AccessibleField>
      <AccessibleField id="customer-address" label="Dirección fiscal" required className="md:col-span-2" error={errors.address?.message}>
        <Input autoComplete="street-address" id="customer-address" {...register("address")} />
      </AccessibleField>
      <AccessibleField id="customer-address-line-2" label="Dirección 2" className="md:col-span-2" error={errors.addressLine2?.message}>
        <Input id="customer-address-line-2" {...register("addressLine2")} />
      </AccessibleField>
      <AccessibleField id="customer-postal-code" label="Código postal" required error={errors.postalCode?.message}>
        <Input autoComplete="postal-code" id="customer-postal-code" inputMode="numeric" {...register("postalCode")} />
      </AccessibleField>
      <AccessibleField id="customer-city" label="Ciudad" required error={errors.city?.message}>
        <Input id="customer-city" {...register("city")} />
      </AccessibleField>
      <AccessibleField id="customer-province" label="Provincia" required error={errors.province?.message}>
        <Input id="customer-province" {...register("province")} />
      </AccessibleField>
      <CountrySelectField error={errors.countryCode?.message} id="customer-country-code" register={register} />
      <AccessibleField id="customer-email" label="Email" error={errors.email?.message}>
        <Input autoComplete="email" id="customer-email" type="email" {...register("email")} />
      </AccessibleField>
      <AccessibleField id="customer-phone" label="Teléfono" error={errors.phone?.message}>
        <Input autoComplete="tel" id="customer-phone" type="tel" {...register("phone")} />
      </AccessibleField>
      <AccessibleField id="customer-status" label="Estado" error={errors.status?.message} helperText="Un cliente inactivo no aparece al crear facturas, pero conserva su historial.">
        <Select id="customer-status" {...register("status")}>
          <option value="ACTIVE">Activo</option>
          <option value="INACTIVE">Inactivo</option>
        </Select>
      </AccessibleField>
      {isEuCountry(countryCode) && countryCode !== "ES" ? (
        <div className="md:col-span-6">
          <ViesCheck customerId={id} initial={vies ?? null} />
        </div>
      ) : null}
      <CustomerBillingFields errors={errors} register={register} />
      <FormErrorMessage className="md:col-span-6">{submitError}</FormErrorMessage>
      <FormActions className="md:col-span-6">
        <SubmitButton pending={isSubmitting}>Guardar cambios</SubmitButton>
      </FormActions>
    </form>
  );
}
