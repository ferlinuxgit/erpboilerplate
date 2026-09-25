"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import {
  DocumentLinesEditor,
  createDocumentLine,
  documentLinesPayload,
  documentLinesTotals,
  standardRetentionRates,
  validateDocumentLines,
  type DocumentLineDraft,
  type DocumentLineErrors,
} from "@/components/invoices/document-lines-editor";
import { InvoiceTotalsSummary } from "@/components/invoices/invoice-form-controls";
import { buttonVariants } from "@/components/ui/button";
import { AccessibleField, FormActions, FormErrorMessage, RequiredFieldsNote, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatPercent, parseDecimalInput } from "@/lib/format";
import { addDaysToDateInput, todayDateInput } from "@/server/invoices/due-dates";

export type SalesCustomerOption = { id: string; number?: string | null; name: string; defaultRetentionRate?: number | null };

export type SalesDocumentLineValues = {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  discountPct?: string | null;
  retentionRate?: string | null;
};

export type SalesDocumentFormValues = {
  customerId: string;
  number: string;
  issueDate: string;
  validUntil?: string;
  lines: SalesDocumentLineValues[];
};

type SalesDocumentKind = "quote" | "order";

const copy = {
  quote: {
    idPrefix: "quote",
    endpoint: "/api/sales-quotes",
    linesTitle: "Líneas del presupuesto",
    submit: "Crear presupuesto",
    created: "Presupuesto creado.",
    updated: "Presupuesto actualizado.",
    createError: "No se pudo crear el presupuesto.",
    updateError: "No se pudo guardar el presupuesto.",
  },
  order: {
    idPrefix: "sales-order",
    endpoint: "/api/sales-orders",
    linesTitle: "Líneas del pedido",
    submit: "Crear pedido",
    created: "Pedido de venta creado.",
    updated: "Pedido de venta actualizado.",
    createError: "No se pudo crear el pedido de venta.",
    updateError: "No se pudo guardar el pedido de venta.",
  },
} satisfies Record<SalesDocumentKind, Record<string, string>>;

/** Hoy (o dentro de N días) en la zona horaria del usuario (Europe/Madrid), nunca en UTC. */
function todayInputValue(offsetDays = 0) {
  return addDaysToDateInput(todayDateInput(), offsetDays);
}

type HeaderErrors = Partial<Record<"customerId" | "issueDate" | "validUntil", string>>;

/**
 * One document editor for sales quotes and orders: same header fields, the
 * shared line editor (discount, IVA, IRPF) and live totals as invoices.
 */
