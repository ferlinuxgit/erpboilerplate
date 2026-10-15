"use client";

import { MagnifyingGlass, Plus } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";

type PickerCustomer = {
  number?: string | null;
  name: string;
  taxId?: string | null;
  city?: string | null;
  province?: string | null;
  email?: string | null;
};

/**
 * Cliente de una factura (alta y borradores). Sin cliente: un botón ancho «Buscar cliente» que abre
 * el buscador (cómodo con el pulgar); con cliente: su tarjeta y «Cambiar cliente». «Crear cliente»
 * queda como acción secundaria en la cabecera.
 */
export function InvoiceCustomerPicker({
  canCreateCustomer,
  customer,
  description,
  error,
  hasCustomers,
  onCreate,
  onSearch,
}: {
  customer: PickerCustomer | null;
  hasCustomers: boolean;
  canCreateCustomer: boolean;
  /** Ayuda bajo el título (se oculta en pantallas pequeñas para ganar espacio). */
  description?: string;
  error?: string;
  onSearch: () => void;
  onCreate: () => void;
}) {
  return (
    <section aria-labelledby="invoice-customer-title" className="min-w-0 space-y-2 rounded-surface border border-window-dark-shadow bg-window-panel p-3 md:col-span-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-mono text-xs font-bold uppercase tracking-wide" id="invoice-customer-title">Cliente</h3>
          {description ? <p className="text-xs text-muted-foreground max-sm:hidden">{description}</p> : null}
        </div>
        {canCreateCustomer ? (
          <Button aria-keyshortcuts="Alt+N" data-testid="invoice-new-customer-toggle" onClick={onCreate} size="sm" type="button" variant="secondary">
            <Plus aria-hidden="true" />
            Crear cliente
          </Button>
        ) : null}
      </div>

      {!hasCustomers ? (
        <p className="rounded-surface border border-dashed border-window-shadow bg-window-surface p-3 text-xs text-muted-foreground">
          {canCreateCustomer
            ? "Todavía no hay clientes activos. Crea uno con «Crear cliente» para poder emitir la factura."
            : "No hay clientes activos y tu rol no permite crear clientes desde la factura."}
        </p>
      ) : customer ? (
        <div className="flex items-center gap-3 rounded-surface border border-window-dark-shadow bg-window-surface p-3" data-slot="selected-customer">
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm font-bold">{customer.number ? `${customer.number} · ` : ""}{customer.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {[customer.taxId, customer.city, customer.province, customer.email].filter(Boolean).join(" · ") || "Cliente activo"}
            </p>
          </div>
          <Button className="shrink-0" onClick={onSearch} size="sm" type="button" variant="outline">Cambiar cliente</Button>
        </div>
      ) : (
        <Button
          aria-invalid={error ? true : undefined}
          className="h-11 w-full justify-start gap-2 text-left"
          onClick={onSearch}
          type="button"
          variant="outline"
        >
          <MagnifyingGlass aria-hidden="true" />
          Buscar cliente
          <span className="ml-auto truncate text-xs font-normal text-muted-foreground max-sm:hidden">por nombre, NIF, email o teléfono</span>
        </Button>
      )}
      {error ? <p className="font-mono text-xs text-danger-text" role="alert">{error}</p> : null}
    </section>
  );
}
