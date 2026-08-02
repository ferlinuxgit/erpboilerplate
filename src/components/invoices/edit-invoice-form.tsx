"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import type { CustomerOption, InvoicePaymentMethodOption, InvoiceTaxOption } from "@/components/create-invoice-form";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { AccessibleField } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/format";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { paymentMethodTypeLabels } from "@/lib/payment-methods";
import { invoiceStatusLabels, statusLabel } from "@/lib/status-labels";
import { createCustomerSchema, updateInvoiceSchema } from "@/server/schemas/forms";

const statusOptions = ["DRAFT", "SENT", "PAID", "OVERDUE", "VOID"] as const;

type UpdateInvoicePayload = z.infer<typeof updateInvoiceSchema>;
type CreateCustomerPayload = z.infer<typeof createCustomerSchema>;

type EditableInvoiceLine = UpdateInvoicePayload["lines"][number];

export function EditInvoiceForm({
  canCreateCustomer,
  customers,
  defaultCustomerId,
  defaultDueDate,
  defaultLines,
  defaultIssueDate,
  defaultNotes,
  defaultPaymentMethodIds,
  defaultStatus,
  defaultTotalAmount,
  id,
  invoiceNumber,
  paymentMethods,
  taxes,
}: {
  id: string;
  invoiceNumber: string;
  canCreateCustomer: boolean;
  customers: CustomerOption[];
  defaultCustomerId: string;
  defaultDueDate: string;
  defaultLines: EditableInvoiceLine[];
  defaultIssueDate: string;
  defaultNotes: string | null;
  defaultPaymentMethodIds: string[];
  defaultStatus: "DRAFT" | "SENT" | "PAID" | "OVERDUE" | "VOID";
  defaultTotalAmount: number;
  taxes: Array<InvoiceTaxOption & { isActive: boolean }>;
  paymentMethods: InvoicePaymentMethodOption[];
}) {
  const router = useRouter();
  const [customerOptions, setCustomerOptions] = useState(customers);
  const [customerSearchDialogOpen, setCustomerSearchDialogOpen] = useState(false);
  const [customerCreateDialogOpen, setCustomerCreateDialogOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerLocationSearch, setCustomerLocationSearch] = useState("");
  const [customerTaxSearch, setCustomerTaxSearch] = useState("");
  const [pendingFocusLineIndex, setPendingFocusLineIndex] = useState<number | null>(null);
  const defaultTaxIds = useMemo(() => taxes.filter((configuredTax) => configuredTax.isActive && configuredTax.isDefault).map((configuredTax) => configuredTax.id), [taxes]);
  const emptyLine: EditableInvoiceLine = {
    description: "",
    quantity: 1,
    unitPrice: 0,
    taxRate: 0,
    retentionRate: 0,
    taxIds: defaultTaxIds,
  };
  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<UpdateInvoicePayload>({
    resolver: zodResolver(updateInvoiceSchema),
    defaultValues: {
      status: defaultStatus,
      customerId: defaultCustomerId,
      issueDate: defaultIssueDate,
      dueDate: defaultDueDate,
      notes: defaultNotes ?? "",
      paymentMethodIds: defaultPaymentMethodIds,
      totalAmount: defaultTotalAmount,
      lines: defaultLines.length > 0 ? defaultLines : [emptyLine],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const watchedLines = useWatch({ control, name: "lines" });
  const selectedCustomerId = useWatch({ control, name: "customerId" });
  const calculatedLines = (watchedLines ?? []).map((line) => ({
    ...line,
    taxes: taxes.filter((configuredTax) => line?.taxIds?.includes(configuredTax.id)),
  }));
  const totals = calculateInvoiceTotals(calculatedLines);
  const taxBreakdown = useMemo(() => {
    const rows = new Map<string, { name: string; rate: number; operation: "ADD" | "SUBTRACT"; amount: number }>();
    for (const line of totals.lines) {
      for (const selectedTax of line.taxes) {
        const key = `${selectedTax.name}-${selectedTax.rate}-${selectedTax.operation}`;
        const current = rows.get(key) ?? {
          name: selectedTax.name ?? (selectedTax.operation === "SUBTRACT" ? "Retención" : "Impuesto"),
          rate: selectedTax.rate,
          operation: selectedTax.operation,
          amount: 0,
        };
        current.amount = Math.round((current.amount + selectedTax.amount + Number.EPSILON) * 100) / 100;
        rows.set(key, current);
      }
    }
    return [...rows.values()];
  }, [totals.lines]);
  const statusErrorId = errors.status ? "invoice-status-error" : undefined;
  const selectedCustomer = customerOptions.find((customer) => customer.id === selectedCustomerId) ?? null;
  const filteredCustomers = useMemo(() => {
    const textQuery = customerSearch.trim().toLocaleLowerCase();
    const locationQuery = customerLocationSearch.trim().toLocaleLowerCase();
    const taxQuery = customerTaxSearch.trim().toLocaleLowerCase();
    return customerOptions.filter((customer) => {
      const text = [customer.number, customer.name, customer.email, customer.phone].filter(Boolean).join(" ").toLocaleLowerCase();
      const location = [customer.city, customer.province].filter(Boolean).join(" ").toLocaleLowerCase();
      const taxId = (customer.taxId ?? "").toLocaleLowerCase();
      return (!textQuery || text.includes(textQuery)) && (!locationQuery || location.includes(locationQuery)) && (!taxQuery || taxId.includes(taxQuery));
    });
  }, [customerLocationSearch, customerOptions, customerSearch, customerTaxSearch]);
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

  useEffect(() => {
    setValue("totalAmount", totals.totalAmount, { shouldValidate: true });
  }, [setValue, totals.totalAmount]);

  useEffect(() => {
    if (pendingFocusLineIndex === null) return;
    requestAnimationFrame(() => {
      document.getElementById(`invoice-line-${pendingFocusLineIndex + 1}-description`)?.focus();
      setPendingFocusLineIndex(null);
    });
  }, [fields.length, pendingFocusLineIndex]);

  const addLineAndFocus = () => {
    append(emptyLine);
    setPendingFocusLineIndex(fields.length);
  };

  const removeLineAndFocus = (index: number) => {
    remove(index);
    setPendingFocusLineIndex(Math.max(0, index - 1));
  };

  const handleInvoiceKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    const key = event.key.toLowerCase();
    const code = event.code.toLowerCase();
    if (event.altKey && (key === "n" || code === "keyn") && canCreateCustomer) {
      event.preventDefault();
      setCustomerSearchDialogOpen(false);
      setCustomerCreateDialogOpen(true);
      return;
    }
    if (event.altKey && (key === "l" || code === "keyl")) {
      event.preventDefault();
      addLineAndFocus();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.requestSubmit();
    }
  };

  const onCreateCustomer = handleCustomerSubmit(async (values) => {
    try {
      const response = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? "No se pudo crear el cliente.");
      }
      const createdCustomer = (await response.json()) as CustomerOption;
      setCustomerOptions((current) => current.some((customer) => customer.id === createdCustomer.id) ? current : [...current, createdCustomer]);
      setValue("customerId", createdCustomer.id, { shouldDirty: true, shouldValidate: true });
      resetCustomer();
      setCustomerCreateDialogOpen(false);
      toast.success("Cliente creado y seleccionado.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ha ocurrido un error inesperado.");
    }
  });

  return (
    <>
    <form
      className="grid gap-4 md:grid-cols-3"
      data-testid="invoice-edit-form"
      onKeyDown={handleInvoiceKeyDown}
      onSubmit={handleSubmit(async (values) => {
        const invoiceTotals = calculateInvoiceTotals(values.lines.map((line) => ({
          ...line,
          taxes: taxes.filter((configuredTax) => line.taxIds?.includes(configuredTax.id)),
        })));
        const response = await fetch(`/api/invoices/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getCsrfHeader() },
          body: JSON.stringify({ ...values, totalAmount: invoiceTotals.totalAmount }),
        });

        if (!response.ok) {
          const payload = (await response.json()) as { message?: string };
          toast.error(payload.message ?? "No se pudo actualizar la factura.");
          return;
        }

        toast.success("Factura actualizada correctamente.");
        router.push(`/invoices/${id}`);
        router.refresh();
      })}
    >
      <input type="hidden" {...register("totalAmount", { valueAsNumber: true })} />
      <input type="hidden" {...register("customerId")} />
      <section className="space-y-3 rounded-md border p-3 md:col-span-3" aria-labelledby="invoice-customer-title">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 id="invoice-customer-title" className="text-sm font-medium">Cliente</h3>
            <p className="text-sm text-muted-foreground">Puedes corregir el cliente mientras la factura no tenga cobros registrados.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setCustomerSearchDialogOpen(true)}>Buscar cliente</Button>
            {canCreateCustomer ? (
              <Button aria-keyshortcuts="Alt+N" data-testid="invoice-new-customer-toggle" type="button" variant="secondary" onClick={() => setCustomerCreateDialogOpen(true)}>
                Crear cliente
              </Button>
            ) : null}
          </div>
        </div>
        {selectedCustomer ? (
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="font-medium">{selectedCustomer.number ? `${selectedCustomer.number} · ` : ""}{selectedCustomer.name}</p>
            <p className="text-sm text-muted-foreground">
              {[selectedCustomer.taxId, selectedCustomer.city, selectedCustomer.province, selectedCustomer.email].filter(Boolean).join(" · ") || "Cliente activo"}
            </p>
          </div>
        ) : (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Selecciona un cliente activo.</p>
        )}
        {errors.customerId ? <p className="text-sm text-red-600" role="alert">{errors.customerId.message}</p> : null}
      </section>
      <div className="space-y-2 rounded-md border bg-muted/30 p-3">
        <p className="text-sm font-medium">Número de factura</p>
        <p className="text-sm text-muted-foreground" data-testid="invoice-number-preview">{invoiceNumber}</p>
      </div>
      <AccessibleField id="invoice-issue-date" label="Fecha emisión" required error={errors.issueDate?.message}>
        <Input
          data-testid="invoice-edit-issue-date-input"
          id="invoice-issue-date"
          type="date"
          required
          aria-label="Fecha de emisión"
          aria-invalid={Boolean(errors.issueDate)}
          aria-describedby={errors.issueDate ? "invoice-issue-date-error" : undefined}
          {...register("issueDate")}
        />
      </AccessibleField>
      <AccessibleField id="invoice-due-date" label="Fecha vencimiento" error={errors.dueDate?.message}>
        <Input
          data-testid="invoice-edit-due-date-input"
          id="invoice-due-date"
          type="date"
          aria-label="Fecha de vencimiento"
          aria-invalid={Boolean(errors.dueDate)}
          aria-describedby={errors.dueDate ? "invoice-due-date-error" : undefined}
          {...register("dueDate")}
        />
      </AccessibleField>
      <div className="space-y-2">
        <Label htmlFor="invoice-status">Estado</Label>
        <Select
          id="invoice-status"
          aria-invalid={Boolean(errors.status)}
          aria-describedby={statusErrorId}
          {...register("status")}
        >
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {statusLabel(invoiceStatusLabels, status)}
            </option>
          ))}
        </Select>
        {errors.status ? (
          <p id="invoice-status-error" className="text-sm text-red-600" role="alert">
            {errors.status.message}
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label id="invoice-payment-methods-label">Formas de pago</Label>
        <div className="flex min-h-10 flex-wrap gap-2 rounded-md border p-2" role="group" aria-labelledby="invoice-payment-methods-label">
          {paymentMethods.map((method) => (
            <label className="flex cursor-pointer items-center gap-2 rounded-md border bg-background px-2 py-1 text-sm" key={method.id}>
              <input type="checkbox" value={method.id} {...register("paymentMethodIds")} />
              <span>{method.name} · {paymentMethodTypeLabels[method.type]}{method.bankAccountNumber ? ` · ${method.bankAccountNumber}` : ""}{method.isDefault ? " · Predeterminada" : ""}</span>
            </label>
          ))}
          {paymentMethods.length === 0 ? <p className="text-sm text-muted-foreground">No hay formas de pago configuradas.</p> : null}
        </div>
        {errors.paymentMethodIds ? <p className="text-sm text-red-600" role="alert">{errors.paymentMethodIds.message}</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="invoice-notes">Notas</Label>
        <Input id="invoice-notes" {...register("notes")} />
      </div>

      <section className="space-y-3 md:col-span-3" aria-labelledby="invoice-lines-title">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 id="invoice-lines-title" className="text-sm font-medium">
              Líneas de factura
            </h3>
            <p className="text-sm text-muted-foreground">Selecciona uno o varios impuestos por línea. Las retenciones reducen el total.</p>
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
              const lineErrors = errors.lines?.[index];
              const lineTotals = totals.lines[index] ?? { subtotal: 0, taxAmount: 0, retentionAmount: 0, lineTotal: 0, taxes: [] };
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
                    {lineErrors?.description ? <p className="text-sm text-red-600">{lineErrors.description.message}</p> : null}
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
                    {lineErrors?.quantity ? <p className="text-sm text-red-600">{lineErrors.quantity.message}</p> : null}
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
                    {lineErrors?.unitPrice ? <p className="text-sm text-red-600">{lineErrors.unitPrice.message}</p> : null}
                  </div>
                  <div className="space-y-2 md:col-span-4">
                    <Label>Impuestos línea {lineNumber}</Label>
                    <div className="flex min-h-10 flex-wrap gap-2 rounded-md border p-2" role="group" aria-label={`Impuestos línea ${lineNumber}`}>
                      {taxes.map((configuredTax) => (
                        <label className={`flex cursor-pointer items-center gap-2 rounded-md border bg-background px-2 py-1 text-sm ${configuredTax.isActive ? "" : "opacity-60"}`} key={configuredTax.id}>
                          <input type="checkbox" value={configuredTax.id} {...register(`lines.${index}.taxIds`)} />
                          <span>
                            {configuredTax.name} <span className="font-mono text-muted-foreground">{configuredTax.operation === "SUBTRACT" ? "−" : "+"}{configuredTax.rate.toLocaleString("es-ES")}%</span>
                            {!configuredTax.isActive ? " (archivado)" : ""}
                          </span>
                        </label>
                      ))}
                      {taxes.length === 0 ? <p className="text-sm text-muted-foreground">No hay impuestos configurados.</p> : null}
                    </div>
                    {lineErrors?.taxIds ? <p className="text-sm text-red-600">{lineErrors.taxIds.message}</p> : null}
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t pt-3 md:col-span-12">
                    <div className="text-sm text-muted-foreground" aria-live="polite">
                      <p>Base: {formatMoney(lineTotals.subtotal)} · Total línea: {formatMoney(lineTotals.lineTotal)}</p>
                      {lineTotals.taxes.length > 0 ? <p>{lineTotals.taxes.map((selectedTax) => `${selectedTax.operation === "SUBTRACT" ? "−" : "+"}${selectedTax.name} ${formatMoney(selectedTax.amount)}`).join(" · ")}</p> : null}
                    </div>
                    <Button type="button" variant="ghost" onClick={() => removeLineAndFocus(index)} disabled={fields.length === 1}>
                      Quitar
                    </Button>
                  </div>
                </fieldset>
              );
            })}
          </div>
        )}
        {errors.lines?.root ? <p className="text-sm text-red-600">{errors.lines.root.message}</p> : null}
      </section>

      <div className="rounded-md bg-muted p-3 text-sm md:col-span-3" aria-live="polite" data-testid="invoice-totals">
        <p>Subtotal: {formatMoney(totals.subtotal)}</p>
        {taxBreakdown.map((row) => (
          <p key={`${row.name}-${row.rate}-${row.operation}`}>
            {row.operation === "SUBTRACT" ? "−" : "+"} {row.name} ({row.rate.toLocaleString("es-ES")}%): {formatMoney(row.amount)}
          </p>
        ))}
        <p className="font-medium">Total: {formatMoney(totals.totalAmount)}</p>
        {errors.totalAmount ? <p className="text-red-600">{errors.totalAmount.message}</p> : null}
      </div>

      <div className="md:col-span-3">
        <Button aria-keyshortcuts="Control+Enter Meta+Enter" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Guardando..." : "Guardar cambios"}
        </Button>
      </div>
    </form>
    <Dialog
      description="Busca por nombre o identificación fiscal y selecciona el cliente de la factura."
      initialFocusId="invoice-customer-search"
      open={customerSearchDialogOpen}
      onClose={() => setCustomerSearchDialogOpen(false)}
      size="lg"
      title="Seleccionar cliente"
    >
      <div className="space-y-4" data-testid="invoice-customer-search-dialog">
        <div className="grid gap-3 md:grid-cols-3">
          <AccessibleField id="invoice-customer-search" label="Número, nombre, email o teléfono">
            <Input id="invoice-customer-search" aria-label="Número, nombre, email o teléfono" value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} />
          </AccessibleField>
          <AccessibleField id="invoice-customer-location-search" label="Ciudad o provincia">
            <Input id="invoice-customer-location-search" aria-label="Ciudad o provincia" value={customerLocationSearch} onChange={(event) => setCustomerLocationSearch(event.target.value)} />
          </AccessibleField>
          <AccessibleField id="invoice-customer-tax-search" label="CIF/NIF/VAT">
            <Input id="invoice-customer-tax-search" aria-label="CIF/NIF/VAT" value={customerTaxSearch} onChange={(event) => setCustomerTaxSearch(event.target.value)} />
          </AccessibleField>
        </div>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {filteredCustomers.length === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No hay clientes que coincidan con la búsqueda.</p>
          ) : filteredCustomers.map((customer) => (
            <button
              className="w-full rounded-md border p-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              key={customer.id}
              type="button"
              onClick={() => {
                setValue("customerId", customer.id, { shouldDirty: true, shouldValidate: true });
                setCustomerSearchDialogOpen(false);
              }}
            >
              <span className="block font-medium">{customer.number ? `${customer.number} · ` : ""}{customer.name}</span>
              <span className="block text-sm text-muted-foreground">{[customer.taxId, customer.city, customer.province, customer.email, customer.phone].filter(Boolean).join(" · ") || "Cliente activo"}</span>
            </button>
          ))}
        </div>
        <div className="flex justify-between gap-2">
          {canCreateCustomer ? <Button type="button" variant="secondary" onClick={() => { setCustomerSearchDialogOpen(false); setCustomerCreateDialogOpen(true); }}>Crear nuevo cliente</Button> : <span />}
          <Button type="button" variant="outline" onClick={() => setCustomerSearchDialogOpen(false)}>Cancelar</Button>
        </div>
      </div>
    </Dialog>
    <Dialog
      description="Registra los datos fiscales mínimos sin abandonar la factura."
      initialFocusId="invoice-new-customer-name"
      open={customerCreateDialogOpen}
      onClose={() => setCustomerCreateDialogOpen(false)}
      size="xl"
      title="Nuevo cliente"
    >
      <form className="grid gap-3 md:grid-cols-2" data-testid="invoice-new-customer-dialog-form" onSubmit={onCreateCustomer}>
        <AccessibleField id="invoice-new-customer-name" label="Nombre / razón social" required className="md:col-span-2" error={customerErrors.name?.message}>
          <Input data-testid="invoice-new-customer-name-input" id="invoice-new-customer-name" required aria-label="Nombre o razón social del cliente nuevo" aria-invalid={Boolean(customerErrors.name)} {...registerCustomer("name")} />
        </AccessibleField>
        <AccessibleField id="invoice-new-customer-tax-id" label="CIF/NIF/VAT" required error={customerErrors.taxId?.message}>
          <Input data-testid="invoice-new-customer-tax-id-input" id="invoice-new-customer-tax-id" required aria-label="CIF NIF VAT del cliente nuevo" aria-invalid={Boolean(customerErrors.taxId)} {...registerCustomer("taxId")} />
        </AccessibleField>
        <AccessibleField id="invoice-new-customer-country" label="País" required error={customerErrors.countryCode?.message}>
          <Input data-testid="invoice-new-customer-country-input" id="invoice-new-customer-country" maxLength={2} required aria-label="País del cliente nuevo" aria-invalid={Boolean(customerErrors.countryCode)} {...registerCustomer("countryCode")} />
        </AccessibleField>
        <AccessibleField id="invoice-new-customer-address" label="Dirección fiscal" required className="md:col-span-2" error={customerErrors.address?.message}>
          <Input data-testid="invoice-new-customer-address-input" id="invoice-new-customer-address" required aria-label="Dirección fiscal del cliente nuevo" aria-invalid={Boolean(customerErrors.address)} {...registerCustomer("address")} />
        </AccessibleField>
        <AccessibleField id="invoice-new-customer-postal-code" label="Código postal" required error={customerErrors.postalCode?.message}>
          <Input data-testid="invoice-new-customer-postal-code-input" id="invoice-new-customer-postal-code" required aria-label="Código postal del cliente nuevo" aria-invalid={Boolean(customerErrors.postalCode)} {...registerCustomer("postalCode")} />
        </AccessibleField>
        <AccessibleField id="invoice-new-customer-city" label="Ciudad" required error={customerErrors.city?.message}>
          <Input data-testid="invoice-new-customer-city-input" id="invoice-new-customer-city" required aria-label="Ciudad del cliente nuevo" aria-invalid={Boolean(customerErrors.city)} {...registerCustomer("city")} />
        </AccessibleField>
        <AccessibleField id="invoice-new-customer-province" label="Provincia" required error={customerErrors.province?.message}>
          <Input data-testid="invoice-new-customer-province-input" id="invoice-new-customer-province" required aria-label="Provincia del cliente nuevo" aria-invalid={Boolean(customerErrors.province)} {...registerCustomer("province")} />
        </AccessibleField>
        <AccessibleField id="invoice-new-customer-address-line-2" label="Dirección 2" error={customerErrors.addressLine2?.message}>
          <Input id="invoice-new-customer-address-line-2" aria-label="Dirección 2" {...registerCustomer("addressLine2")} />
        </AccessibleField>
        <AccessibleField id="invoice-new-customer-email" label="Email" error={customerErrors.email?.message}>
          <Input id="invoice-new-customer-email" type="email" aria-label="Email" {...registerCustomer("email")} />
        </AccessibleField>
        <AccessibleField id="invoice-new-customer-phone" label="Teléfono" error={customerErrors.phone?.message}>
          <Input id="invoice-new-customer-phone" aria-label="Teléfono" {...registerCustomer("phone")} />
        </AccessibleField>
        <div className="flex justify-end gap-2 md:col-span-2">
          <Button type="button" variant="outline" onClick={() => setCustomerCreateDialogOpen(false)}>Cancelar</Button>
          <Button data-testid="invoice-new-customer-submit" disabled={isCreatingCustomer} type="submit">{isCreatingCustomer ? "Creando..." : "Crear cliente y usar"}</Button>
        </div>
      </form>
    </Dialog>
    </>
  );
}
