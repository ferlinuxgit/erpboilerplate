"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { LinesEditor, type LinesEditorRow, type LinesExtraColumn } from "@/components/invoices/lines-editor";
import { moveItem, retentionRateLabel, retentionRateOptions } from "@/components/invoices/lines-editor-model";
import { IssueModeFields } from "@/components/recurring/issue-mode-fields";
import {
  ScheduleFields,
  previewDates,
  schedulePayload,
  validateScheduleDraft,
  type ScheduleDraft,
  type ScheduleErrors,
} from "@/components/recurring/schedule-fields";
import { SupplierPicker, type SupplierPickerOption } from "@/components/suppliers/supplier-picker";
import { AccountPicker } from "@/components/ui/account-picker";
import { AccessibleField, FormActions, FormErrorMessage, RequiredFieldsNote, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PercentInput } from "@/components/ui/number-input";
import { PageSection } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney, parseDecimalInput } from "@/lib/format";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { TEMPLATE_VARIABLES } from "@/server/recurring/schedule";

/** Línea de un gasto recurrente (p. ej. alquiler + gastos de comunidad con distinta cuenta o IVA). */
export type RecurringExpenseLineValues = {
  expenseAccountId: string;
  description: string;
  /** Base imponible de la línea (cantidad × precio). */
  amount: number | null;
  taxRate: number;
  retentionRate: number;
  taxDeductiblePct: number;
};

export type RecurringExpenseFormValues = {
  name: string;
  supplierPartnerId: string;
  lines: RecurringExpenseLineValues[];
  issueMode: "DRAFT" | "POST";
  schedule: ScheduleDraft;
};

export type RecurringExpenseSupplierDefaults = {
  defaultExpenseAccountId: string | null;
  defaultRetentionRate: number | null;
  defaultTaxDeductiblePct: number | null;
  /** Días de pago del proveedor: el vencimiento de cada gasto es la fecha + estos días. */
  paymentTermsDays?: number | null;
};

type SupplierOption = SupplierPickerOption & { defaults: RecurringExpenseSupplierDefaults };

type RecurringExpenseFormProps = {
  suppliers: SupplierOption[];
  accounts: Array<{ id: string; code: string; name: string }>;
  initial: RecurringExpenseFormValues;
  templateId?: string;
  generated?: { lastPeriod: string | null; count: number };
  wasAutomatic?: boolean;
};

type LineDraft = {
  key: string;
  accountId: string;
  description: string;
  amount: string;
  taxRate: number;
  retentionRate: number;
  deductible: string;
};

type LineErrors = Partial<Record<"account" | "description" | "amount" | "deductible", string>>;

const MAX_LINES = 50;

function decimalText(value: number | null) {
  return value === null ? "" : value.toFixed(2).replace(".", ",");
}

function percentText(value: number) {
  return String(value).replace(".", ",");
}

/** Línea nueva con los valores habituales del proveedor (cuenta, IRPF y % de IVA deducible). */
export function newExpenseLine(key: string, defaults?: RecurringExpenseSupplierDefaults | null): LineDraft {
  return {
    key,
    accountId: defaults?.defaultExpenseAccountId ?? "",
    description: "",
    amount: "",
    taxRate: 21,
    retentionRate: defaults?.defaultRetentionRate ?? 0,
    deductible: percentText(defaults?.defaultTaxDeductiblePct ?? 100),
  };
}

/** Texto del vencimiento según las condiciones del proveedor. */
export function supplierDueDateHint(paymentTermsDays: number | null | undefined) {
  if (paymentTermsDays === null || paymentTermsDays === undefined || paymentTermsDays < 0) {
    return "El proveedor no tiene días de pago en su ficha: los gastos se registrarán sin vencimiento.";
  }
  if (paymentTermsDays === 0) return "Vencimiento: el mismo día de cada gasto (pago al contado, según la ficha del proveedor).";
  return `Vencimiento: ${paymentTermsDays} ${paymentTermsDays === 1 ? "día" : "días"} después de cada fecha (días de pago del proveedor).`;
}

/**
 * Gasto recurrente (alquiler, cuota, suscripción, cuota de autónomos): proveedor, una o varias líneas
 * (cuenta, importe, IVA/IRPF) y periodicidad. Por defecto cada periodo queda pendiente de revisar.
 */
