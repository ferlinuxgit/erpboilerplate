"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import type { CustomerOption } from "@/components/create-invoice-form";
import { CustomerSearchDialog } from "@/components/invoices/customer-search-dialog";
import { InvoiceCustomerPicker } from "@/components/invoices/invoice-customer-picker";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/page";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";

/**
 * Corrección de una factura de canje (F3) errónea: se elige el cliente correcto, la fecha y el
 * motivo. Se emiten dos facturas: una F3 de signo contrario que anula la errónea y una F3 nueva.
 */
export function CorrectSubstitutiveForm({
  customers,
  defaultCustomerId,
  defaultIssueDate,
  invoice,
}: {
  /** Clientes activos con NIF. */
  customers: CustomerOption[];
  defaultCustomerId: string;
  defaultIssueDate: string;
  invoice: { id: string; number: string; simplifiedNumbers: string[] };
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(defaultCustomerId);
  const [issueDate, setIssueDate] = useState(defaultIssueDate);
  const [description, setDescription] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customer = customers.find((entry) => entry.id === customerId) ?? null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!customerId) {
      setError("Elige el cliente al que se expide la factura corregida.");
      return;
    }
    if (description.trim().length < 3) {
      setError("Explica brevemente qué estaba mal en la factura.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch(`/api/invoices/${invoice.id}/substitute/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ customerId, issueDate, description }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo corregir la factura de canje."));
      const result = (await response.json()) as { cancellation: { number: string }; corrected: { id: string; number: string } };
      toast.success(`Emitidas ${result.cancellation.number} (anula ${invoice.number}) y ${result.corrected.number} (la correcta).`);
      router.push(`/invoices/${result.corrected.id}`);
      router.refresh();
    } catch (submitError) {
      const message = errorMessage(submitError, "No se pudo corregir la factura de canje.");
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-4" data-testid="correct-substitutive-form" noValidate onSubmit={submit}>
      <InvoiceCustomerPicker
        canCreateCustomer={false}
        customer={customer}
        description="Cliente correcto. Solo aparecen los clientes activos que tienen NIF."
        hasCustomers={customers.length > 0}
        onCreate={() => undefined}
        onSearch={() => setSearchOpen(true)}
      />
      <p className="text-xs text-muted-foreground">
        ¿El cliente no está en la lista? <Link className="text-primary underline" href="/customers">Dalo de alta en Clientes</Link> con su NIF y su domicilio, y vuelve aquí.
      </p>
      <AccessibleField helperText="No puede ser anterior a la de la factura que corriges." id="correct-substitutive-date" label="Fecha de las dos facturas" required>
        <Input id="correct-substitutive-date" onChange={(event) => setIssueDate(event.target.value)} type="date" value={issueDate} />
      </AccessibleField>
      <AccessibleField helperText="Queda escrito en la factura que anula la errónea." id="correct-substitutive-description" label="Qué estaba mal" required>
        <Textarea id="correct-substitutive-description" maxLength={500} onChange={(event) => setDescription(event.target.value)} placeholder="El NIF del cliente era el de otra empresa." value={description} />
      </AccessibleField>
      <InlineAlert title="Qué va a pasar" tone="info">
        Se emiten dos facturas, como pide la AEAT: una que anula {invoice.number} (mismos importes en negativo) y otra nueva que sustituye a {invoice.simplifiedNumbers.join(", ")} con los datos correctos.
        Ninguna es una venta nueva: no se tocan la contabilidad, el IVA ni los cobros. Si el error está en la simplificada, rectifica la simplificada en su lugar. No se puede deshacer.
      </InlineAlert>
      <FormErrorMessage>{error}</FormErrorMessage>
      <div className="flex justify-end">
        <SubmitButton data-testid="correct-substitutive-submit" pending={pending} pendingLabel="Emitiendo…">Corregir canje</SubmitButton>
      </div>
      <CustomerSearchDialog
        canCreateCustomer={false}
        customers={customers}
        onClose={() => setSearchOpen(false)}
        onCreateCustomer={() => undefined}
        onSelect={(selected) => { setCustomerId(selected.id); setSearchOpen(false); }}
        open={searchOpen}
      />
    </form>
  );
}
