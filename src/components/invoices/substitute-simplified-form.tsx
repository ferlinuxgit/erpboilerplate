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
import { getCsrfHeader } from "@/lib/csrf-client";

export type SubstitutableInvoice = { id: string; number: string; issueDateLabel: string; totalLabel: string };

/**
 * Canje de una factura simplificada por una factura completa: se elige el cliente (con NIF), la
 * fecha y, si las hay, otras simplificadas del mismo cliente de origen que deban ir en la misma
 * factura. La factura nueva cita las simplificadas y no genera ni una venta ni un cobro nuevos.
 */
export function SubstituteSimplifiedForm({
  customers,
  defaultIssueDate,
  invoice,
  others,
}: {
  /** Clientes activos con NIF. */
  customers: CustomerOption[];
  defaultIssueDate: string;
  invoice: SubstitutableInvoice;
  /** Otras simplificadas del mismo cliente de origen que aún no se han sustituido. */
  others: SubstitutableInvoice[];
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState("");
  const [issueDate, setIssueDate] = useState(defaultIssueDate);
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customer = customers.find((entry) => entry.id === customerId) ?? null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!customerId) {
      setError("Elige el cliente al que se expide la factura completa.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch(`/api/invoices/${invoice.id}/substitute`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ customerId, issueDate, invoiceIds: extraIds }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo convertir en factura completa."));
      const created = (await response.json()) as { id: string; number: string };
      toast.success(`Factura ${created.number} emitida en sustitución de ${invoice.number}.`);
      router.push(`/invoices/${created.id}`);
      router.refresh();
    } catch (submitError) {
      const message = errorMessage(submitError, "No se pudo convertir en factura completa.");
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-4" data-testid="substitute-simplified-form" noValidate onSubmit={submit}>
      <InvoiceCustomerPicker
        canCreateCustomer={false}
        customer={customer}
        description="Solo aparecen los clientes activos que tienen NIF."
        hasCustomers={customers.length > 0}
        onCreate={() => undefined}
        onSearch={() => setSearchOpen(true)}
      />
      <p className="text-xs text-muted-foreground">
        ¿El cliente no está en la lista? <Link className="text-primary underline" href="/customers">Dalo de alta en Clientes</Link> con su NIF y su domicilio, y vuelve aquí.
      </p>
      <AccessibleField helperText="No puede ser anterior a la de la factura simplificada. La fecha de la venta original se imprime como fecha de operación." id="substitute-issue-date" label="Fecha de la factura" required>
        <Input id="substitute-issue-date" onChange={(event) => setIssueDate(event.target.value)} type="date" value={issueDate} />
      </AccessibleField>
      {others.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="font-mono text-xs font-bold uppercase tracking-wide">Incluir también estas simplificadas (opcional)</legend>
          {others.map((other) => (
            <label className="flex cursor-pointer items-center gap-2 rounded-surface border border-window-dark-shadow bg-window-panel p-2 text-sm" key={other.id}>
              <input
                checked={extraIds.includes(other.id)}
                className="accent-primary"
                onChange={(event) => setExtraIds((current) => (event.target.checked ? [...current, other.id] : current.filter((id) => id !== other.id)))}
                type="checkbox"
              />
              <span className="font-mono font-semibold">{other.number}</span>
              <span className="text-xs text-muted-foreground">{other.issueDateLabel}</span>
              <span className="ml-auto font-mono">{other.totalLabel}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <InlineAlert title="Qué va a pasar" tone="info">
        Se emite una factura nueva, con número de la serie de facturas, que repite los conceptos e importes de {invoice.number} y la cita.
        No se anula la simplificada, no se vuelve a contar la venta ni el IVA y el cobro ya registrado sigue valiendo. No se puede deshacer.
      </InlineAlert>
      <FormErrorMessage>{error}</FormErrorMessage>
      <div className="flex justify-end">
        <SubmitButton data-testid="substitute-simplified-submit" pending={pending} pendingLabel="Emitiendo…">Emitir factura completa</SubmitButton>
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
