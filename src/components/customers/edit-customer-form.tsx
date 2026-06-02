"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { AccessibleField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
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

  return (
    <form
      className="grid gap-4 md:grid-cols-6"
      onSubmit={handleSubmit(async (values) => {
        try {
          const response = await fetch(`/api/customers/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...getCsrfHeader() },
            body: JSON.stringify(values),
          });

          if (!response.ok) {
            const payload = (await response.json()) as { message?: string };
            throw new Error(payload.message ?? "No se pudo actualizar el cliente.");
          }

          toast.success("Cliente actualizado correctamente.");
          router.push("/customers");
          router.refresh();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Error inesperado.");
        }
      })}
    >
      <AccessibleField id="customer-name" label="Nombre" required error={errors.name?.message}>
        <Input id="customer-name" required aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "customer-name-error" : undefined} {...register("name")} />
      </AccessibleField>
      <AccessibleField id="customer-tax-id" label="CIF/NIF/VAT" required error={errors.taxId?.message}>
        <Input id="customer-tax-id" required aria-invalid={Boolean(errors.taxId)} aria-describedby={errors.taxId ? "customer-tax-id-error" : undefined} {...register("taxId")} />
      </AccessibleField>
      <AccessibleField id="customer-address" label="Dirección fiscal" required className="md:col-span-2" error={errors.address?.message}>
        <Input id="customer-address" required aria-invalid={Boolean(errors.address)} aria-describedby={errors.address ? "customer-address-error" : undefined} {...register("address")} />
      </AccessibleField>
      <AccessibleField id="customer-address-line-2" label="Dirección 2" className="md:col-span-2" error={errors.addressLine2?.message}>
        <Input id="customer-address-line-2" aria-invalid={Boolean(errors.addressLine2)} aria-describedby={errors.addressLine2 ? "customer-address-line-2-error" : undefined} {...register("addressLine2")} />
      </AccessibleField>
      <AccessibleField id="customer-postal-code" label="Código postal" required error={errors.postalCode?.message}>
        <Input id="customer-postal-code" required aria-invalid={Boolean(errors.postalCode)} aria-describedby={errors.postalCode ? "customer-postal-code-error" : undefined} {...register("postalCode")} />
      </AccessibleField>
      <AccessibleField id="customer-city" label="Ciudad" required error={errors.city?.message}>
        <Input id="customer-city" required aria-invalid={Boolean(errors.city)} aria-describedby={errors.city ? "customer-city-error" : undefined} {...register("city")} />
      </AccessibleField>
      <AccessibleField id="customer-province" label="Provincia" required error={errors.province?.message}>
        <Input id="customer-province" required aria-invalid={Boolean(errors.province)} aria-describedby={errors.province ? "customer-province-error" : undefined} {...register("province")} />
      </AccessibleField>
      <AccessibleField id="customer-country-code" label="País" required error={errors.countryCode?.message}>
        <Input id="customer-country-code" maxLength={2} required aria-invalid={Boolean(errors.countryCode)} aria-describedby={errors.countryCode ? "customer-country-code-error" : undefined} {...register("countryCode")} />
      </AccessibleField>
      <AccessibleField id="customer-email" label="Email" error={errors.email?.message}>
        <Input id="customer-email" type="email" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "customer-email-error" : undefined} {...register("email")} />
      </AccessibleField>
      <AccessibleField id="customer-phone" label="Teléfono" error={errors.phone?.message}>
        <Input id="customer-phone" aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? "customer-phone-error" : undefined} {...register("phone")} />
      </AccessibleField>
      <AccessibleField id="customer-status" label="Estado" error={errors.status?.message}>
        <select
          className="h-8 rounded-md border px-2 text-sm"
          id="customer-status"
          aria-invalid={Boolean(errors.status)}
          aria-describedby={errors.status ? "customer-status-error" : undefined}
          {...register("status")}
        >
          <option value="ACTIVE">Activo</option>
          <option value="INACTIVE">Inactivo</option>
        </select>
      </AccessibleField>
      <div className="self-end md:col-span-6">
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? "Guardando..." : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}
