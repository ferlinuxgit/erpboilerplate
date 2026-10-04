"use client";

import { useMemo, useState, type ChangeEvent } from "react";

import type { CustomerOption } from "@/components/create-invoice-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { AccessibleField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

type CustomerQuery = { text: string; location: string; taxId: string };

/** Filtra clientes por texto (número, nombre, email, teléfono), ubicación y CIF/NIF. */
export function filterCustomers<T extends CustomerOption>(customers: T[], query: CustomerQuery) {
  const textQuery = query.text.trim().toLocaleLowerCase();
  const locationQuery = query.location.trim().toLocaleLowerCase();
  const taxQuery = query.taxId.trim().toLocaleLowerCase();
  return customers.filter((customer) => {
    const text = [customer.number, customer.name, customer.email, customer.phone].filter(Boolean).join(" ").toLocaleLowerCase();
    const location = [customer.city, customer.province].filter(Boolean).join(" ").toLocaleLowerCase();
    const taxId = (customer.taxId ?? "").toLocaleLowerCase();
    return (!textQuery || text.includes(textQuery)) && (!locationQuery || location.includes(locationQuery)) && (!taxQuery || taxId.includes(taxQuery));
  });
}

/**
 * Diálogo «Seleccionar cliente» de las facturas (alta y edición de borradores).
 * Cada resultado es un botón de al menos 44 px en pantallas táctiles; el número
 * de coincidencias se anuncia a los lectores de pantalla.
 */
export function CustomerSearchDialog<T extends CustomerOption>({
  canCreateCustomer,
  customers,
  onClose,
  onCreateCustomer,
  onSelect,
  open,
}: {
  canCreateCustomer: boolean;
  customers: T[];
  onClose: () => void;
  onCreateCustomer: () => void;
  onSelect: (customer: T) => void;
  open: boolean;
}) {
  const [query, setQuery] = useState<CustomerQuery>({ text: "", location: "", taxId: "" });
  const results = useMemo(() => filterCustomers(customers, query), [customers, query]);
  const setField = (field: keyof CustomerQuery) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setQuery((current) => ({ ...current, [field]: value }));
  };

  return (
    <Dialog
      description="Busca por nombre o identificación fiscal y selecciona el cliente de la factura."
      initialFocusId="invoice-customer-search"
      open={open}
      onClose={onClose}
      size="lg"
      title="Seleccionar cliente"
    >
      <div className="space-y-4" data-testid="invoice-customer-search-dialog">
        <div className="grid gap-3 md:grid-cols-3">
          <AccessibleField id="invoice-customer-search" label="Número, nombre, email o teléfono">
            <Input autoComplete="off" id="invoice-customer-search" value={query.text} onChange={setField("text")} />
          </AccessibleField>
          <AccessibleField id="invoice-customer-location-search" label="Ciudad o provincia">
            <Input autoComplete="off" id="invoice-customer-location-search" value={query.location} onChange={setField("location")} />
          </AccessibleField>
          <AccessibleField id="invoice-customer-tax-search" label="CIF/NIF/VAT">
            <Input autoComplete="off" id="invoice-customer-tax-search" value={query.taxId} onChange={setField("taxId")} />
          </AccessibleField>
        </div>

        <p aria-live="polite" className="text-xs text-muted-foreground" role="status">
          {results.length === 0
            ? "No hay clientes que coincidan con la búsqueda."
            : `${results.length} cliente${results.length === 1 ? "" : "s"}`}
        </p>
        {results.length > 0 ? (
          <ul aria-label="Clientes encontrados" className="max-h-80 space-y-2 overflow-y-auto overscroll-contain p-0.5">
            {results.map((customer) => (
              <li key={customer.id}>
                <button
                  className="w-full rounded-surface border border-window-dark-shadow bg-window-surface p-3 text-left shadow-raised hover:bg-window-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:shadow-pressed pointer-coarse:min-h-11"
                  type="button"
                  onClick={() => onSelect(customer)}
                >
                  <span className="block font-mono text-sm font-bold">{customer.number ? `${customer.number} · ` : ""}{customer.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[customer.taxId, customer.city, customer.province, customer.email, customer.phone].filter(Boolean).join(" · ") || "Cliente activo"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap justify-between gap-2">
          {canCreateCustomer ? (
            <Button type="button" variant="secondary" onClick={onCreateCustomer}>
              Crear nuevo cliente
            </Button>
          ) : <span />}
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
