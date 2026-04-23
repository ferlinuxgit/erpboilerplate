"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <form className="grid gap-4 md:grid-cols-4" onSubmit={onSubmit}>
      <div className="space-y-2">
        <Label htmlFor="customer-name">Nombre</Label>
        <Input
          id="customer-name"
          minLength={2}
          placeholder="Ej: Acme S.L."
          required
          {...register("name")}
        />
        {errors.name ? <p className="text-sm text-red-600">{errors.name.message}</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="customer-email">Email</Label>
        <Input
          id="customer-email"
          placeholder="contacto@acme.com"
          type="email"
          {...register("email")}
        />
        {errors.email ? <p className="text-sm text-red-600">{errors.email.message}</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="customer-phone">Teléfono</Label>
        <Input
          id="customer-phone"
          placeholder="+34 600 000 000"
          {...register("phone")}
        />
        {errors.phone ? <p className="text-sm text-red-600">{errors.phone.message}</p> : null}
      </div>
      <div className="space-y-2 self-end">
        <Button className="w-full" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Guardando..." : "Crear cliente"}
        </Button>
      </div>
    </form>
  );
}
