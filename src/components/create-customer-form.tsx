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

export function CreateCustomerForm() {
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
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message ?? "No se pudo crear el cliente.");
      }

      reset();
      toast.success("Cliente creado correctamente.");
      router.refresh();
    } catch (submissionError) {
      const message = submissionError instanceof Error ? submissionError.message : "Ha ocurrido un error inesperado.";
      toast.error(message);
    }
  });

  return (
    <form className="grid gap-4 md:grid-cols-4" data-testid="customer-create-form" onSubmit={onSubmit}>
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