export function SalesDocumentForm({
  currencyCode = "EUR",
  customers,
  defaultTaxRate = 21,
  documentId,
  initialCustomerId,
  initialValues,
  kind,
}: {
  currencyCode?: string;
  customers: SalesCustomerOption[];
  defaultTaxRate?: number;
  documentId?: string;
  initialCustomerId?: string;
  initialValues?: SalesDocumentFormValues;
  kind: SalesDocumentKind;
}) {
  const router = useRouter();
  const text = copy[kind];
  const idPrefix = text.idPrefix;
  const isEdit = Boolean(documentId);
  const requestedCustomer = initialValues?.customerId ?? initialCustomerId;
  const [customerId, setCustomerId] = useState(
    customers.some((customer) => customer.id === requestedCustomer) ? (requestedCustomer ?? "") : customers.length === 1 ? customers[0].id : "",
  );
  const [number, setNumber] = useState(initialValues?.number ?? "");
  const [issueDate, setIssueDate] = useState(initialValues?.issueDate ?? todayInputValue());
  const [validUntil, setValidUntil] = useState(initialValues?.validUntil ?? (kind === "quote" ? todayInputValue(30) : ""));
  const customerRetention = (id: string) => Number(customers.find((customer) => customer.id === id)?.defaultRetentionRate ?? 0) || 0;
  const initialRetention = initialValues
    ? parseDecimalInput(initialValues.lines.find((line) => line.retentionRate)?.retentionRate ?? null) ?? 0
    : customerRetention(customerId);
  const [retentionRate, setRetentionRate] = useState(initialRetention);
  const [retentionTouched, setRetentionTouched] = useState(Boolean(initialValues));
  const [lines, setLines] = useState<DocumentLineDraft[]>(() =>
    initialValues?.lines.length
      ? initialValues.lines.map((line) =>
          createDocumentLine({
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            taxRate: line.taxRate,
            discountPct: parseDecimalInput(line.discountPct ?? null) ? String(line.discountPct) : "",
          }),
        )
      : [createDocumentLine({ taxRate: String(defaultTaxRate) })],
  );
  const [headerErrors, setHeaderErrors] = useState<HeaderErrors>({});
  const [lineErrors, setLineErrors] = useState<DocumentLineErrors[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const totals = documentLinesTotals(lines, { retentionRate, withTax: true });
  const retentionOptions = Array.from(new Set([...standardRetentionRates, retentionRate])).sort((left, right) => left - right);

  if (customers.length === 0) {
    return (
      <EmptyState
        action={<Link className={buttonVariants()} href="/customers/new">Crear cliente</Link>}
        description="Para preparar un documento de venta necesitas al menos un cliente activo."
        title="Todavía no hay clientes"
      />
    );
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextHeaderErrors: HeaderErrors = {};
    if (!customerId) nextHeaderErrors.customerId = "Elige el cliente del documento.";
    if (!issueDate) nextHeaderErrors.issueDate = "Indica la fecha de emisión.";
    if (kind === "quote" && validUntil && issueDate && validUntil < issueDate) nextHeaderErrors.validUntil = "La validez no puede ser anterior a la fecha de emisión.";
    const lineValidation = validateDocumentLines(lines, { withTax: true });
    setHeaderErrors(nextHeaderErrors);
    setLineErrors(lineValidation.errors);
    if (Object.keys(nextHeaderErrors).length > 0 || !lineValidation.isValid) {
      setFormError("Revisa los campos marcados antes de guardar.");
      const firstHeaderError = (["customerId", "issueDate", "validUntil"] as const).find((field) => nextHeaderErrors[field]);
      const firstLineIndex = lineValidation.errors.findIndex((errors) => Object.keys(errors).length > 0);
      const lineField = firstLineIndex >= 0 ? (["description", "quantity", "unitPrice", "discountPct", "taxRate"] as const).find((field) => lineValidation.errors[firstLineIndex][field]) : undefined;
      const lineFieldId = { description: "description", quantity: "quantity", unitPrice: "unit-price", discountPct: "discount", taxRate: "tax-rate" } as const;
      const targetId = firstHeaderError
        ? `${idPrefix}-${firstHeaderError === "customerId" ? "customer" : firstHeaderError === "issueDate" ? "issue-date" : "valid-until"}`
        : lineField
          ? `${idPrefix}-line-${firstLineIndex + 1}-${lineFieldId[lineField]}`
          : null;
      if (targetId) requestAnimationFrame(() => document.getElementById(targetId)?.focus());
      return;
    }

    setFormError(null);
    setPending(true);
    const fallback = isEdit ? text.updateError : text.createError;
    try {
      const response = await fetch(documentId ? `${text.endpoint}/${documentId}` : text.endpoint, {
        method: documentId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          customerId,
          number,
          issueDate,
          ...(kind === "quote" ? { validUntil } : {}),
          lines: documentLinesPayload(lines, { retentionRate, withDiscount: true, withTax: true }),
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, fallback));
      const payload = (await response.json().catch(() => null)) as { id?: string } | null;
      toast.success(isEdit ? text.updated : text.created);
      // Tras crear o guardar se abre el documento para seguir con él (enviarlo, convertirlo…).
      const targetId = documentId ?? payload?.id;
      const basePath = kind === "quote" ? "/sales/quotes" : "/sales/orders";
      router.push(targetId ? `${basePath}/${targetId}` : basePath);
      router.refresh();
    } catch (error) {
      const message = errorMessage(error, fallback);
      setFormError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="space-y-3" data-testid={`${idPrefix}-form`} noValidate onSubmit={submit}>
      <RequiredFieldsNote />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <AccessibleField className="md:col-span-2" error={headerErrors.customerId} id={`${idPrefix}-customer`} label="Cliente" required>
          <Select
            autoFocus={!isEdit}
            onChange={(event) => {
              setCustomerId(event.target.value);
              // La retención habitual del cliente se aplica mientras no se cambie a mano.
              if (!retentionTouched) setRetentionRate(customerRetention(event.target.value));
            }}
            required
            value={customerId}
          >
            <option value="">Selecciona un cliente…</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.number ? `${customer.number} · ` : ""}{customer.name}
              </option>
            ))}
          </Select>
        </AccessibleField>
        {kind === "quote" ? (
          <AccessibleField helperText="Déjalo vacío para usar la numeración automática." id={`${idPrefix}-number`} label="Número">
            <Input autoComplete="off" onChange={(event) => setNumber(event.target.value)} placeholder="Automático" value={number} />
          </AccessibleField>
        ) : null}
        <AccessibleField helperText="Si el cliente es una empresa y tú eres profesional, normalmente 15 %. Se aplica a todas las líneas." id={`${idPrefix}-retention`} label="Retención IRPF">
          <Select onChange={(event) => { setRetentionTouched(true); setRetentionRate(Number(event.target.value)); }} value={String(retentionRate)}>
            {retentionOptions.map((rate) => (
              <option key={rate} value={String(rate)}>{rate === 0 ? "Sin retención" : formatPercent(rate)}</option>
            ))}
          </Select>
        </AccessibleField>
        <AccessibleField error={headerErrors.issueDate} id={`${idPrefix}-issue-date`} label={kind === "quote" ? "Fecha de emisión" : "Fecha"} required>
          <Input onChange={(event) => setIssueDate(event.target.value)} required type="date" value={issueDate} />
        </AccessibleField>
        {kind === "quote" ? (
          <AccessibleField error={headerErrors.validUntil} helperText="Por defecto, 30 días." id={`${idPrefix}-valid-until`} label="Válido hasta">
            <Input min={issueDate || undefined} onChange={(event) => setValidUntil(event.target.value)} type="date" value={validUntil} />
          </AccessibleField>
        ) : null}
      </div>

      <DocumentLinesEditor
        currencyCode={currencyCode}
        defaultTaxRate={defaultTaxRate}
        errors={lineErrors}
        idPrefix={`${idPrefix}-line`}
        lines={lines}
        onChange={(next) => {
          setLines(next);
          if (lineErrors.length) setLineErrors([]);
        }}
        retentionRate={retentionRate}
        title={text.linesTitle}
        withDiscount
      />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.42fr)]">
        <p className="self-end text-xs text-muted-foreground">
          Los importes se recalculan en el servidor al guardar con las mismas reglas que las facturas.
        </p>
        <InvoiceTotalsSummary currencyCode={currencyCode} testIdPrefix={idPrefix} totals={totals} />
      </div>

      <FormErrorMessage id={`${idPrefix}-form-error`}>{formError}</FormErrorMessage>
      <FormActions sticky>
        <SubmitButton aria-keyshortcuts="Control+Enter Meta+Enter" className="min-w-36" data-testid={`${idPrefix}-submit`} pending={pending}>
          {isEdit ? "Guardar cambios" : text.submit}
        </SubmitButton>
      </FormActions>
    </form>
  );
}
