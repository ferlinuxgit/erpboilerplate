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
import { createSupplierSchema } from "@/server/schemas/forms";

type CreateSupplierFormProps = {
  redirectHref?: string;
  paymentMethods?: Array<{ id: string; name: string }>;
  defaultAccounts?: Array<{ id: string; code: string; name: string }>;
};

export function CreateSupplierForm({ defaultAccounts = [], paymentMethods = [], redirectHref }: CreateSupplierFormProps = {}) {
  type CreateSupplierPayload = z.input<typeof createSupplierSchema>;
  const router = useRouter();
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

  const onSubmit = handleSubmit(async (values) => {
    try {
      const response = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? "No se pudo crear el proveedor.");
      }

      reset();
      toast.success("Proveedor creado correctamente.");
      if (redirectHref) {
        router.push(redirectHref);
      } else {
        router.refresh();
      }
    } catch (submissionError) {
      const message = submissionError instanceof Error ? submissionError.message : "Ha ocurrido un error inesperado.";
      toast.error(message);
    }
  });

  return (
    <form className="grid gap-4 md:grid-cols-6" data-testid="supplier-create-form" onSubmit={onSubmit}>
      <AccessibleField id="supplier-name" label="Nombre" required error={errors.name?.message} helperText="Nombre fiscal o comercial del proveedor.">
        <Input id="supplier-name" minLength={2} placeholder="Ej: Suministros Norte S.L." required aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "supplier-name-error" : "supplier-name-helper"} {...register("name")} />
      </AccessibleField>
      <AccessibleField id="supplier-tax-id" label="CIF/NIF/VAT" required error={errors.taxId?.message} helperText="Se normaliza sin espacios ni guiones.">
        <Input id="supplier-tax-id" placeholder="B12345674" required aria-invalid={Boolean(errors.taxId)} aria-describedby={errors.taxId ? "supplier-tax-id-error" : "supplier-tax-id-helper"} {...register("taxId")} />
      </AccessibleField>
      <AccessibleField id="supplier-address" label="Dirección fiscal" required className="md:col-span-2" error={errors.address?.message}>
        <Input id="supplier-address" placeholder="Calle Mayor 1, 2A" required aria-invalid={Boolean(errors.address)} aria-describedby={errors.address ? "supplier-address-error" : undefined} {...register("address")} />
      </AccessibleField>
      <AccessibleField id="supplier-address-line-2" label="Dirección 2" className="md:col-span-2" error={errors.addressLine2?.message}>
        <Input id="supplier-address-line-2" placeholder="Polígono, edificio o referencia" aria-invalid={Boolean(errors.addressLine2)} aria-describedby={errors.addressLine2 ? "supplier-address-line-2-error" : undefined} {...register("addressLine2")} />
      </AccessibleField>
      <AccessibleField id="supplier-postal-code" label="Código postal" required error={errors.postalCode?.message}>
        <Input id="supplier-postal-code" placeholder="28013" required aria-invalid={Boolean(errors.postalCode)} aria-describedby={errors.postalCode ? "supplier-postal-code-error" : undefined} {...register("postalCode")} />
      </AccessibleField>
      <AccessibleField id="supplier-city" label="Ciudad" required error={errors.city?.message}>
        <Input id="supplier-city" placeholder="Madrid" required aria-invalid={Boolean(errors.city)} aria-describedby={errors.city ? "supplier-city-error" : undefined} {...register("city")} />
      </AccessibleField>
      <AccessibleField id="supplier-province" label="Provincia" required error={errors.province?.message}>
        <Input id="supplier-province" placeholder="Madrid" required aria-invalid={Boolean(errors.province)} aria-describedby={errors.province ? "supplier-province-error" : undefined} {...register("province")} />
      </AccessibleField>
      <AccessibleField id="supplier-country-code" label="País" required error={errors.countryCode?.message}>
        <Input id="supplier-country-code" maxLength={2} placeholder="ES" required aria-invalid={Boolean(errors.countryCode)} aria-describedby={errors.countryCode ? "supplier-country-code-error" : undefined} {...register("countryCode")} />
      </AccessibleField>
      <AccessibleField id="supplier-email" label="Email" error={errors.email?.message} helperText="Opcional; se usará para comunicaciones y facturas recibidas.">
        <Input id="supplier-email" placeholder="facturacion@proveedor.com" type="email" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "supplier-email-error" : "supplier-email-helper"} {...register("email")} />
      </AccessibleField>
      <AccessibleField id="supplier-phone" label="Teléfono" error={errors.phone?.message} helperText="Opcional; incluye prefijo si aplica.">
        <Input id="supplier-phone" placeholder="+34 600 000 000" aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? "supplier-phone-error" : "supplier-phone-helper"} {...register("phone")} />
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
      <div className="space-y-2 self-end">
        <Button className="w-full" data-testid="supplier-create-submit" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Guardando..." : "Crear proveedor"}
        </Button>
      </div>
    </form>
  );
}