export function RecurringExpenseForm({ accounts, generated, initial, suppliers, templateId, wasAutomatic = false }: RecurringExpenseFormProps) {
  const router = useRouter();
  const idBase = useId();
  const id = (suffix: string) => `${idBase}-${suffix}`;
  const keyCounter = useRef(0);
  const nextKey = () => {
    keyCounter.current += 1;
    return `line-${keyCounter.current}`;
  };
  const [name, setName] = useState(initial.name);
  const [supplierId, setSupplierId] = useState(initial.supplierPartnerId);
  const [lines, setLines] = useState<LineDraft[]>(() => {
    const source = initial.lines.length > 0 ? initial.lines : [{ expenseAccountId: "", description: "", amount: null, taxRate: 21, retentionRate: 0, taxDeductiblePct: 100 }];
    return source.map((line, index) => ({
      key: `initial-${index}`,
      accountId: line.expenseAccountId,
      description: line.description,
      amount: decimalText(line.amount),
      taxRate: line.taxRate,
      retentionRate: line.retentionRate,
      deductible: percentText(line.taxDeductiblePct),
    }));
  });
  const [issueMode, setIssueMode] = useState(initial.issueMode);
  const [confirmed, setConfirmed] = useState(wasAutomatic);
  const [schedule, setSchedule] = useState(initial.schedule);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lineErrors, setLineErrors] = useState<LineErrors[]>([]);
  const [scheduleErrors, setScheduleErrors] = useState<ScheduleErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const supplier = suppliers.find((option) => option.id === supplierId) ?? null;
  const dates = previewDates(schedule, generated ?? { lastPeriod: null, count: 0 });
  const amounts = lines.map((line) => parseDecimalInput(line.amount, { maximumFractionDigits: 2 }));
  const total = amounts.every((amount) => amount !== null)
    ? calculateInvoiceTotals(lines.map((line, index) => ({ description: line.description || "—", quantity: 1, unitPrice: amounts[index] ?? 0, taxRate: line.taxRate, retentionRate: line.retentionRate }))).totalAmount
    : null;
  const automaticWarning = issueMode === "POST"
    ? "Se registrarán gastos automáticamente en cada fecha, con su asiento contable, sin que los revises."
    : null;

  const updateLine = (key: string, patch: Partial<LineDraft>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  function chooseSupplier(nextId: string) {
    setSupplierId(nextId);
    const chosen = suppliers.find((option) => option.id === nextId);
    if (!chosen) return;
    // Valores habituales del proveedor: cuenta en las líneas sin cuenta; IRPF y % deducible en todas.
    setLines((current) => current.map((line) => ({
      ...line,
      accountId: line.accountId || chosen.defaults.defaultExpenseAccountId || "",
      ...(chosen.defaults.defaultRetentionRate !== null ? { retentionRate: chosen.defaults.defaultRetentionRate } : {}),
      ...(chosen.defaults.defaultTaxDeductiblePct !== null ? { deductible: percentText(chosen.defaults.defaultTaxDeductiblePct) } : {}),
    })));
    if (!name.trim()) setName(chosen.name);
  }

  // Importe de cada línea (base + IVA − IRPF) y, si hay impuestos, su base.
  const lineTotals = calculateInvoiceTotals(lines.map((line, index) => ({ description: line.description || "—", quantity: 1, unitPrice: amounts[index] ?? 0, taxRate: line.taxRate, retentionRate: line.retentionRate }))).lines;
  const lineRows: LinesEditorRow[] = lines.map((line, index) => {
    const lineError = lineErrors[index] ?? {};
    const lineTotal = lineTotals[index];
    return {
      key: line.key,
      description: { maxLength: 500, placeholder: "Alquiler {mes} {año}", value: line.description, onChange: (event) => updateLine(line.key, { description: event.target.value }) },
      unitPrice: { value: line.amount, onChange: (event) => updateLine(line.key, { amount: event.target.value }) },
      taxRate: { value: String(line.taxRate), onChange: (event) => updateLine(line.key, { taxRate: Number(event.target.value) }) },
      total: { amount: lineTotal?.lineTotal ?? 0, base: lineTotal && (lineTotal.taxAmount || lineTotal.retentionAmount) ? lineTotal.subtotal : null },
      errors: { account: lineError.account, description: lineError.description, unitPrice: lineError.amount, deductible: lineError.deductible },
    };
  });
  // Columnas propias del gasto: cuenta contable (primera), retención y % de IVA deducible.
  const expenseColumns: LinesExtraColumn[] = [
    {
      key: "account",
      label: "Cuenta de gasto",
      position: "start",
      track: "minmax(12rem,.8fr)",
      wide: true,
      render: ({ describedBy, id: fieldId, index, invalid }) => (
        <AccountPicker
          accounts={accounts}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          groupFilter={["6", "2"]}
          id={fieldId}
          onChange={(nextId) => updateLine(lines[index].key, { accountId: nextId })}
          recentKey="recurring-expense"
          required
          value={lines[index].accountId}
        />
      ),
    },
    {
      key: "retention",
      label: "Retención IRPF",
      header: "IRPF",
      hint: "Alquileres de local: 19 %.",
      position: "end",
      track: "6.5rem",
      render: ({ describedBy, id: fieldId, index, onEnter }) => (
        <Select aria-describedby={describedBy} className="h-9" id={fieldId} onChange={(event) => updateLine(lines[index].key, { retentionRate: Number(event.target.value) })} onKeyDown={onEnter} value={String(lines[index].retentionRate)}>
          {retentionRateOptions(lines[index].retentionRate).map((rate) => <option key={rate} value={rate}>{retentionRateLabel(rate)}</option>)}
        </Select>
      ),
    },
    {
      key: "deductible",
      label: "IVA deducible",
      header: "Deducible",
      hint: "100 % salvo uso mixto.",
      numeric: true,
      position: "end",
      track: "5.5rem",
      render: ({ describedBy, id: fieldId, index, invalid, onEnter }) => (
        <PercentInput aria-describedby={describedBy} aria-invalid={invalid || undefined} className="h-9" id={fieldId} onChange={(event) => updateLine(lines[index].key, { deductible: event.target.value })} onKeyDown={onEnter} value={lines[index].deductible} />
      ),
    },
  ];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const nextErrors: Record<string, string> = {};
    if (!name.trim()) nextErrors.name = "Ponle un nombre para reconocerlo.";
    if (!supplierId) nextErrors.supplier = "Elige el proveedor.";
    if (automaticWarning && !confirmed) nextErrors.confirm = "Marca la casilla para confirmar el registro automático.";
    const deductibles = lines.map((line) => parseDecimalInput(line.deductible));
    const nextLineErrors: LineErrors[] = lines.map((line, index) => {
      const lineError: LineErrors = {};
      if (!line.accountId) lineError.account = "Elige la cuenta de gasto (p. ej. 621 alquileres, 642 Seguridad Social).";
      if (!line.description.trim()) lineError.description = "Escribe el concepto.";
      const amount = amounts[index];
      if (amount === null || amount < 0) lineError.amount = "Indica la base imponible (por ejemplo, 650,00).";
      const deductible = deductibles[index];
      if (deductible === null || deductible < 0 || deductible > 100) lineError.deductible = "Entre 0 y 100 %.";
      return lineError;
    });
    const nextScheduleErrors = validateScheduleDraft(schedule);
    setErrors(nextErrors);
    setLineErrors(nextLineErrors);
    setScheduleErrors(nextScheduleErrors);
    const hasLineErrors = nextLineErrors.some((lineError) => Object.keys(lineError).length > 0);
    if (Object.keys(nextErrors).length > 0 || hasLineErrors || Object.keys(nextScheduleErrors).length > 0) {
      setFormError("Revisa los campos marcados.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(templateId ? `/api/recurring/${templateId}` : "/api/recurring", {
        method: templateId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          kind: "EXPENSE",
          name,
          supplierPartnerId: supplierId,
          ...schedulePayload(schedule),
          issueMode,
          confirmAutomatic: Boolean(automaticWarning && confirmed),
          lines: lines.map((line, index) => ({
            description: line.description,
            quantity: 1,
            unitPrice: amounts[index] ?? 0,
            taxRate: line.taxRate,
            retentionRate: line.retentionRate,
            expenseAccountId: line.accountId,
            taxDeductiblePct: deductibles[index] ?? 100,
          })),
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar el gasto recurrente."));
      const saved = (await response.json()) as { id: string };
      toast.success(templateId ? "Gasto recurrente actualizado." : "Gasto recurrente creado.");
      router.push(`/expenses/recurring/${saved.id}`);
      router.refresh();
    } catch (saveError) {
      setFormError(errorMessage(saveError, "No se pudo guardar el gasto recurrente."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-4" noValidate onSubmit={handleSubmit}>
      <RequiredFieldsNote />
      <PageSection title="Gasto">
        <div className="grid gap-3 sm:grid-cols-2">
          <AccessibleField
            error={errors.supplier}
            helperText={supplier ? supplierDueDateHint(supplier.defaults.paymentTermsDays) : "Al elegirlo se proponen su cuenta, retención y % de IVA deducible habituales."}
            id={id("supplier")}
            label="Proveedor"
            required
          >
            <SupplierPicker id={id("supplier")} onChange={chooseSupplier} suppliers={suppliers} value={supplierId} />
          </AccessibleField>
          <AccessibleField error={errors.name} helperText="Solo para ti, p. ej. «Alquiler oficina» o «Cuota de autónomos»." id={id("name")} label="Nombre" required>
            <Input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          </AccessibleField>
        </div>
      </PageSection>

      <div className="space-y-2">
        <LinesEditor
          description={`Una línea por cada concepto con distinta cuenta o IVA (p. ej. alquiler y gastos de comunidad). El concepto admite ${TEMPLATE_VARIABLES.map((variable) => variable.token).join(", ")}, p. ej. «Alquiler {mes} {año}». Enter avanza; Alt+L añade una línea.`}
          extraColumns={expenseColumns}
          idPrefix="recurring-expense-line"
          listTestId="recurring-expense-lines"
          maxLines={MAX_LINES}
          onAdd={() => setLines((current) => [...current, newExpenseLine(nextKey(), supplier?.defaults)])}
          onDuplicate={(index) => setLines((current) => (current[index] ? [...current.slice(0, index + 1), { ...current[index], key: nextKey() }, ...current.slice(index + 1)] : current))}
          onMove={(from, to) => setLines((current) => moveItem(current, from, to))}
          onRemove={(index) => setLines((current) => (current.length > 1 ? current.filter((_, lineIndex) => lineIndex !== index) : current))}
          rowTestId={() => "recurring-expense-line"}
          rows={lineRows}
          tax={{ kind: "vat", defaultRate: 21 }}
          title="Líneas"
          totalLabel="Total"
          unitPriceHint="Importe sin IVA."
          unitPriceLabel="Base imponible"
          withQuantity={false}
        />
        {total !== null ? <p className="text-right font-mono text-sm" data-testid="recurring-expense-total">Total de cada recibo: {formatMoney(total)}</p> : null}
      </div>

      <PageSection title="Cuándo">
        <ScheduleFields draft={schedule} errors={scheduleErrors} generated={generated} noun="factura del gasto" onChange={setSchedule} />
      </PageSection>

      <PageSection title="Qué hacer">
        <IssueModeFields
          automaticWarning={automaticWarning}
          confirmError={errors.confirm}
          confirmed={confirmed}
          nextDate={dates[0] ?? null}
          onChange={(value) => {
            setIssueMode(value === "POST" ? "POST" : "DRAFT");
            setConfirmed(false);
          }}
          onConfirmedChange={setConfirmed}
          options={[
            { value: "DRAFT", label: "Dejarlo pendiente de revisar", description: "Recomendado. En cada fecha aparece en «Gastos recurrentes» para confirmar el importe (útil si varía) o descartarlo." },
            { value: "POST", label: "Registrar automáticamente", description: "Se registra la factura del proveedor con estos importes y se contabiliza en su fecha." },
          ]}
          value={issueMode}
        />
      </PageSection>

      <FormErrorMessage>{formError}</FormErrorMessage>
      <FormActions>
        <SubmitButton pending={saving}>{templateId ? "Guardar cambios" : "Crear gasto recurrente"}</SubmitButton>
      </FormActions>
    </form>
  );
}
