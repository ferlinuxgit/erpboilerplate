"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { InvoicePaymentMethodsField, type InvoicePaymentMethodOption } from "@/components/invoices/invoice-form-controls";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { getCsrfHeader } from "@/lib/csrf-client";
import { issuedInvoiceEditSchema } from "@/server/invoices/schemas";

type IssuedInvoiceEditPayload = z.infer<typeof issuedInvoiceEditSchema>;

/**
 * Edición permitida en una factura emitida: notas y formas de pago (información de cobro).
 * El resto de datos es inmutable y se corrige con una factura rectificativa.
 */
export function IssuedInvoiceEditForm({
  defaultNotes,
  defaultPaymentMethodIds,
  id,
  paymentMethods,
}: {
  id: string;
  defaultNotes: string | null;
  defaultPaymentMethodIds: string[];
  paymentMethods: InvoicePaymentMethodOption[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
  } = useForm<IssuedInvoiceEditPayload>({
    resolver: zodResolver(issuedInvoiceEditSchema),
    defaultValues: { notes: defaultNotes ?? "", paymentMethodIds: defaultPaymentMethodIds },
  });
  const selectedIds = useWatch({ control, name: "paymentMethodIds" }) ?? [];

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const response = await fetch(`/api/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ notes: values.notes ?? "", paymentMethodIds: values.paymentMethodIds ?? [] }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudieron guardar los cambios."));
      toast.success("Notas y formas de pago actualizadas.");
      router.push(`/invoices/${id}`);
      router.refresh();
    } catch (submitError) {
      const message = errorMessage(submitError, "No se pudieron guardar los cambios.");
      setError(message);
      toast.error(message);
    }
  });

  return (
    <form className="grid gap-3 sm:grid-cols-2" data-testid="invoice-issued-edit-form" noValidate onSubmit={onSubmit}>
      <InvoicePaymentMethodsField
        error={errors.paymentMethodIds?.message}
        getBinding={() => register("paymentMethodIds")}
        methods={paymentMethods}
        selectedIds={selectedIds}
      />
      <AccessibleField error={errors.notes?.message} helperText="Observaciones visibles en la ficha de la factura." id="invoice-issued-notes" label="Notas">
        <Input id="invoice-issued-notes" {...register("notes")} />
      </AccessibleField>
      <FormErrorMessage className="sm:col-span-2">{error}</FormErrorMessage>
      <div className="flex justify-end sm:col-span-2">
        <SubmitButton data-testid="invoice-issued-edit-submit" pending={isSubmitting}>Guardar notas y formas de pago</SubmitButton>
      </div>
    </form>
  );
}
