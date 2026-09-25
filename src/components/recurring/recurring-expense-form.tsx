"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { Plus, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";

import { standardRetentionRates, standardVatRates } from "@/components/invoices/document-lines-editor";
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
import { Button } from "@/components/ui/button";
import { AccessibleField, FormActions, FormErrorMessage, RequiredFieldsNote, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput, PercentInput } from "@/components/ui/number-input";
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

  function addLine() {
    if (lines.length >= MAX_LINES) return;
    const line = newExpenseLine(nextKey(), supplier?.defaults);
    setLines((current) => [...current, line]);
    requestAnimationFrame(() => document.getElementById(id(`${line.key}-description`))?.focus());
  }

  function removeLine(key: string) {
    setLines((current) => (current.length > 1 ? current.filter((line) => line.key !== key) : current));
  }

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

      <PageSection
        title="Líneas"
        description={`Añade una línea por cada concepto con distinta cuenta o IVA (p. ej. alquiler y gastos de comunidad). El concepto admite ${TEMPLATE_VARIABLES.map((variable) => variable.token).join(", ")}, p. ej. «Alquiler {mes} {año}».`}
      >
        <ol className="space-y-3" data-testid="recurring-expense-lines">
          {lines.map((line, index) => {
            const lineError = lineErrors[index] ?? {};
            const lineId = (suffix: string) => id(`${line.key}-${suffix}`);
            return (
              <li className="space-y-2 border border-window-shadow bg-card p-2.5" data-testid="recurring-expense-line" key={line.key}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-xs font-bold">Línea {index + 1}</p>
                  {lines.length > 1 ? (
                    <Button aria-label={`Quitar la línea ${index + 1}`} size="sm" type="button" variant="ghost" onClick={() => removeLine(line.key)}>
                      <Trash aria-hidden="true" />
                      Quitar
                    </Button>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <AccessibleField error={lineError.account} id={lineId("account")} label="Cuenta de gasto" required>
                    <AccountPicker
                      accounts={accounts}
                      groupFilter={["6", "2"]}
                      id={lineId("account")}
                      onChange={(nextId) => updateLine(line.key, { accountId: nextId })}
                      recentKey="recurring-expense"
                      value={line.accountId}
                    />
                  </AccessibleField>
                  <AccessibleField error={lineError.description} id={lineId("description")} label="Concepto" required>
                    <Input maxLength={500} value={line.description} onChange={(event) => updateLine(line.key, { description: event.target.value })} />
                  </AccessibleField>
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <AccessibleField error={lineError.amount} helperText="Importe sin IVA." id={lineId("amount")} label="Base imponible" required>
                    <MoneyInput value={line.amount} onChange={(event) => updateLine(line.key, { amount: event.target.value })} />
                  </AccessibleField>
                  <AccessibleField id={lineId("vat")} label="IVA">
                    <Select value={String(line.taxRate)} onChange={(event) => updateLine(line.key, { taxRate: Number(event.target.value) })}>
                      {[...new Set([...standardVatRates, line.taxRate])].sort((a, b) => b - a).map((rate) => <option key={rate} value={rate}>{rate === 0 ? "Sin IVA (exento)" : `${rate} %`}</option>)}
                    </Select>
                  </AccessibleField>
                  <AccessibleField helperText="Alquileres de local: 19 %." id={lineId("retention")} label="Retención IRPF">
                    <Select value={String(line.retentionRate)} onChange={(event) => updateLine(line.key, { retentionRate: Number(event.target.value) })}>
                      {[...new Set([...standardRetentionRates, line.retentionRate])].sort((a, b) => a - b).map((rate) => <option key={rate} value={rate}>{rate === 0 ? "Sin retención" : `${rate} %`}</option>)}
                    </Select>
                  </AccessibleField>
                  <AccessibleField error={lineError.deductible} helperText="100 % salvo uso mixto." id={lineId("deductible")} label="IVA deducible">
                    <PercentInput value={line.deductible} onChange={(event) => updateLine(line.key, { deductible: event.target.value })} />
                  </AccessibleField>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <Button disabled={lines.length >= MAX_LINES} type="button" variant="outline" onClick={addLine}>
            <Plus aria-hidden="true" />
            Añadir línea
          </Button>
          {total !== null ? <p className="font-mono text-sm" data-testid="recurring-expense-total">Total de cada recibo: {formatMoney(total)}</p> : null}
        </div>
      </PageSection>

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
