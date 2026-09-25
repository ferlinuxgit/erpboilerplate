"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import {
  DocumentLinesEditor,
  createDocumentLine,
  documentLinesPayload,
  standardRetentionRates,
  validateDocumentLines,
  type DocumentLineDraft,
  type DocumentLineErrors,
} from "@/components/invoices/document-lines-editor";
import { IssueModeFields } from "@/components/recurring/issue-mode-fields";
import {
  ScheduleFields,
  previewDates,
  schedulePayload,
  validateScheduleDraft,
  type ScheduleDraft,
  type ScheduleErrors,
} from "@/components/recurring/schedule-fields";
import { AccessibleField, FormActions, FormErrorMessage, RequiredFieldsNote, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PageSection } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";
import { TEMPLATE_VARIABLES, formatScheduleDate, isDateInput, renderPeriodText } from "@/server/recurring/schedule";

export type RecurringInvoiceFormValues = {
  name: string;
  customerId: string;
  lines: Array<{ itemId?: string | null; description: string; quantity: number; unitPrice: number; discountPct?: number; taxRate: number; retentionRate: number }>;
  notes: string;
  issueMode: "DRAFT" | "ISSUE" | "ISSUE_AND_EMAIL";
  schedule: ScheduleDraft;
  sourceInvoiceId?: string | null;
};

type RecurringInvoiceFormProps = {
  customers: Array<{ id: string; name: string; hasEmail: boolean }>;
  initial: RecurringInvoiceFormValues;
  templateId?: string;
  generated?: { lastPeriod: string | null; count: number };
  wasAutomatic?: boolean;
};

function decimal(value: number) {
  return String(value).replace(".", ",");
}

function toDrafts(lines: RecurringInvoiceFormValues["lines"]): DocumentLineDraft[] {
  if (lines.length === 0) return [createDocumentLine({ taxRate: "21" })];
  return lines.map((line) => createDocumentLine({
    itemId: line.itemId ?? undefined,
    description: line.description,
    quantity: decimal(line.quantity),
    unitPrice: decimal(line.unitPrice),
    discountPct: line.discountPct ? decimal(line.discountPct) : undefined,
    taxRate: decimal(line.taxRate),
  }));
}

const EVERY_LABEL: Record<string, string> = { MONTHLY: "cada mes", QUARTERLY: "cada trimestre", YEARLY: "cada año", EVERY_N_MONTHS: "periódicamente" };

