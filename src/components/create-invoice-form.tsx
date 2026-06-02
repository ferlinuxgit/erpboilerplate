"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { AccessibleField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/format";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { createCustomerSchema, createInvoiceSchema } from "@/server/schemas/forms";

type CustomerOption = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  taxId?: string | null;
  city?: string | null;
  province?: string | null;
};

type CreateInvoicePayload = z.infer<typeof createInvoiceSchema>;
type CreateCustomerPayload = z.infer<typeof createCustomerSchema>;
type CreatedInvoicePayload = {
  id: string;
  number: string;
  status: string;
  customer?: CustomerOption | null;
};

const emptyLine = {
  description: "",
  quantity: 1,
  unitPrice: 0,
  taxRate: 21,
};

export function CreateInvoiceForm({ canCreateCustomer, customers }: { canCreateCustomer: boolean; customers: CustomerOption[] }) {
  const router = useRouter();
  const [customerOptions, setCustomerOptions] = useState(customers);
  const [customerSearchDialogOpen, setCustomerSearchDialogOpen] = useState(false);
  const [customerCreateDialogOpen, setCustomerCreateDialogOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerLocationSearch, setCustomerLocationSearch] = useState("");
  const [customerTaxSearch, setCustomerTaxSearch] = useState("");
  const [pendingFocusLineIndex, setPendingFocusLineIndex] = useState<number | null>(null);
  const {
    control,
    register,
    setValue,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateInvoicePayload>({
    resolver: zodResolver(createInvoiceSchema),
    shouldUnregister: true,
    defaultValues: {
      customerId: "",
      number: "",
      issueDate: "",
      dueDate: "",
      totalAmount: 0,
      notes: "",
      lines: [emptyLine],
    },
  });
  const {
    register: registerCustomer,
    reset: resetCustomer,
    handleSubmit: handleCustomerSubmit,
    formState: { errors: customerErrors, isSubmitting: isCreatingCustomer },
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
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const watchedLines = useWatch({ control, name: "lines" });
  const selectedCustomerId = useWatch({ control, name: "customerId" });
  const totals = calculateInvoiceTotals(watchedLines ?? []);
  const selectedCustomer = customerOptions.find((customer) => customer.id === selectedCustomerId) ?? null;
  const filteredCustomers = useMemo(() => {
    const textQuery = customerSearch.trim().toLocaleLowerCase();
    const locationQuery = customerLocationSearch.trim().toLocaleLowerCase();
    const taxQuery = customerTaxSearch.trim().toLocaleLowerCase();

    return customerOptions.filter((customer) => {
      const text = [customer.name, customer.email, customer.phone].filter(Boolean).join(" ").toLocaleLowerCase();
      const location = [customer.city, customer.province].filter(Boolean).join(" ").toLocaleLowerCase();
      const tax = (customer.taxId ?? "").toLocaleLowerCase();
      return (!textQuery || text.includes(textQuery)) && (!locationQuery || location.includes(locationQuery)) && (!taxQuery || tax.includes(taxQuery));
    });
  }, [customerLocationSearch, customerOptions, customerSearch, customerTaxSearch]);

  useEffect(() => {
    setValue("totalAmount", totals.totalAmount, { shouldValidate: true });
  }, [setValue, totals.totalAmount]);

  useEffect(() => {
    if (pendingFocusLineIndex === null) return;
    const descriptionId = `invoice-line-${pendingFocusLineIndex + 1}-description`;
    requestAnimationFrame(() => {
      document.getElementById(descriptionId)?.focus();
      setPendingFocusLineIndex(null);
    });
  }, [fields.length, pendingFocusLineIndex]);

  useEffect(() => {
    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      const form = document.querySelector('[data-testid="invoice-create-form"]');
      if (!form?.contains(document.activeElement) || customerSearchDialogOpen || customerCreateDialogOpen) return;
      const key = event.key.toLowerCase();
      const code = event.code.toLowerCase();
      if (!event.altKey || (key !== "n" && code !== "keyn") || !canCreateCustomer) return;
      event.preventDefault();
      setCustomerCreateDialogOpen(true);
    };

    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => document.removeEventListener("keydown", handleDocumentKeyDown);
  }, [canCreateCustomer, customerCreateDialogOpen, customerSearchDialogOpen]);

  const openCustomerSearchDialog = () => setCustomerSearchDialogOpen(true);
  const openCustomerCreateDialog = () => {
    setCustomerSearchDialogOpen(false);
    setCustomerCreateDialogOpen(true);
  };

  const addLineAndFocus = () => {
    append(emptyLine);
    setPendingFocusLineIndex(fields.length);
  };

  const focusLineDescription = (index: number) => {
    setPendingFocusLineIndex(index);
  };

  const removeLineAndFocus = (index: number) => {
    remove(index);
    setPendingFocusLineIndex(Math.max(0, index - 1));
  };

  const handleInvoiceKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    const key = event.key.toLowerCase();
    const code = event.code.toLowerCase();
    const isNewCustomerShortcut = key === "n" || code === "keyn";
    const isAddLineShortcut = key === "l" || code === "keyl";

    if (event.altKey && isNewCustomerShortcut && canCreateCustomer) {
      event.preventDefault();
      openCustomerCreateDialog();
      return;
    }

    if (event.altKey && isAddLineShortcut) {
      event.preventDefault();
      addLineAndFocus();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.requestSubmit();
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      const invoiceTotals = calculateInvoiceTotals(values.lines);
      const response = await fetch("/api/invoices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getCsrfHeader(),
        },
        body: JSON.stringify({ ...values, newCustomer: undefined, totalAmount: invoiceTotals.totalAmount }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message ?? "No se pudo crear la factura.");
      }

      const created = (await response.json()) as CreatedInvoicePayload;
      toast.success("Factura creada correctamente.");
      router.push(`/invoices/${created.id}`);
      router.refresh();
    } catch (submissionError) {
      const message = submissionError instanceof Error ? submissionError.message : "Ha ocurrido un error inesperado.";
      toast.error(message);
    }
  });

  const onCreateCustomer = handleCustomerSubmit(async (values) => {
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

      const createdCustomer = (await response.json()) as CustomerOption;
      setCustomerOptions((current) =>
        current.some((customer) => customer.id === createdCustomer.id) ? current : [...current, createdCustomer],
      );
      setValue("customerId", createdCustomer.id, { shouldDirty: true, shouldValidate: true });
      resetCustomer();
      setCustomerCreateDialogOpen(false);
      toast.success("Cliente creado y seleccionado.");
      router.refresh();
      requestAnimationFrame(() => document.getElementById("invoice-number")?.focus());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ha ocurrido un error inesperado.");
    }
  });

  return (
    <>
    <form className="grid gap-4 md:grid-cols-3" data-testid="invoice-create-form" onKeyDown={handleInvoiceKeyDown} onSubmit={onSubmit}>
      <input type="hidden" {...register("totalAmount", { valueAsNumber: true })} />
      <input type="hidden" {...register("customerId")} />
      <section className="space-y-3 rounded-md border p-3 md:col-span-3" aria-labelledby="invoice-customer-title">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 id="invoice-customer-title" className="text-sm font-medium">
              Cliente
            </h3>
            <p className="text-sm text-muted-foreground">Selecciona el cliente desde el buscador avanzado antes de emitir la factura.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={openCustomerSearchDialog}
            >
              Buscar cliente
            </Button>
            {canCreateCustomer ? (
              <Button
                aria-keyshortcuts="Alt+N"
                data-testid="invoice-new-customer-toggle"
                type="button"
                variant="secondary"
                onClick={openCustomerCreateDialog}
              >
                Crear cliente
              </Button>
            ) : null}
          </div>
        </div>

        {customerOptions.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            {canCreateCustomer
              ? "Todavía no hay clientes activos. Crea uno desde el botón Crear cliente para poder emitir la factura."
              : "No hay clientes activos y tu rol no permite crear clientes desde la factura."}
          </p>
        ) : selectedCustomer ? (
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="font-medium">{selectedCustomer.name}</p>
            <p className="text-sm text-muted-foreground">
              {[selectedCustomer.taxId, selectedCustomer.city, selectedCustomer.province, selectedCustomer.email].filter(Boolean).join(" · ") || "Cliente activo"}
            </p>
          </div>
        ) : (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Pulsa Buscar cliente para seleccionar uno.</p>
        )}
        {errors.customerId ? <p className="text-sm text-red-600" role="alert">{errors.customerId.message}</p> : null}
      </section>
      <AccessibleField id="invoice-number" label="Número" required error={errors.number?.message} helperText="Usa una numeración única y reconocible.">
        <Input
          data-testid="invoice-number-input"
          id="invoice-number"
          placeholder="FAC-2026-0001"
          required
          aria-label="Número de factura"
          aria-invalid={Boolean(errors.number)}
          aria-describedby={errors.number ? "invoice-number-error" : "invoice-number-helper"}
          {...register("number")}
        />
      </AccessibleField>
      <AccessibleField id="invoice-issue-date" label="Fecha emisión" required error={errors.issueDate?.message}>
        <Input
          data-testid="invoice-issue-date-input"
          id="invoice-issue-date"
          required
          type="date"
          aria-label="Fecha de emisión"
          aria-invalid={Boolean(errors.issueDate)}
          aria-describedby={errors.issueDate ? "invoice-issue-date-error" : undefined}
          {...register("issueDate")}
        />
      </AccessibleField>
      <AccessibleField id="invoice-due-date" label="Fecha vencimiento" error={errors.dueDate?.message}>
        <Input
          data-testid="invoice-due-date-input"
          id="invoice-due-date"
          type="date"
          aria-label="Fecha de vencimiento"
          aria-invalid={Boolean(errors.dueDate)}
          aria-describedby={errors.dueDate ? "invoice-due-date-error" : undefined}
          {...register("dueDate")}
        />
      </AccessibleField>
      <AccessibleField id="invoice-notes" label="Notas" className="md:col-span-2" error={errors.notes?.message} helperText="Opcional; se mostrarán como observaciones internas.">
        <Input
          data-testid="invoice-notes-input"
          id="invoice-notes"
          placeholder="Observaciones"
          aria-label="Notas de factura"
          aria-invalid={Boolean(errors.notes)}
          aria-describedby={errors.notes ? "invoice-notes-error" : "invoice-notes-helper"}
          {...register("notes")}
        />
      </AccessibleField>

      <section className="space-y-3 md:col-span-3" aria-labelledby="invoice-lines-title">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 id="invoice-lines-title" className="text-sm font-medium">
              Líneas de factura
            </h3>
            <p className="text-sm text-muted-foreground">Añade al menos una línea para calcular el total automáticamente.</p>
          </div>
          <Button aria-keyshortcuts="Alt+L" data-testid="invoice-add-line" type="button" variant="outline" onClick={addLineAndFocus}>
            Añadir línea
          </Button>
        </div>

        {fields.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No hay líneas en esta factura.</p>
        ) : (
          <div className="space-y-3">
            {fields.map((field, index) => {
              const lineNumber = index + 1;
              const descriptionId = `invoice-line-${lineNumber}-description`;
              const quantityId = `invoice-line-${lineNumber}-quantity`;
              const unitPriceId = `invoice-line-${lineNumber}-unit-price`;
              const taxRateId = `invoice-line-${lineNumber}-tax-rate`;
              const lineErrors = errors.lines?.[index];
              const lineTotals = totals.lines[index] ?? { subtotal: 0, taxAmount: 0, lineTotal: 0 };
              return (
                <fieldset key={field.id} className="grid gap-3 rounded-md border p-3 md:grid-cols-12" data-testid={`invoice-line-${lineNumber}`}>
                  <legend className="px-1 text-sm font-medium">Línea {lineNumber}</legend>
                  <div className="space-y-2 md:col-span-4">
                    <Label htmlFor={descriptionId}>Descripción línea {lineNumber}</Label>
                    <Input
                      data-testid={descriptionId}
                      id={descriptionId}
                      aria-label={`Descripción línea ${lineNumber}`}
                      aria-invalid={Boolean(lineErrors?.description)}
                      {...register(`lines.${index}.description`)}
                    />
                    {lineErrors?.description ? <p className="text-sm text-red-600" role="alert">{lineErrors.description.message}</p> : null}
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor={quantityId}>Cantidad línea {lineNumber}</Label>
                    <Input
                      data-testid={quantityId}
                      id={quantityId}
                      aria-label={`Cantidad línea ${lineNumber}`}
                      min={0.001}
                      step="0.001"
                      type="number"
                      aria-invalid={Boolean(lineErrors?.quantity)}
                      {...register(`lines.${index}.quantity`, { valueAsNumber: true })}
                    />
                    {lineErrors?.quantity ? <p className="text-sm text-red-600" role="alert">{lineErrors.quantity.message}</p> : null}
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor={unitPriceId}>Precio unitario línea {lineNumber}</Label>
                    <Input
                      data-testid={unitPriceId}
                      id={unitPriceId}
                      aria-label={`Precio unitario línea ${lineNumber}`}
                      min={0}
                      step="0.01"
                      type="number"
                      aria-invalid={Boolean(lineErrors?.unitPrice)}
                      {...register(`lines.${index}.unitPrice`, { valueAsNumber: true })}
                    />
                    {lineErrors?.unitPrice ? <p className="text-sm text-red-600" role="alert">{lineErrors.unitPrice.message}</p> : null}
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor={taxRateId}>IVA % línea {lineNumber}</Label>
                    <Input
                      data-testid={taxRateId}
                      id={taxRateId}
                      aria-label={`IVA % línea ${lineNumber}`}
                      min={0}
                      max={100}
                      step="0.001"
                      type="number"
                      aria-invalid={Boolean(lineErrors?.taxRate)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" || event.shiftKey) return;
                        event.preventDefault();
                        if (index === fields.length - 1) {
                          addLineAndFocus();
                        } else {
                          focusLineDescription(index + 1);
                        }
                      }}
                      {...register(`lines.${index}.taxRate`, { valueAsNumber: true })}
                    />
                    {lineErrors?.taxRate ? <p className="text-sm text-red-600" role="alert">{lineErrors.taxRate.message}</p> : null}
                  </div>
                  <div className="flex items-end justify-between gap-3 md:col-span-2">
                    <p className="text-sm text-muted-foreground" aria-live="polite" data-testid={`invoice-line-${lineNumber}-total`}>
                      Línea: {formatMoney(lineTotals.lineTotal)}
                    </p>
                    <Button type="button" variant="ghost" onClick={() => removeLineAndFocus(index)} disabled={fields.length === 1}>
                      Quitar
                    </Button>
                  </div>
                </fieldset>
              );
            })}
          </div>
        )}
        {errors.lines?.root ? <p className="text-sm text-red-600" role="alert">{errors.lines.root.message}</p> : null}
      </section>

      <div className="rounded-md bg-muted p-3 text-sm md:col-span-3" aria-live="polite" data-testid="invoice-totals">
        <p data-testid="invoice-subtotal">Subtotal: {formatMoney(totals.subtotal)}</p>
        <p data-testid="invoice-tax-total">IVA: {formatMoney(totals.taxAmount)}</p>
        <p className="font-medium" data-testid="invoice-grand-total">Total: {formatMoney(totals.totalAmount)}</p>
        {errors.totalAmount ? <p className="text-red-600" role="alert">{errors.totalAmount.message}</p> : null}
      </div>

      <div className="md:col-span-3">
        <Button aria-keyshortcuts="Control+Enter Meta+Enter" data-testid="invoice-create-submit" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Guardando..." : "Crear factura"}
        </Button>
      </div>
    </form>
    <Dialog
      initialFocusId="invoice-customer-search"
      open={customerSearchDialogOpen}
      onClose={() => setCustomerSearchDialogOpen(false)}
      title="Seleccionar cliente"
    >
      <div className="space-y-4" data-testid="invoice-customer-search-dialog">
        <div className="grid gap-3 md:grid-cols-3">
          <AccessibleField id="invoice-customer-search" label="Nombre, email o teléfono">
            <Input
              id="invoice-customer-search"
              value={customerSearch}
              onChange={(event) => setCustomerSearch(event.target.value)}
            />
          </AccessibleField>
          <AccessibleField id="invoice-customer-location-search" label="Ciudad o provincia">
            <Input
              id="invoice-customer-location-search"
              value={customerLocationSearch}
              onChange={(event) => setCustomerLocationSearch(event.target.value)}
            />
          </AccessibleField>
          <AccessibleField id="invoice-customer-tax-search" label="CIF/NIF/VAT">
            <Input
              id="invoice-customer-tax-search"
              value={customerTaxSearch}
              onChange={(event) => setCustomerTaxSearch(event.target.value)}
            />
          </AccessibleField>
        </div>

        <div className="max-h-80 space-y-2 overflow-y-auto">
          {filteredCustomers.length === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No hay clientes que coincidan con la búsqueda.</p>
          ) : (
            filteredCustomers.map((customer) => (
              <button
                className="w-full rounded-md border p-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                key={customer.id}
                type="button"
                onClick={() => {
                  setValue("customerId", customer.id, { shouldDirty: true, shouldValidate: true });
                  setCustomerSearchDialogOpen(false);
                  requestAnimationFrame(() => document.getElementById("invoice-number")?.focus());
                }}
              >
                <span className="block font-medium">{customer.name}</span>
                <span className="block text-sm text-muted-foreground">
                  {[customer.taxId, customer.city, customer.province, customer.email, customer.phone].filter(Boolean).join(" · ") || "Cliente activo"}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="flex justify-between gap-2">
          {canCreateCustomer ? (
            <Button type="button" variant="secondary" onClick={openCustomerCreateDialog}>
              Crear nuevo cliente
            </Button>
          ) : <span />}
          <Button type="button" variant="outline" onClick={() => setCustomerSearchDialogOpen(false)}>
            Cancelar
          </Button>
        </div>
      </div>
    </Dialog>
    <Dialog
      initialFocusId="invoice-new-customer-name"
      open={customerCreateDialogOpen}
      onClose={() => setCustomerCreateDialogOpen(false)}
      title="Nuevo cliente"
    >
      <form className="grid gap-3 md:grid-cols-2" data-testid="invoice-new-customer-dialog-form" onSubmit={onCreateCustomer}>
        <AccessibleField id="invoice-new-customer-name" label="Nombre / razón social" required className="md:col-span-2" error={customerErrors.name?.message}>
          <Input
            data-testid="invoice-new-customer-name-input"
            id="invoice-new-customer-name"
            required
            aria-label="Nombre o razón social del cliente nuevo"
            aria-invalid={Boolean(customerErrors.name)}
            aria-describedby={customerErrors.name ? "invoice-new-customer-name-error" : undefined}
            {...registerCustomer("name")}
          />
        </AccessibleField>
        <AccessibleField id="invoice-new-customer-tax-id" label="CIF/NIF/VAT" required error={customerErrors.taxId?.message}>
          <Input
            data-testid="invoice-new-customer-tax-id-input"
            id="invoice-new-customer-tax-id"
            placeholder="B12345674"
            required
            aria-label="CIF NIF VAT del cliente nuevo"
            aria-invalid={Boolean(customerErrors.taxId)}
            aria-describedby={customerErrors.taxId ? "invoice-new-customer-tax-id-error" : undefined}
            {...registerCustomer("taxId")}
          />
        </AccessibleField>
        <AccessibleField id="invoice-new-customer-country" label="País" required error={customerErrors.countryCode?.message}>
          <Input
            data-testid="invoice-new-customer-country-input"
            id="invoice-new-customer-country"
            maxLength={2}
            required
            aria-label="País del cliente nuevo"
            aria-invalid={Boolean(customerErrors.countryCode)}
            aria-describedby={customerErrors.countryCode ? "invoice-new-customer-country-error" : undefined}
            {...registerCustomer("countryCode")}
          />
        </AccessibleField>
        <AccessibleField id="invoice-new-customer-address" label="Dirección fiscal" required className="md:col-span-2" error={customerErrors.address?.message}>
          <Input
            data-testid="invoice-new-customer-address-input"
            id="invoice-new-customer-address"
            required
            aria-label="Dirección fiscal del cliente nuevo"
            aria-invalid={Boolean(customerErrors.address)}
            aria-describedby={customerErrors.address ? "invoice-new-customer-address-error" : undefined}
            {...registerCustomer("address")}
          />
        </AccessibleField>
        <AccessibleField id="invoice-new-customer-postal-code" label="Código postal" required error={customerErrors.postalCode?.message}>
          <Input
            data-testid="invoice-new-customer-postal-code-input"
            id="invoice-new-customer-postal-code"
            required
            aria-label="Código postal del cliente nuevo"
            aria-invalid={Boolean(customerErrors.postalCode)}
            aria-describedby={customerErrors.postalCode ? "invoice-new-customer-postal-code-error" : undefined}
            {...registerCustomer("postalCode")}
          />
        </AccessibleField>
        <AccessibleField id="invoice-new-customer-city" label="Ciudad" required error={customerErrors.city?.message}>
          <Input
            data-testid="invoice-new-customer-city-input"
            id="invoice-new-customer-city"
            required
            aria-label="Ciudad del cliente nuevo"
            aria-invalid={Boolean(customerErrors.city)}
            aria-describedby={customerErrors.city ? "invoice-new-customer-city-error" : undefined}
            {...registerCustomer("city")}
          />
        </AccessibleField>
        <AccessibleField id="invoice-new-customer-province" label="Provincia" required error={customerErrors.province?.message}>
          <Input
            data-testid="invoice-new-customer-province-input"
            id="invoice-new-customer-province"
            required
            aria-label="Provincia del cliente nuevo"
            aria-invalid={Boolean(customerErrors.province)}
            aria-describedby={customerErrors.province ? "invoice-new-customer-province-error" : undefined}
            {...registerCustomer("province")}
          />
        </AccessibleField>
        <AccessibleField id="invoice-new-customer-address-line-2" label="Dirección 2" error={customerErrors.addressLine2?.message}>
          <Input
            data-testid="invoice-new-customer-address-line-2-input"
            id="invoice-new-customer-address-line-2"
            aria-label="Dirección 2 del cliente nuevo"
            aria-invalid={Boolean(customerErrors.addressLine2)}
            aria-describedby={customerErrors.addressLine2 ? "invoice-new-customer-address-line-2-error" : undefined}
            {...registerCustomer("addressLine2")}
          />
        </AccessibleField>
        <AccessibleField id="invoice-new-customer-email" label="Email" error={customerErrors.email?.message}>
          <Input
            data-testid="invoice-new-customer-email-input"
            id="invoice-new-customer-email"
            type="email"
            aria-label="Email del cliente nuevo"
            aria-invalid={Boolean(customerErrors.email)}
            aria-describedby={customerErrors.email ? "invoice-new-customer-email-error" : undefined}
            {...registerCustomer("email")}
          />
        </AccessibleField>
        <AccessibleField id="invoice-new-customer-phone" label="Teléfono" error={customerErrors.phone?.message}>
          <Input
            data-testid="invoice-new-customer-phone-input"
            id="invoice-new-customer-phone"
            aria-label="Teléfono del cliente nuevo"
            aria-invalid={Boolean(customerErrors.phone)}
            aria-describedby={customerErrors.phone ? "invoice-new-customer-phone-error" : undefined}
            {...registerCustomer("phone")}
          />
        </AccessibleField>
        <div className="flex justify-end gap-2 md:col-span-2">
          <Button type="button" variant="outline" onClick={() => setCustomerCreateDialogOpen(false)}>
            Cancelar
          </Button>
          <Button data-testid="invoice-new-customer-submit" disabled={isCreatingCustomer} type="submit">
            {isCreatingCustomer ? "Creando..." : "Crear cliente y usar"}
          </Button>
        </div>
      </form>
    </Dialog>
    </>
  );
}
