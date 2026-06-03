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
import { createCustomerSchema } from "@/server/schemas/forms";

type CreateCustomerFormProps = {
  redirectHref?: string;
};

export function CreateCustomerForm({ redirectHref }: CreateCustomerFormProps = {}) {
  type CreateCustomerPayload = z.infer<typeof createCustomerSchema>;
  const router = useRouter();
  const {
    register,
    reset,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateCustomerPayload>({
    resolver: zodResolver(createCustomerSchema),
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
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const response = await fetch("/api/customers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getCsrfHeader(),
        },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? "No se pudo crear el cliente.");
      }

      reset();
      toast.success("Cliente creado correctamente.");
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
    <form className="grid gap-4 md:grid-cols-6" data-testid="customer-create-form" onSubmit={onSubmit}>
      <AccessibleField id="customer-name" label="Nombre" required error={errors.name?.message} helperText="Nombre fiscal o comercial del cliente.">
        <Input
          data-testid="customer-name-input"
          id="customer-name"
          minLength={2}
          placeholder="Ej: Acme S.L."
          required
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? "customer-name-error" : "customer-name-helper"}
          {...register("name")}
        />
      </AccessibleField>
      <AccessibleField id="customer-tax-id" label="CIF/NIF/VAT" required error={errors.taxId?.message} helperText="Se normaliza sin espacios ni guiones.">
        <Input
          data-testid="customer-tax-id-input"
          id="customer-tax-id"
          placeholder="B12345674"
          required
          aria-invalid={Boolean(errors.taxId)}
          aria-describedby={errors.taxId ? "customer-tax-id-error" : "customer-tax-id-helper"}
          {...register("taxId")}
        />
      </AccessibleField>
      <AccessibleField id="customer-address" label="Dirección fiscal" required className="md:col-span-2" error={errors.address?.message}>
        <Input
          data-testid="customer-address-input"
          id="customer-address"
          placeholder="Calle Mayor 1, 2A"
          required
          aria-invalid={Boolean(errors.address)}
          aria-describedby={errors.address ? "customer-address-error" : undefined}
          {...register("address")}
        />
      </AccessibleField>
      <AccessibleField id="customer-address-line-2" label="Dirección 2" className="md:col-span-2" error={errors.addressLine2?.message}>
        <Input
          data-testid="customer-address-line-2-input"
          id="customer-address-line-2"
          placeholder="Polígono, edificio o referencia"
          aria-invalid={Boolean(errors.addressLine2)}
          aria-describedby={errors.addressLine2 ? "customer-address-line-2-error" : undefined}
          {...register("addressLine2")}
        />
      </AccessibleField>
      <AccessibleField id="customer-postal-code" label="Código postal" required error={errors.postalCode?.message}>
        <Input
          data-testid="customer-postal-code-input"
          id="customer-postal-code"
          placeholder="28013"
          required
          aria-invalid={Boolean(errors.postalCode)}
          aria-describedby={errors.postalCode ? "customer-postal-code-error" : undefined}
          {...register("postalCode")}
        />
      </AccessibleField>
      <AccessibleField id="customer-city" label="Ciudad" required error={errors.city?.message}>
        <Input
          data-testid="customer-city-input"
          id="customer-city"
          placeholder="Madrid"
          required
          aria-invalid={Boolean(errors.city)}
          aria-describedby={errors.city ? "customer-city-error" : undefined}
          {...register("city")}
        />
      </AccessibleField>
      <AccessibleField id="customer-province" label="Provincia" required error={errors.province?.message}>
        <Input
          data-testid="customer-province-input"
          id="customer-province"
          placeholder="Madrid"
          required
          aria-invalid={Boolean(errors.province)}
          aria-describedby={errors.province ? "customer-province-error" : undefined}
          {...register("province")}
        />
      </AccessibleField>
      <AccessibleField id="customer-country-code" label="País" required error={errors.countryCode?.message}>
        <Input
          data-testid="customer-country-code-input"
          id="customer-country-code"
          maxLength={2}
          placeholder="ES"
          required
          aria-invalid={Boolean(errors.countryCode)}
          aria-describedby={errors.countryCode ? "customer-country-code-error" : undefined}
          {...register("countryCode")}
        />
      </AccessibleField>
      <AccessibleField id="customer-email" label="Email" error={errors.email?.message} helperText="Opcional; se usará para comunicaciones comerciales.">
        <Input
          data-testid="customer-email-input"
          id="customer-email"
          placeholder="contacto@acme.com"
          type="email"
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? "customer-email-error" : "customer-email-helper"}
          {...register("email")}
        />
      </AccessibleField>
      <AccessibleField id="customer-phone" label="Teléfono" error={errors.phone?.message} helperText="Opcional; incluye prefijo si aplica.">
        <Input
          data-testid="customer-phone-input"
          id="customer-phone"
          placeholder="+34 600 000 000"
          aria-invalid={Boolean(errors.phone)}
          aria-describedby={errors.phone ? "customer-phone-error" : "customer-phone-helper"}
          {...register("phone")}
        />
      </AccessibleField>
      <div className="space-y-2 self-end">
        <Button className="w-full" data-testid="customer-create-submit" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Guardando..." : "Crear cliente"}
        </Button>
      </div>
    </form>
  );
}
