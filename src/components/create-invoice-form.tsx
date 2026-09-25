"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { decimalRegisterOptions, moneyRegisterOptions } from "@/components/ui/number-input";
import { DueDateHint } from "@/components/invoices/due-date-hint";
import {
  InvoiceLinesEditor,
  InvoicePaymentMethodsField,
  InvoiceTotalsSummary,
  discountRegisterOptions,
  type InvoicePaymentMethodOption,
  type InvoiceTaxOption,
} from "@/components/invoices/invoice-form-controls";
import { IssueConfirmDialog } from "@/components/invoices/invoice-lifecycle-actions";
import { getCsrfHeader } from "@/lib/csrf-client";
import { InvoiceVatTreatmentField } from "@/components/invoices/invoice-vat-treatment-field";
import { countriesForSelect } from "@/lib/countries";
import { formatSeriesNumber } from "@/lib/document-series-format";
import { formatDate, formatMoney } from "@/lib/format";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { defaultLineTaxIds } from "@/server/invoices/default-taxes";
import { defaultDueDateInput, effectivePaymentTermsDays } from "@/server/invoices/due-dates";
import { customerDefaultVatTreatment } from "@/server/invoices/lifecycle";
import { createInvoiceSchema } from "@/server/invoices/schemas";
import { createCustomerSchema } from "@/server/schemas/forms";

export type CustomerOption = {
  id: string;
  number?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  taxId?: string | null;
  city?: string | null;
  province?: string | null;
  countryCode?: string | null;
  /** Condiciones de facturación de la ficha del cliente. */
  paymentTermsDays?: number | null;
  defaultRetentionRate?: number | null;
  defaultVatTreatment?: string | null;
  equivalenceSurcharge?: boolean | null;
};

const COUNTRY_OPTIONS = countriesForSelect();

/** Impuestos que se proponen para un cliente (IVA por defecto solo en operaciones nacionales). */
export function customerLineTaxIds(taxes: InvoiceTaxOption[], customer: CustomerOption | null | undefined) {
  return defaultLineTaxIds(taxes, customer, { withVat: customerDefaultVatTreatment(customer) === "DOMESTIC" });
}