/** Alta y edición de una factura recurrente. */
export function RecurringInvoiceForm({ customers, generated, initial, templateId, wasAutomatic = false }: RecurringInvoiceFormProps) {
  const router = useRouter();
  const idBase = useId();
  const id = (suffix: string) => `${idBase}-${suffix}`;
  const [name, setName] = useState(initial.name);
  const [customerId, setCustomerId] = useState(initial.customerId);
  const [lines, setLines] = useState<DocumentLineDraft[]>(() => toDrafts(initial.lines));
  const [retentionRate, setRetentionRate] = useState(initial.lines[0]?.retentionRate ?? 0);
  const [notes, setNotes] = useState(initial.notes);
  const [issueMode, setIssueMode] = useState(initial.issueMode);
  const [confirmed, setConfirmed] = useState(wasAutomatic);
  const [schedule, setSchedule] = useState(initial.schedule);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [scheduleErrors, setScheduleErrors] = useState<ScheduleErrors>({});
  const [lineErrors, setLineErrors] = useState<DocumentLineErrors[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedCustomer = customers.find((customer) => customer.id === customerId) ?? null;
  const dates = previewDates(schedule, generated ?? { lastPeriod: null, count: 0 });
  const every = schedule.frequency === "EVERY_N_MONTHS" ? `cada ${schedule.everyMonths} meses` : EVERY_LABEL[schedule.frequency];
  const automaticWarning = issueMode === "ISSUE"
    ? `Se emitirán facturas automáticamente ${every}: tendrán número definitivo y se contabilizarán sin que las revises.`
    : issueMode === "ISSUE_AND_EMAIL"
      ? `Se emitirán facturas automáticamente ${every} y se enviarán por email a ${selectedCustomer?.name ?? "el cliente"} sin que las revises.`
      : null;
  const exampleDate = dates[0] ?? schedule.startDate;
  const exampleLine = lines.find((line) => /\{[^}]+\}/.test(line.description));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const nextErrors: Record<string, string> = {};
    if (!name.trim()) nextErrors.name = "Ponle un nombre para reconocerla.";
    if (!customerId) nextErrors.customerId = "Elige el cliente.";
    if (automaticWarning && !confirmed) nextErrors.confirm = "Marca la casilla para confirmar la emisión automática.";
    if (issueMode === "ISSUE_AND_EMAIL" && selectedCustomer && !selectedCustomer.hasEmail) {
      nextErrors.customerId = "Este cliente no tiene email de facturación: añádelo en su ficha para poder enviarle las facturas.";
    }
    const lineValidation = validateDocumentLines(lines, { withTax: true });
    const nextScheduleErrors = validateScheduleDraft(schedule);
    setErrors(nextErrors);
    setLineErrors(lineValidation.errors);
    setScheduleErrors(nextScheduleErrors);
    if (Object.keys(nextErrors).length > 0 || !lineValidation.isValid || Object.keys(nextScheduleErrors).length > 0) {
      setFormError("Revisa los campos marcados.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(templateId ? `/api/recurring/${templateId}` : "/api/recurring", {
        method: templateId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          kind: "SALES_INVOICE",
          name,
          customerId,
          ...schedulePayload(schedule),
          issueMode,
          confirmAutomatic: Boolean(automaticWarning && confirmed),
          lines: documentLinesPayload(lines, { withTax: true, withDiscount: true, withItem: true, retentionRate }),
          notes,
          sourceInvoiceId: initial.sourceInvoiceId ?? null,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar la recurrencia."));
      const saved = (await response.json()) as { id: string };
      toast.success(templateId ? "Recurrencia actualizada." : "Factura recurrente creada.");
      router.push(`/invoices/recurring/${saved.id}`);
      router.refresh();
    } catch (saveError) {
      setFormError(errorMessage(saveError, "No se pudo guardar la recurrencia."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-4" noValidate onSubmit={handleSubmit}>
      <RequiredFieldsNote />
      <PageSection title="Datos">
        <div className="grid gap-3 sm:grid-cols-2">
          <AccessibleField error={errors.name} helperText="Solo para ti, p. ej. «Mantenimiento web mensual»." id={id("name")} label="Nombre" required>
            <Input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          </AccessibleField>
          <AccessibleField error={errors.customerId} id={id("customer")} label="Cliente" required>
            <Select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              <option value="">Elige un cliente…</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
            </Select>
          </AccessibleField>
        </div>
      </PageSection>

      <DocumentLinesEditor
        description={`Puedes escribir ${TEMPLATE_VARIABLES.map((variable) => `${variable.token} (${variable.help})`).join(", ")} en el concepto: se rellenan en cada factura.`}
        errors={lineErrors}
        idPrefix="recurring-line"
        lines={lines}
        onChange={setLines}
        retentionRate={retentionRate}
        title="Líneas"
        withDiscount
        withTax
      />
      {exampleLine && isDateInput(exampleDate) ? (
        <p className="text-xs text-muted-foreground" data-testid="recurring-variable-example">
          Ejemplo para la factura del {formatScheduleDate(exampleDate)}: «{renderPeriodText(exampleLine.description, exampleDate)}»
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <AccessibleField helperText="Se aplica a todas las líneas (profesionales: normalmente 15 % o 7 % los primeros años)." id={id("retention")} label="Retención IRPF">
          <Select value={String(retentionRate)} onChange={(event) => setRetentionRate(Number(event.target.value))}>
            {standardRetentionRates.map((rate) => <option key={rate} value={rate}>{rate === 0 ? "Sin retención" : `${rate} %`}</option>)}
          </Select>
        </AccessibleField>
        <AccessibleField helperText="Aparecen en cada factura. También admiten variables." id={id("notes")} label="Notas (opcional)">
          <Textarea maxLength={2000} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </AccessibleField>
      </div>

      <PageSection title="Cuándo" description="Se genera una factura en cada fecha, con fecha de emisión ese día y el vencimiento habitual del cliente.">
        <ScheduleFields draft={schedule} errors={scheduleErrors} generated={generated} noun="factura" onChange={setSchedule} />
      </PageSection>

      <PageSection title="Qué hacer">
        <IssueModeFields
          automaticWarning={automaticWarning}
          confirmError={errors.confirm}
          confirmed={confirmed}
          nextDate={dates[0] ?? null}
          onChange={(value) => {
            setIssueMode(value === "ISSUE" || value === "ISSUE_AND_EMAIL" ? value : "DRAFT");
            setConfirmed(false);
          }}
          onConfirmedChange={setConfirmed}
          options={[
            { value: "DRAFT", label: "Crear un borrador para revisarlo", description: "Recomendado. Te aparecerá en Facturas como borrador; lo revisas y lo emites tú." },
            { value: "ISSUE", label: "Emitir automáticamente", description: "La factura se emite con número definitivo en su fecha. Si algo impide emitirla, queda en borrador y te avisamos aquí." },
            { value: "ISSUE_AND_EMAIL", label: "Emitir y enviar por email", description: "Además se envía en PDF al email de facturación del cliente con tu plantilla." },
          ]}
          value={issueMode}
        />
      </PageSection>

      <FormErrorMessage>{formError}</FormErrorMessage>
      <FormActions>
        <SubmitButton pending={saving}>{templateId ? "Guardar cambios" : "Crear factura recurrente"}</SubmitButton>
      </FormActions>
    </form>
  );
}
