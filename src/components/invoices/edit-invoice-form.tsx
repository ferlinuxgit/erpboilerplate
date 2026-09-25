"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { customerLineTaxIds, type CustomerOption } from "@/components/create-invoice-form";
import { DueDateHint } from "@/components/invoices/due-date-hint";
import { IssueConfirmDialog } from "@/components/invoices/invoice-lifecycle-actions";
import {
  discountRegisterOptions,
  InvoiceLinesEditor,
  InvoicePaymentMethodsField,
  InvoiceTotalsSummary,
  type InvoicePaymentMethodOption,
  type InvoiceTaxOption,
} from "@/components/invoices/invoice-form-controls";
import { Input } from "@/components/ui/input";
import { decimalRegisterOptions, moneyRegisterOptions } from "@/components/ui/number-input";
import { Dialog } from "@/components/ui/dialog";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { InvoiceVatTreatmentField } from "@/components/invoices/invoice-vat-treatment-field";
import { InlineAlert } from "@/components/ui/page";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate, formatMoney } from "@/lib/format";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { defaultDueDateInput, effectivePaymentTermsDays } from "@/server/invoices/due-dates";
import { customerDefaultVatTreatment, type SalesVatTreatmentCode } from "@/server/invoices/lifecycle";
import { draftInvoiceFormSchema } from "@/server/invoices/schemas";
import { createCustomerSchema } from "@/server/schemas/forms";

type UpdateInvoicePayload = z.infer<typeof draftInvoiceFormSchema>;
type CreateCustomerPayload = z.infer<typeof createCustomerSchema>;

type EditableInvoiceLine = UpdateInvoicePayload["lines"][number];

function firstFormErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  if ("message" in error && typeof error.message === "string") return error.message;
  for (const value of Object.values(error)) {
    const message = firstFormErrorMessage(value);
    if (message) return message;
  }
  return null;
}

