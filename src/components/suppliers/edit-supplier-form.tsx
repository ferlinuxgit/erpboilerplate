"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { AccessibleField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { updateSupplierSchema } from "@/server/schemas/forms";

type UpdateSupplierPayload = z.input<typeof updateSupplierSchema>;

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

  return (
    <form
      className="grid gap-4 md:grid-cols-6"
      onSubmit={handleSubmit(async (values) => {
        try {
          const response = await fetch(`/api/suppliers/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...getCsrfHeader() },
            body: JSON.stringify(values),
          });

          if (!response.ok) {
            const payload = (await response.json()) as { message?: string };
            throw new Error(payload.message ?? "No se pudo actualizar el proveedor.");
          }

          toast.success("Proveedor actualizado correctamente.");
          router.push("/suppliers");
          router.refresh();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Error inesperado.");
        }
      })}
    >
      <AccessibleField id="supplier-name" label="Nombre" required error={errors.name?.message}>
        <Input id="supplier-name" required aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "supplier-name-error" : undefined} {...register("name")} />
      </AccessibleField>
      <AccessibleField id="supplier-tax-id" label="CIF/NIF/VAT" required error={errors.taxId?.message}>
        <Input id="supplier-tax-id" required aria-invalid={Boolean(errors.taxId)} aria-describedby={errors.taxId ? "supplier-tax-id-error" : undefined} {...register("taxId")} />
      </AccessibleField>
      <AccessibleField id="supplier-address" label="Dirección fiscal" required className="md:col-span-2" error={errors.address?.message}>
        <Input id="supplier-address" required aria-invalid={Boolean(errors.address)} aria-describedby={errors.address ? "supplier-address-error" : undefined} {...register("address")} />
      </AccessibleField>
      <AccessibleField id="supplier-address-line-2" label="Dirección 2" className="md:col-span-2" error={errors.addressLine2?.message}>
        <Input id="supplier-address-line-2" aria-invalid={Boolean(errors.addressLine2)} aria-describedby={errors.addressLine2 ? "supplier-address-line-2-error" : undefined} {...register("addressLine2")} />
      </AccessibleField>
      <AccessibleField id="supplier-postal-code" label="Código postal" required error={errors.postalCode?.message}>
        <Input id="supplier-postal-code" required aria-invalid={Boolean(errors.postalCode)} aria-describedby={errors.postalCode ? "supplier-postal-code-error" : undefined} {...register("postalCode")} />
      </AccessibleField>
      <AccessibleField id="supplier-city" label="Ciudad" required error={errors.city?.message}>
        <Input id="supplier-city" required aria-invalid={Boolean(errors.city)} aria-describedby={errors.city ? "supplier-city-error" : undefined} {...register("city")} />
      </AccessibleField>
      <AccessibleField id="supplier-province" label="Provincia" required error={errors.province?.message}>
        <Input id="supplier-province" required aria-invalid={Boolean(errors.province)} aria-describedby={errors.province ? "supplier-province-error" : undefined} {...register("province")} />
      </AccessibleField>
      <AccessibleField id="supplier-country-code" label="País" required error={errors.countryCode?.message}>
        <Input id="supplier-country-code" maxLength={2} required aria-invalid={Boolean(errors.countryCode)} aria-describedby={errors.countryCode ? "supplier-country-code-error" : undefined} {...register("countryCode")} />
      </AccessibleField>
      <AccessibleField id="supplier-email" label="Email" error={errors.email?.message}>
        <Input id="supplier-email" type="email" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "supplier-email-error" : undefined} {...register("email")} />
      </AccessibleField>
      <AccessibleField id="supplier-phone" label="Teléfono" error={errors.phone?.message}>
        <Input id="supplier-phone" aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? "supplier-phone-error" : undefined} {...register("phone")} />
      </AccessibleField>
      <AccessibleField id="supplier-payment-terms" label="Días pago" required error={errors.paymentTermsDays?.message}>
        <Input id="supplier-payment-terms" min="0" max="365" required type="number" aria-invalid={Boolean(errors.paymentTermsDays)} aria-describedby={errors.paymentTermsDays ? "supplier-payment-terms-error" : undefined} {...register("paymentTermsDays", { valueAsNumber: true })} />
      </AccessibleField>
      <AccessibleField id="supplier-payment-method" label="Método pago" error={errors.paymentMethodId?.message}>
        <Select id="supplier-payment-method" aria-invalid={Boolean(errors.paymentMethodId)} aria-describedby={errors.paymentMethodId ? "supplier-payment-method-error" : undefined} {...register("paymentMethodId")}>
          <option value="">Sin método por defecto</option>
          {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
        </Select>
      </AccessibleField>
      <AccessibleField id="supplier-default-account" label="Cuenta proveedor" error={errors.defaultAccountId?.message}>
        <Select id="supplier-default-account" aria-invalid={Boolean(errors.defaultAccountId)} aria-describedby={errors.defaultAccountId ? "supplier-default-account-error" : undefined} {...register("defaultAccountId")}>
          <option value="">Cuenta por defecto de empresa</option>
          {defaultAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} - {account.name}</option>)}
        </Select>
      </AccessibleField>
      <AccessibleField id="supplier-currency" label="Moneda" required error={errors.currencyCode?.message}>
        <Input id="supplier-currency" maxLength={3} required aria-invalid={Boolean(errors.currencyCode)} aria-describedby={errors.currencyCode ? "supplier-currency-error" : undefined} {...register("currencyCode")} />
      </AccessibleField>
      <AccessibleField id="supplier-status" label="Estado" error={errors.status?.message}>
        <select className="h-8 rounded-md border px-2 text-sm" id="supplier-status" aria-invalid={Boolean(errors.status)} aria-describedby={errors.status ? "supplier-status-error" : undefined} {...register("status")}>
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
