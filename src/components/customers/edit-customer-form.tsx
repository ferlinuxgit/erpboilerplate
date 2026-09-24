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
import { updateCustomerSchema } from "@/server/schemas/forms";

type UpdateCustomerPayload = z.infer<typeof updateCustomerSchema>;

export function EditCustomerForm({
  defaultAddress,
  defaultAddressLine2,
  defaultCity,
  defaultCountryCode,
  defaultEmail,
  defaultName,
  defaultPhone,
  defaultPostalCode,
  defaultProvince,
  defaultStatus,
  defaultTaxId,
  id,
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
}) {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdateCustomerPayload>({
    resolver: zodResolver(updateCustomerSchema),
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
    },
  });

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
      router.push("/customers");
      router.refresh();
    } catch (error) {
      const message = errorMessage(error, "No se pudo actualizar el cliente. Inténtalo de nuevo.");
      setSubmitError(message);
      toast.error(message);
    }
  });

  return (
    <form className="grid gap-4 md:grid-cols-6" noValidate onSubmit={onSubmit}>
      <RequiredFieldsNote className="md:col-span-6" />
      <AccessibleField id="customer-name" label="Nombre" required error={errors.name?.message}>
        <Input id="customer-name" {...register("name")} />
      </AccessibleField>
      <AccessibleField id="customer-tax-id" label="CIF/NIF/VAT" required error={errors.taxId?.message} helperText="Se normaliza sin espacios ni guiones.">
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
      <AccessibleField id="customer-country-code" label="País" required error={errors.countryCode?.message} helperText="Código ISO de 2 letras (ES, FR…).">
        <Input id="customer-country-code" maxLength={2} {...register("countryCode")} />
      </AccessibleField>
      <AccessibleField id="customer-email" label="Email" error={errors.email?.message}>
        <Input autoComplete="email" id="customer-email" type="email" {...register("email")} />
      </AccessibleField>
      <AccessibleField id="customer-phone" label="Teléfono" error={errors.phone?.message}>
        <Input autoComplete="tel" id="customer-phone" type="tel" {...register("phone")} />
      </AccessibleField>
      <AccessibleField id="customer-status" label="Estado" error={errors.status?.message}>
        <Select id="customer-status" {...register("status")}>
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