function sameIds(left: string[] | undefined, right: string[]) {
  const a = [...(left ?? [])].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

type CreateInvoicePayload = z.infer<typeof createInvoiceSchema>;
type CreateCustomerPayload = z.infer<typeof createCustomerSchema>;
type CreatedInvoicePayload = {
  id: string;
  number: string;
  status: string;
  lifecycle?: "DRAFT" | "ISSUED" | "VOID";
  customer?: CustomerOption | null;
};

type SubmitMode = "draft" | "issue";

/** Serie de facturas seleccionable (activa en el ejercicio), con su siguiente número efectivo. */
export type InvoiceSeriesOption = {
  id: string;
  code: string;
  name: string;
  prefix: string;
  format: string;
  nextNumber: number;
  isDefault: boolean;
};

/** Número que tendría la próxima factura de la serie en esa fecha (solo orientativo: se asigna al emitir). */
export function seriesNumberPreview(series: InvoiceSeriesOption | null | undefined, issueDate: string | null | undefined) {
  if (!series) return null;
  const referenceDate = issueDate && /^\d{4}-\d{2}-\d{2}$/.test(issueDate) ? new Date(`${issueDate}T12:00:00.000Z`) : undefined;
  return formatSeriesNumber({ format: series.format, nextNumber: series.nextNumber, prefix: series.prefix, referenceDate });
}

export function CreateInvoiceForm({
  canCreateCustomer,
  companyPaymentTermsDays,
  customers,
  defaultIssueDate,
  initialCustomerId,
  invoiceSeries = [],
  paymentMethods,
  taxes,
}: {
  canCreateCustomer: boolean;
  /** Días de pago de la empresa (si el cliente no tiene los suyos). */
  companyPaymentTermsDays?: number | null;
  customers: CustomerOption[];
  defaultIssueDate: string;
  initialCustomerId?: string;
  /** Series activas de facturas del ejercicio (la de por defecto primero). */
  invoiceSeries?: InvoiceSeriesOption[];
  paymentMethods: InvoicePaymentMethodOption[];
  taxes: InvoiceTaxOption[];
}) {
  const router = useRouter();
  const [customerOptions, setCustomerOptions] = useState(customers);
  const [customerSearchDialogOpen, setCustomerSearchDialogOpen] = useState(false);
  const [customerCreateDialogOpen, setCustomerCreateDialogOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerLocationSearch, setCustomerLocationSearch] = useState("");
  const [customerTaxSearch, setCustomerTaxSearch] = useState("");
  const [pendingFocusLineIndex, setPendingFocusLineIndex] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [customerSubmitError, setCustomerSubmitError] = useState<string | null>(null);
  const [vatTreatmentTouched, setVatTreatmentTouched] = useState(false);
  const [submitMode, setSubmitMode] = useState<SubmitMode | null>(null);
  const [dueDateTouched, setDueDateTouched] = useState(false);
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [pendingIssueValues, setPendingIssueValues] = useState<CreateInvoicePayload | null>(null);
  const initialCustomer = customers.find((customer) => customer.id === initialCustomerId) ?? null;
  const termsFor = (customer: CustomerOption | null | undefined) => effectivePaymentTermsDays(customer?.paymentTermsDays, companyPaymentTermsDays);
  const defaultSeries = invoiceSeries.find((series) => series.isDefault) ?? invoiceSeries[0] ?? null;
  const defaultPaymentMethodIds = useMemo(() => paymentMethods.filter((method) => method.isDefault).map((method) => method.id), [paymentMethods]);
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
      customerId: initialCustomer ? initialCustomer.id : "",
      vatTreatment: customerDefaultVatTreatment(initialCustomer),
      issueDate: defaultIssueDate,
      // Vencimiento automático: emisión + días de pago del cliente (o de la empresa).
      dueDate: defaultDueDateInput(defaultIssueDate, termsFor(initialCustomer)),
      totalAmount: 0,
      notes: "",
      paymentMethodIds: defaultPaymentMethodIds,
      seriesId: defaultSeries?.id ?? null,
      lines: [{ description: "", quantity: 1, unitPrice: 0, discountPct: 0, taxRate: 0, retentionRate: 0, taxIds: customerLineTaxIds(taxes, initialCustomer) }],
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
  const { fields, append, insert, move, remove } = useFieldArray({ control, name: "lines" });
  const watchedLines = useWatch({ control, name: "lines" });
  const selectedPaymentMethodIds = useWatch({ control, name: "paymentMethodIds" }) ?? [];
  const selectedCustomerId = useWatch({ control, name: "customerId" });
  const selectedVatTreatment = useWatch({ control, name: "vatTreatment" });
  const watchedIssueDate = useWatch({ control, name: "issueDate" });
  const watchedDueDate = useWatch({ control, name: "dueDate" });
  const selectedSeriesId = useWatch({ control, name: "seriesId" });
  const selectedSeries = invoiceSeries.find((series) => series.id === selectedSeriesId) ?? defaultSeries;
  const nextInvoiceNumberPreview = seriesNumberPreview(selectedSeries, watchedIssueDate);
  const calculatedLines = (watchedLines ?? []).map((line) => ({
    ...line,
    taxes: taxes.filter((configuredTax) => line?.taxIds?.includes(configuredTax.id)),
  }));
  const totals = calculateInvoiceTotals(calculatedLines);
  const selectedCustomer = customerOptions.find((customer) => customer.id === selectedCustomerId) ?? null;
  const defaultTaxIds = useMemo(() => customerLineTaxIds(taxes, selectedCustomer), [selectedCustomer, taxes]);
  const previousDefaultTaxIds = useRef(defaultTaxIds);
  const termsDays = termsFor(selectedCustomer);
  const termsSource = typeof selectedCustomer?.paymentTermsDays === "number" ? "customer" : "company";
  const filteredCustomers = useMemo(() => {
    const textQuery = customerSearch.trim().toLocaleLowerCase();
    const locationQuery = customerLocationSearch.trim().toLocaleLowerCase();
    const taxQuery = customerTaxSearch.trim().toLocaleLowerCase();

    return customerOptions.filter((customer) => {
      const text = [customer.number, customer.name, customer.email, customer.phone].filter(Boolean).join(" ").toLocaleLowerCase();
      const location = [customer.city, customer.province].filter(Boolean).join(" ").toLocaleLowerCase();
      const tax = (customer.taxId ?? "").toLocaleLowerCase();
      return (!textQuery || text.includes(textQuery)) && (!locationQuery || location.includes(locationQuery)) && (!taxQuery || tax.includes(taxQuery));
    });
  }, [customerLocationSearch, customerOptions, customerSearch, customerTaxSearch]);

  const hasChargedVat = totals.taxBuckets.some(
    (bucket) => bucket.operation === "ADD" && bucket.rate > 0 && ["VAT", "SURCHARGE"].includes((bucket.kind ?? "").toUpperCase()),
  );

  useEffect(() => {
    setValue("totalAmount", totals.totalAmount, { shouldValidate: true });
  }, [setValue, totals.totalAmount]);

  // El tratamiento de IVA sigue al cliente (su tratamiento habitual o su país) mientras no se cambie a mano.
  useEffect(() => {
    if (vatTreatmentTouched || !selectedCustomer) return;
    setValue("vatTreatment", customerDefaultVatTreatment(selectedCustomer));
  }, [selectedCustomer, setValue, vatTreatmentTouched]);

  // Vencimiento = emisión + días de pago, mientras el usuario no lo fije a mano.
  useEffect(() => {
    if (dueDateTouched || !watchedIssueDate) return;
    setValue("dueDate", defaultDueDateInput(watchedIssueDate, termsDays));
  }, [dueDateTouched, setValue, termsDays, watchedIssueDate]);

  // Al cambiar de cliente, las líneas que conservan los impuestos propuestos (IVA, recargo, IRPF
  // habitual) pasan a los del nuevo cliente; las que el usuario ha tocado no se cambian.
  useEffect(() => {
    const previous = previousDefaultTaxIds.current;
    previousDefaultTaxIds.current = defaultTaxIds;
    if (sameIds(previous, defaultTaxIds)) return;
    (watchedLines ?? []).forEach((line, index) => {
      if (sameIds(line?.taxIds, previous)) setValue(`lines.${index}.taxIds`, [...defaultTaxIds]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambiar los impuestos propuestos
  }, [defaultTaxIds]);

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
    append({ description: "", quantity: 1, unitPrice: 0, discountPct: 0, taxRate: 0, retentionRate: 0, taxIds: [...defaultTaxIds] });
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

  const submitInvoice = async (values: CreateInvoicePayload, mode: SubmitMode) => {
    setSubmitError(null);
    setIssueError(null);
    setSubmitMode(mode);
    try {
      const invoiceTotals = calculateInvoiceTotals(values.lines.map((line) => ({
        ...line,
        taxes: taxes.filter((configuredTax) => line.taxIds?.includes(configuredTax.id)),
      })));
      const response = await fetch("/api/invoices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getCsrfHeader(),
        },
        body: JSON.stringify({ ...values, newCustomer: undefined, mode, totalAmount: invoiceTotals.totalAmount }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, mode === "draft" ? "No se pudo guardar el borrador." : "No se pudo emitir la factura."));
      }

      const created = (await response.json()) as CreatedInvoicePayload;
      setIssueDialogOpen(false);
      toast.success(mode === "draft"
        ? "Borrador guardado. Puedes seguir editándolo y emitirlo cuando esté listo."
        : `Factura ${created.number} emitida correctamente.`);
      router.push(`/invoices/${created.id}`);
      router.refresh();
    } catch (submissionError) {
      const message = errorMessage(submissionError, "No se pudo guardar la factura. Inténtalo de nuevo.");
      setSubmitError(message);
      if (mode === "issue") setIssueError(message);
      toast.error(message);
    } finally {
      setSubmitMode(null);
    }
  };

  /**
   * Enviar el formulario (Enter o Ctrl/Cmd + Enter) solo guarda un BORRADOR. Emitir es irreversible:
   * el botón "Emitir factura" valida y abre siempre la confirmación.
   */
  const onSubmit = handleSubmit((values) => submitInvoice(values, "draft"));
  const onRequestIssue = handleSubmit((values) => {
    setPendingIssueValues(values);
    setIssueError(null);
    setIssueDialogOpen(true);
  });
  const confirmIssue = () => {
    if (pendingIssueValues) void submitInvoice(pendingIssueValues, "issue");
  };

  const onCreateCustomer = handleCustomerSubmit(async (values) => {
    setCustomerSubmitError(null);
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
        throw new Error(await readApiError(response, "No se pudo crear el cliente."));
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
      requestAnimationFrame(() => document.getElementById("invoice-issue-date")?.focus());
    } catch (error) {
      const message = errorMessage(error, "No se pudo crear el cliente. Inténtalo de nuevo.");
      setCustomerSubmitError(message);
      toast.error(message);
    }
  });

  return (
    <>
    <form className="grid gap-4 md:grid-cols-3" data-testid="invoice-create-form" onKeyDown={handleInvoiceKeyDown} onSubmit={onSubmit}>
      <input type="hidden" {...register("totalAmount", { valueAsNumber: true })} />
      <input type="hidden" {...register("customerId")} />
      <section className="space-y-3 rounded-[2px] border border-window-dark-shadow bg-window-panel p-3 md:col-span-3" aria-labelledby="invoice-customer-title">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 id="invoice-customer-title" className="font-mono text-xs font-bold uppercase tracking-wide">
              Cliente
            </h3>
            <p className="text-xs text-muted-foreground">Selecciona el cliente desde el buscador avanzado antes de emitir la factura.</p>
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
          <p className="rounded-[2px] border border-dashed border-window-shadow bg-window-surface p-3 text-xs text-muted-foreground">
            {canCreateCustomer
              ? "Todavía no hay clientes activos. Crea uno desde el botón Crear cliente para poder emitir la factura."
              : "No hay clientes activos y tu rol no permite crear clientes desde la factura."}
          </p>
        ) : selectedCustomer ? (
          <div className="rounded-[2px] border border-window-dark-shadow bg-window-surface p-3" data-slot="selected-customer">
            <p className="font-mono text-sm font-bold">{selectedCustomer.number ? `${selectedCustomer.number} · ` : ""}{selectedCustomer.name}</p>
            <p className="text-xs text-muted-foreground">
              {[selectedCustomer.taxId, selectedCustomer.city, selectedCustomer.province, selectedCustomer.email].filter(Boolean).join(" · ") || "Cliente activo"}
            </p>
          </div>
        ) : (
          <p className="rounded-[2px] border border-dashed border-window-shadow bg-window-surface p-3 text-xs text-muted-foreground">Pulsa Buscar cliente para seleccionar uno.</p>
        )}
        {errors.customerId ? <p className="font-mono text-xs text-destructive" role="alert">{errors.customerId.message}</p> : null}
      </section>
      <div className="space-y-2 rounded-[2px] border border-window-dark-shadow bg-window-panel p-3">
        <p className="font-mono text-xs font-bold">Número automático</p>
        {invoiceSeries.length > 1 ? (
          <AccessibleField
            helperText="Usa series distintas para tickets, facturas de exportación…"
            id="invoice-series"
            label="Serie"
          >
            <Select data-testid="invoice-series-select" id="invoice-series" {...register("seriesId")}>
              {invoiceSeries.map((series) => (
                <option key={series.id} value={series.id}>
                  {series.name} ({series.code}){series.isDefault ? " · por defecto" : ""}
                </option>
              ))}
            </Select>
          </AccessibleField>
        ) : (
          <input type="hidden" {...register("seriesId")} />
        )}
        <p className="text-xs text-muted-foreground" data-testid="invoice-number-preview">
          {nextInvoiceNumberPreview
            ? `Al emitir tendrá el siguiente número de la serie${invoiceSeries.length > 1 && selectedSeries ? ` «${selectedSeries.name}»` : ""} (previsto: ${nextInvoiceNumberPreview}). Los borradores no consumen número.`
            : "Al emitir se asignará el siguiente número correlativo. Los borradores no consumen número."}
        </p>
      </div>
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
      <AccessibleField
        id="invoice-due-date"
        label="Fecha vencimiento"
        error={errors.dueDate?.message}
        helperText={<DueDateHint dueDate={watchedDueDate} termsDays={termsDays} termsSource={termsSource} />}
      >
        <Input
          data-testid="invoice-due-date-input"
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
            error={errors.paymentMethodIds?.message}
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
        </div>
        <InvoiceTotalsSummary error={errors.totalAmount?.message} totals={totals} />
      </div>

      <FormErrorMessage className="md:col-span-3">{submitError}</FormErrorMessage>
      <div className="sticky bottom-2 z-10 flex items-center justify-between gap-3 border border-window-dark-shadow bg-window-panel p-2 shadow-[3px_3px_0_var(--window-shadow)] md:col-span-3">
        <p className="hidden text-xs text-muted-foreground sm:block">
          Enter o Ctrl/Cmd + Enter guardan un borrador. «Emitir factura» te pide confirmación: al emitir se asigna el número y deja de ser editable.
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SubmitButton
            aria-keyshortcuts="Control+Enter Meta+Enter"
            data-testid="invoice-save-draft"
            pending={isSubmitting && submitMode === "draft"}
            pendingLabel="Guardando…"
            title="Ctrl/Cmd + Enter"
            variant="outline"
          >
            Guardar borrador
          </SubmitButton>
          <Button
            className="min-w-36"
            data-testid="invoice-create-submit"
            disabled={isSubmitting}
            onClick={() => void onRequestIssue()}
            type="button"
          >
            {isSubmitting && submitMode === "issue" ? "Emitiendo…" : "Emitir factura"}
          </Button>
        </div>
      </div>
    </form>
    <IssueConfirmDialog
      error={issueError}
      onClose={() => setIssueDialogOpen(false)}
      onConfirm={confirmIssue}
      open={issueDialogOpen}
      pending={isSubmitting && submitMode === "issue"}
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
            <Input
              aria-label="Número, nombre, email o teléfono"
              id="invoice-customer-search"
              value={customerSearch}
              onChange={(event) => setCustomerSearch(event.target.value)}
            />
          </AccessibleField>
          <AccessibleField id="invoice-customer-location-search" label="Ciudad o provincia">
            <Input
              aria-label="Ciudad o provincia"
              id="invoice-customer-location-search"
              value={customerLocationSearch}
              onChange={(event) => setCustomerLocationSearch(event.target.value)}
            />
          </AccessibleField>
          <AccessibleField id="invoice-customer-tax-search" label="CIF/NIF/VAT">
            <Input
              aria-label="CIF/NIF/VAT"
              id="invoice-customer-tax-search"
              value={customerTaxSearch}
              onChange={(event) => setCustomerTaxSearch(event.target.value)}
            />
          </AccessibleField>
        </div>

        <div className="max-h-80 space-y-2 overflow-y-auto">
          {filteredCustomers.length === 0 ? (
            <p className="rounded-[2px] border border-dashed border-window-shadow bg-window-surface p-3 text-xs text-muted-foreground" role="status">No hay clientes que coincidan con la búsqueda.</p>
          ) : (
            filteredCustomers.map((customer) => (
              <button
                className="w-full rounded-[2px] border border-window-dark-shadow bg-window-surface p-3 text-left hover:bg-window-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                key={customer.id}
                type="button"
                onClick={() => {
                  setValue("customerId", customer.id, { shouldDirty: true, shouldValidate: true });
                  setCustomerSearchDialogOpen(false);
                  requestAnimationFrame(() => document.getElementById("invoice-issue-date")?.focus());
                }}
              >
                <span className="block font-mono text-sm font-bold">{customer.number ? `${customer.number} · ` : ""}{customer.name}</span>
                <span className="block text-xs text-muted-foreground">
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
      description="Registra los datos fiscales mínimos sin abandonar la factura."
      initialFocusId="invoice-new-customer-name"
      open={customerCreateDialogOpen}
      onClose={() => setCustomerCreateDialogOpen(false)}
      size="xl"
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
          <Select
            data-testid="invoice-new-customer-country-input"
            id="invoice-new-customer-country"
            required
            aria-label="País del cliente nuevo"
            aria-invalid={Boolean(customerErrors.countryCode)}
            {...registerCustomer("countryCode")}
          >
            {COUNTRY_OPTIONS.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
          </Select>
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
        <FormErrorMessage className="md:col-span-2">{customerSubmitError}</FormErrorMessage>
        <div className="flex justify-end gap-2 md:col-span-2">
          <Button type="button" variant="outline" onClick={() => setCustomerCreateDialogOpen(false)}>
            Cancelar
          </Button>
          <SubmitButton data-testid="invoice-new-customer-submit" pending={isCreatingCustomer} pendingLabel="Creando…">
            Crear cliente y usar
          </SubmitButton>
        </div>
      </form>
    </Dialog>
    </>
  );
}