export function EditInvoiceForm({
  canCreateCustomer,
  companyPaymentTermsDays,
  customers,
  defaultCustomerId,
  defaultDueDate,
  defaultLines,
  defaultIssueDate,
  defaultNotes,
  defaultPaymentMethodIds,
  defaultTotalAmount,
  defaultVatTreatment,
  id,
  invoiceNumber,
  paymentMethods,
  taxes,
}: {
  id: string;
  invoiceNumber: string;
  canCreateCustomer: boolean;
  companyPaymentTermsDays?: number | null;
  customers: CustomerOption[];
  defaultCustomerId: string;
  defaultDueDate: string;
  defaultLines: EditableInvoiceLine[];
  defaultIssueDate: string;
  defaultNotes: string | null;
  defaultPaymentMethodIds: string[];
  defaultTotalAmount: number;
  defaultVatTreatment: SalesVatTreatmentCode | null;
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
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [customerSubmitError, setCustomerSubmitError] = useState<string | null>(null);
  // Un tratamiento guardado distinto del que corresponde al país del cliente se considera elegido a mano.
  const [vatTreatmentTouched, setVatTreatmentTouched] = useState(
    Boolean(defaultVatTreatment) && defaultVatTreatment !== customerDefaultVatTreatment(customers.find((customer) => customer.id === defaultCustomerId)),
  );
  // Un vencimiento ya guardado se respeta; si está vacío se propone al cambiar fecha o cliente.
  const [dueDateTouched, setDueDateTouched] = useState(Boolean(defaultDueDate));
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [pendingIssueValues, setPendingIssueValues] = useState<UpdateInvoicePayload | null>(null);
  const activeTaxes = useMemo(() => taxes.filter((configuredTax) => configuredTax.isActive), [taxes]);
  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<UpdateInvoicePayload>({
    resolver: zodResolver(draftInvoiceFormSchema),
    defaultValues: {
      customerId: defaultCustomerId,
      vatTreatment: defaultVatTreatment ?? customerDefaultVatTreatment(customers.find((customer) => customer.id === defaultCustomerId)),
      issueDate: defaultIssueDate,
      dueDate: defaultDueDate,
      notes: defaultNotes ?? "",
      paymentMethodIds: defaultPaymentMethodIds,
      totalAmount: defaultTotalAmount,
      lines: defaultLines.length > 0
        ? defaultLines
        : [{ description: "", quantity: 1, unitPrice: 0, discountPct: 0, taxRate: 0, retentionRate: 0, taxIds: customerLineTaxIds(activeTaxes, customers.find((customer) => customer.id === defaultCustomerId)) }],
    },
  });
  const { fields, append, insert, move, remove } = useFieldArray({ control, name: "lines" });
  const watchedLines = useWatch({ control, name: "lines" });
  const selectedPaymentMethodIds = useWatch({ control, name: "paymentMethodIds" }) ?? [];
  const selectedCustomerId = useWatch({ control, name: "customerId" });
  const selectedVatTreatment = useWatch({ control, name: "vatTreatment" });
  const watchedIssueDate = useWatch({ control, name: "issueDate" });
  const watchedDueDate = useWatch({ control, name: "dueDate" });
  const calculatedLines = (watchedLines ?? []).map((line) => ({
    ...line,
    taxes: taxes.filter((configuredTax) => line?.taxIds?.includes(configuredTax.id)),
  }));
  const totals = calculateInvoiceTotals(calculatedLines);
  const paymentMethodError = firstFormErrorMessage(errors.paymentMethodIds);
  const selectedCustomer = customerOptions.find((customer) => customer.id === selectedCustomerId) ?? null;
  const defaultTaxIds = useMemo(() => customerLineTaxIds(activeTaxes, selectedCustomer), [activeTaxes, selectedCustomer]);
  const termsDays = effectivePaymentTermsDays(selectedCustomer?.paymentTermsDays, companyPaymentTermsDays);
  const termsSource = typeof selectedCustomer?.paymentTermsDays === "number" ? "customer" : "company";
  const emptyLine: EditableInvoiceLine = { description: "", quantity: 1, unitPrice: 0, discountPct: 0, taxRate: 0, retentionRate: 0, taxIds: [...defaultTaxIds] };
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

  const hasChargedVat = totals.taxBuckets.some(
    (bucket) => bucket.operation === "ADD" && bucket.rate > 0 && ["VAT", "SURCHARGE"].includes((bucket.kind ?? "").toUpperCase()),
  );

  useEffect(() => {
    setValue("totalAmount", totals.totalAmount, { shouldValidate: true });
  }, [setValue, totals.totalAmount]);

  // Mientras el usuario no fije el tratamiento de IVA, sigue al cliente (habitual o por país).
  useEffect(() => {
    if (vatTreatmentTouched || !selectedCustomer) return;
    setValue("vatTreatment", customerDefaultVatTreatment(selectedCustomer));
  }, [selectedCustomer, setValue, vatTreatmentTouched]);

  const proposeDueDate = (issueDate: string | undefined, days: number) => {
    if (dueDateTouched || !issueDate) return;
    setValue("dueDate", defaultDueDateInput(issueDate, days), { shouldDirty: true });
  };

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

  const duplicateLineAndFocus = (index: number) => {
    const source = watchedLines?.[index];
    if (!source) return;
    insert(index + 1, { ...source, taxIds: [...(source.taxIds ?? [])] });
    setPendingFocusLineIndex(index + 1);
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
    setCustomerSubmitError(null);
    try {
      const response = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, "No se pudo crear el cliente."));
      }
      const createdCustomer = (await response.json()) as CustomerOption;
      setCustomerOptions((current) => current.some((customer) => customer.id === createdCustomer.id) ? current : [...current, createdCustomer]);
      setValue("customerId", createdCustomer.id, { shouldDirty: true, shouldValidate: true });
      resetCustomer();
      setCustomerCreateDialogOpen(false);
      toast.success("Cliente creado y seleccionado.");
      router.refresh();
    } catch (error) {
      const message = errorMessage(error, "No se pudo crear el cliente. Inténtalo de nuevo.");
      setCustomerSubmitError(message);
      toast.error(message);
    }
  });

  const saveDraft = async (values: UpdateInvoicePayload, issue: boolean) => {
      setSubmissionError(null);
      setIssueError(null);
      try {
        const invoiceTotals = calculateInvoiceTotals(values.lines.map((line) => ({
          ...line,
          taxes: taxes.filter((configuredTax) => line.taxIds?.includes(configuredTax.id)),
        })));
        const response = await fetch(`/api/invoices/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getCsrfHeader() },
          body: JSON.stringify({ ...values, totalAmount: invoiceTotals.totalAmount, ...(issue ? { issue: true } : {}) }),
        });

        if (!response.ok) {
          throw new Error(await readApiError(response, issue ? "No se pudo emitir la factura." : "No se pudo actualizar la factura."));
        }

        const saved = (await response.json().catch(() => null)) as { number?: string } | null;
        setIssueDialogOpen(false);
        toast.success(issue ? `Factura ${saved?.number ?? ""} emitida correctamente.` : "Borrador guardado. Puedes emitirlo desde aquí o desde la ficha cuando esté listo.");
        router.push(`/invoices/${id}`);
        router.refresh();
      } catch (error) {
        const message = errorMessage(error, "No se pudo actualizar la factura. Inténtalo de nuevo.");
        setSubmissionError(message);
        if (issue) setIssueError(message);
        toast.error(message);
      }
  };

  const onInvalid = (validationErrors: Parameters<Parameters<typeof handleSubmit>[1] & object>[0]) => {
    const detail = firstFormErrorMessage(validationErrors);
    const summary = validationErrors.lines
      ? "Revisa las líneas de la factura: hay datos incompletos o no válidos."
      : "Revisa los campos indicados antes de guardar la factura.";
    const message = detail ? `${summary} ${detail}` : summary;
    setSubmissionError(message);
    toast.error(message);
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('[data-testid="invoice-edit-form"] [aria-invalid="true"]:not([type="hidden"])')
        ?.focus();
    });
  };

  /** Enter / Ctrl+Enter / "Guardar borrador": solo guarda. Nunca emite. */
  const onSubmit = handleSubmit((values) => saveDraft(values, false), onInvalid);
  /** "Guardar y emitir": valida y pide confirmación (acción irreversible). */
  const onRequestIssue = handleSubmit((values) => {
    setPendingIssueValues(values);
    setIssueError(null);
    setIssueDialogOpen(true);
  }, onInvalid);
  const confirmIssue = async () => {
    if (!pendingIssueValues) return;
    setIssuing(true);
    try {
      await saveDraft(pendingIssueValues, true);
    } finally {
      setIssuing(false);
    }
  };

  return (
    <>
    <form
      className="grid gap-4 md:grid-cols-3"
      data-testid="invoice-edit-form"
      noValidate
      onKeyDown={handleInvoiceKeyDown}
      onSubmit={onSubmit}
    >
      {submissionError ? (
        <InlineAlert className="md:col-span-3" data-testid="invoice-edit-error" title="No se han guardado los cambios" tone="danger">
          {submissionError}
        </InlineAlert>
      ) : null}
      <input type="hidden" {...register("totalAmount", { valueAsNumber: true })} />
      <input type="hidden" {...register("customerId")} />
      <section className="space-y-3 rounded-[2px] border border-window-dark-shadow bg-window-panel p-3 md:col-span-3" aria-labelledby="invoice-customer-title">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 id="invoice-customer-title" className="font-mono text-xs font-bold uppercase tracking-wide">Cliente</h3>
            <p className="text-xs text-muted-foreground">Es un borrador: puedes cambiar cualquier dato hasta emitirlo.</p>
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
          <div className="rounded-[2px] border border-window-dark-shadow bg-window-surface p-3" data-slot="selected-customer">
            <p className="font-mono text-sm font-bold">{selectedCustomer.number ? `${selectedCustomer.number} · ` : ""}{selectedCustomer.name}</p>
            <p className="text-xs text-muted-foreground">
              {[selectedCustomer.taxId, selectedCustomer.city, selectedCustomer.province, selectedCustomer.email].filter(Boolean).join(" · ") || "Cliente activo"}
            </p>
          </div>
        ) : (
          <p className="rounded-[2px] border border-dashed border-window-shadow bg-window-surface p-3 text-xs text-muted-foreground">Selecciona un cliente activo.</p>
        )}
        {errors.customerId ? <p className="font-mono text-xs text-destructive" role="alert">{errors.customerId.message}</p> : null}
      </section>
      <div className="space-y-2 rounded-[2px] border border-window-dark-shadow bg-window-panel p-3">
        <p className="font-mono text-xs font-bold">Número provisional</p>
        <p className="font-mono text-sm tabular-nums" data-testid="invoice-number-preview">{invoiceNumber}</p>
        <p className="text-xs text-muted-foreground">El número definitivo se asigna al emitir.</p>
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
          {...register("issueDate", { onChange: (event: { target: { value: string } }) => proposeDueDate(event.target.value, termsDays) })}
        />
      </AccessibleField>
      <AccessibleField
        id="invoice-due-date"
        label="Fecha vencimiento"
        error={errors.dueDate?.message}
        helperText={<DueDateHint dueDate={watchedDueDate} termsDays={termsDays} termsSource={termsSource} />}
      >
        <Input
          data-testid="invoice-edit-due-date-input"
          id="invoice-due-date"
          min={watchedIssueDate || undefined}
          type="date"
          aria-label="Fecha de vencimiento"
          aria-invalid={Boolean(errors.dueDate)}
          {...register("dueDate", { onChange: () => setDueDateTouched(true) })}
        />
      </AccessibleField>
      <div className="md:col-span-3">
        <InvoiceLinesEditor
          errors={fields.map((_, index) => {
            const lineError = errors.lines?.[index];
            return {
              description: lineError?.description?.message,
              quantity: lineError?.quantity?.message,
              unitPrice: lineError?.unitPrice?.message,
              discountPct: lineError?.discountPct?.message,
              taxIds: lineError?.taxIds?.message,
            };
          })}
          fields={fields}
          getBindings={(index) => ({
            description: register(`lines.${index}.description`),
            quantity: register(`lines.${index}.quantity`, decimalRegisterOptions),
            unitPrice: register(`lines.${index}.unitPrice`, moneyRegisterOptions),
            discountPct: register(`lines.${index}.discountPct`, discountRegisterOptions),
            taxIds: () => register(`lines.${index}.taxIds`),
          })}
          lines={watchedLines ?? []}
          onAdd={addLineAndFocus}
          onDuplicate={duplicateLineAndFocus}
          onMove={move}
          onRemove={removeLineAndFocus}
          taxes={taxes}
          totals={totals}
        />
        {errors.lines?.root ? <p className="mt-2 font-mono text-xs text-destructive" role="alert">{errors.lines.root.message}</p> : null}
      </div>

      <div className="grid gap-3 md:col-span-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.42fr)]">
        <div className="grid content-start gap-3 rounded-[2px] border border-window-dark-shadow bg-card p-3 sm:grid-cols-2">
          <InvoicePaymentMethodsField
            error={paymentMethodError ?? undefined}
            getBinding={() => register("paymentMethodIds")}
            methods={paymentMethods}
            selectedIds={selectedPaymentMethodIds}
          />
          <InvoiceVatTreatmentField
            binding={register("vatTreatment", { onChange: () => setVatTreatmentTouched(true) })}
            error={errors.vatTreatment?.message}
            hasChargedVat={hasChargedVat}
            value={selectedVatTreatment}
          />
          <AccessibleField id="invoice-notes" label="Notas" error={errors.notes?.message} helperText="Opcional; se mostrarán como observaciones internas.">
            <Input id="invoice-notes" placeholder="Observaciones" aria-label="Notas de factura" {...register("notes")} />
          </AccessibleField>
        </div>
        <InvoiceTotalsSummary error={errors.totalAmount?.message} totals={totals} />
      </div>

      <div className="sticky bottom-2 z-10 flex items-center justify-between gap-3 border border-window-dark-shadow bg-window-panel p-2 shadow-[3px_3px_0_var(--window-shadow)] md:col-span-3">
        <p className="hidden text-xs text-muted-foreground sm:block">
          {submissionError ? "Corrige el error indicado y vuelve a guardar." : isDirty ? "Hay cambios pendientes · Ctrl/Cmd + Enter para guardar" : "Sin cambios pendientes"}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SubmitButton className="min-w-36" data-testid="invoice-edit-submit" aria-keyshortcuts="Control+Enter Meta+Enter" pending={isSubmitting} variant="outline">
            Guardar borrador
          </SubmitButton>
          <Button data-testid="invoice-edit-save-and-issue" disabled={isSubmitting || issuing} onClick={() => void onRequestIssue()} type="button">
            {issuing ? "Emitiendo…" : "Guardar y emitir"}
          </Button>
        </div>
      </div>
    </form>
    <IssueConfirmDialog
      error={issueError}
      onClose={() => setIssueDialogOpen(false)}
      onConfirm={() => void confirmIssue()}
      open={issueDialogOpen}
      pending={issuing}
      summary={
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Cliente</dt><dd className="font-medium">{selectedCustomer?.name ?? "—"}</dd>
          <dt className="text-muted-foreground">Total</dt><dd className="font-mono font-bold">{formatMoney(totals.totalAmount)}</dd>
          <dt className="text-muted-foreground">Vence</dt><dd>{watchedDueDate ? formatDate(`${watchedDueDate}T12:00:00`) : "Sin vencimiento"}</dd>
        </dl>
      }
    />
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
            <p className="rounded-[2px] border border-dashed border-window-shadow bg-window-surface p-3 text-xs text-muted-foreground" role="status">No hay clientes que coincidan con la búsqueda.</p>
          ) : filteredCustomers.map((customer) => (
            <button
              className="w-full rounded-[2px] border border-window-dark-shadow bg-window-surface p-3 text-left hover:bg-window-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              key={customer.id}
              type="button"
              onClick={() => {
                setValue("customerId", customer.id, { shouldDirty: true, shouldValidate: true });
                proposeDueDate(watchedIssueDate, effectivePaymentTermsDays(customer.paymentTermsDays, companyPaymentTermsDays));
                setCustomerSearchDialogOpen(false);
              }}
            >
              <span className="block font-mono text-sm font-bold">{customer.number ? `${customer.number} · ` : ""}{customer.name}</span>
              <span className="block text-xs text-muted-foreground">{[customer.taxId, customer.city, customer.province, customer.email, customer.phone].filter(Boolean).join(" · ") || "Cliente activo"}</span>
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
          <Input data-testid="invoice-new-customer-address-line-2-input" id="invoice-new-customer-address-line-2" aria-label="Dirección 2 del cliente nuevo" {...registerCustomer("addressLine2")} />
        </AccessibleField>
        <AccessibleField id="invoice-new-customer-email" label="Email" error={customerErrors.email?.message}>
          <Input data-testid="invoice-new-customer-email-input" id="invoice-new-customer-email" type="email" aria-label="Email del cliente nuevo" {...registerCustomer("email")} />
        </AccessibleField>
        <AccessibleField id="invoice-new-customer-phone" label="Teléfono" error={customerErrors.phone?.message}>
          <Input data-testid="invoice-new-customer-phone-input" id="invoice-new-customer-phone" aria-label="Teléfono del cliente nuevo" {...registerCustomer("phone")} />
        </AccessibleField>
        <FormErrorMessage className="md:col-span-2">{customerSubmitError}</FormErrorMessage>
        <div className="flex justify-end gap-2 md:col-span-2">
          <Button type="button" variant="outline" onClick={() => setCustomerCreateDialogOpen(false)}>Cancelar</Button>
          <SubmitButton data-testid="invoice-new-customer-submit" pending={isCreatingCustomer} pendingLabel="Creando…">Crear cliente y usar</SubmitButton>
        </div>
      </form>
    </Dialog>
    </>
  );
}
