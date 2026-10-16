"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { getCsrfHeader } from "@/lib/csrf-client";

/** Días de pago que se proponen en facturas a clientes sin plazo propio. */
export function PaymentTermsForm({ initialValue }: { initialValue: number }) {
  const router = useRouter();
  const [value, setValue] = useState(String(initialValue));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(days) && days >= 0 && days <= 365;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid) {
      setError("Indica un número de días entre 0 y 365.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/company/payment-terms", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ paymentTermsDays: days }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar el plazo de pago."));
      toast.success(days === 0 ? "Las facturas vencerán el mismo día de emisión." : `Plazo de pago: ${days} días.`);
      router.refresh();
    } catch (submitError) {
      const message = errorMessage(submitError, "No se pudo guardar el plazo de pago.");
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-2" noValidate onSubmit={submit}>
      <div className="flex flex-wrap items-end gap-2">
        <AccessibleField
          className="w-48"
          helperText="0 = vence el mismo día de emisión."
          id="company-payment-terms"
          label="Días hasta el vencimiento"
        >
          <Input inputMode="numeric" max={365} min={0} onChange={(event) => setValue(event.target.value)} type="number" value={value} />
        </AccessibleField>
        <SubmitButton className="mb-5" disabled={String(initialValue) === value.trim()} pending={pending} variant="outline">Guardar</SubmitButton>
      </div>
      <p className="text-xs text-muted-foreground">
        Se aplica a los clientes que no tienen un plazo propio en su ficha. Puedes cambiar el vencimiento en cada factura.
      </p>
      <FormErrorMessage>{error}</FormErrorMessage>
    </form>
  );
}
