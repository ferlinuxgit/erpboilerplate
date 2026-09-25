"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
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
import { AccessibleField, FormActions, FormErrorMessage, RequiredFieldsNote, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput, PercentInput } from "@/components/ui/number-input";
import { PageSection } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney, parseDecimalInput } from "@/lib/format";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { TEMPLATE_VARIABLES } from "@/server/recurring/schedule";

export type RecurringExpenseFormValues = {
  name: string;
  supplierPartnerId: string;
  expenseAccountId: string;
  description: string;
  amount: number | null;
  taxRate: number;
  retentionRate: number;
  taxDeductiblePct: number;
  issueMode: "DRAFT" | "POST";
  schedule: ScheduleDraft;
};

type SupplierOption = SupplierPickerOption & {
  defaults: { defaultExpenseAccountId: string | null; defaultRetentionRate: number | null; defaultTaxDeductiblePct: number | null };
};

type RecurringExpenseFormProps = {
  suppliers: SupplierOption[];
  accounts: Array<{ id: string; code: string; name: string }>;
  initial: RecurringExpenseFormValues;
  templateId?: string;
  generated?: { lastPeriod: string | null; count: number };
  wasAutomatic?: boolean;
};

function decimalText(value: number | null) {
  return value === null ? "" : value.toFixed(2).replace(".", ",");
}

/**
 * Gasto recurrente (alquiler, cuota, suscripción, cuota de autónomos): proveedor, cuenta, importe,
 * IVA/IRPF y periodicidad. Por defecto cada periodo queda pendiente de revisar antes de registrarlo.
 */
export function RecurringExpenseForm({ accounts, generated, initial, suppliers, templateId, wasAutomatic = false }: RecurringExpenseFormProps) {
  const router = useRouter();
  const idBase = useId();
  const id = (suffix: string) => `${idBase}-${suffix}`;
  const [name, setName] = useState(initial.name);
  const [supplierId, setSupplierId] = useState(initial.supplierPartnerId);
  const [accountId, setAccountId] = useState(initial.expenseAccountId);
  const [description, setDescription] = useState(initial.description);
  const [amount, setAmount] = useState(decimalText(initial.amount));
  const [taxRate, setTaxRate] = useState(initial.taxRate);
  const [retentionRate, setRetentionRate] = useState(initial.retentionRate);
  const [deductible, setDeductible] = useState(String(initial.taxDeductiblePct).replace(".", ","));
  const [issueMode, setIssueMode] = useState(initial.issueMode);
  const [confirmed, setConfirmed] = useState(wasAutomatic);
  const [schedule, setSchedule] = useState(initial.schedule);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [scheduleErrors, setScheduleErrors] = useState<ScheduleErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dates = previewDates(schedule, generated ?? { lastPeriod: null, count: 0 });
  const baseAmount = parseDecimalInput(amount, { maximumFractionDigits: 2 });
  const total = baseAmount !== null ? calculateInvoiceTotals([{ quantity: 1, unitPrice: baseAmount, taxRate, retentionRate }]).totalAmount : null;
  const automaticWarning = issueMode === "POST"
    ? "Se registrarán gastos automáticamente en cada fecha, con su asiento contable, sin que los revises."
    : null;

  function chooseSupplier(nextId: string) {
    setSupplierId(nextId);
    const supplier = suppliers.find((option) => option.id === nextId);
    if (!supplier) return;
    // Valores habituales del proveedor, sin pisar lo que ya se haya elegido.
    if (!accountId && supplier.defaults.defaultExpenseAccountId) setAccountId(supplier.defaults.defaultExpenseAccountId);
    if (supplier.defaults.defaultRetentionRate !== null) setRetentionRate(supplier.defaults.defaultRetentionRate);
    if (supplier.defaults.defaultTaxDeductiblePct !== null) setDeductible(String(supplier.defaults.defaultTaxDeductiblePct).replace(".", ","));
    if (!name.trim()) setName(supplier.name);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const nextErrors: Record<string, string> = {};
    const deductiblePct = parseDecimalInput(deductible);
    if (!name.trim()) nextErrors.name = "Ponle un nombre para reconocerlo.";
    if (!supplierId) nextErrors.supplier = "Elige el proveedor.";
    if (!accountId) nextErrors.account = "Elige la cuenta de gasto (p. ej. 621 alquileres, 642 Seguridad Social).";
    if (!description.trim()) nextErrors.description = "Escribe el concepto.";
    if (baseAmount === null || baseAmount < 0) nextErrors.amount = "Indica la base imponible (por ejemplo, 650,00).";
    if (deductiblePct === null || deductiblePct < 0 || deductiblePct > 100) nextErrors.deductible = "Entre 0 y 100 %.";
    if (automaticWarning && !confirmed) nextErrors.confirm = "Marca la casilla para confirmar el registro automático.";
    const nextScheduleErrors = validateScheduleDraft(schedule);
    setErrors(nextErrors);
    setScheduleErrors(nextScheduleErrors);
    if (Object.keys(nextErrors).length > 0 || Object.keys(nextScheduleErrors).length > 0 || baseAmount === null || deductiblePct === null) {
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
          lines: [{ description, quantity: 1, unitPrice: baseAmount, taxRate, retentionRate, expenseAccountId: accountId, taxDeductiblePct: deductiblePct }],
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
          <AccessibleField error={errors.supplier} id={id("supplier")} label="Proveedor" required>
            <SupplierPicker id={id("supplier")} onChange={chooseSupplier} suppliers={suppliers} value={supplierId} />
          </AccessibleField>
          <AccessibleField error={errors.name} helperText="Solo para ti, p. ej. «Alquiler oficina» o «Cuota de autónomos»." id={id("name")} label="Nombre" required>
            <Input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          </AccessibleField>
          <AccessibleField error={errors.account} id={id("account")} label="Cuenta de gasto" required>
            <AccountPicker accounts={accounts} groupFilter={["6", "2"]} id={id("account")} onChange={(nextId) => setAccountId(nextId)} recentKey="recurring-expense" value={accountId} />
          </AccessibleField>
          <AccessibleField
            error={errors.description}
            helperText={`Admite ${TEMPLATE_VARIABLES.map((variable) => variable.token).join(", ")}, p. ej. «Alquiler {mes} {año}».`}
            id={id("description")}
            label="Concepto"
            required
          >
            <Input maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} />
          </AccessibleField>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <AccessibleField error={errors.amount} helperText="Importe sin IVA." id={id("amount")} label="Base imponible" required>
            <MoneyInput value={amount} onChange={(event) => setAmount(event.target.value)} />
          </AccessibleField>
          <AccessibleField id={id("vat")} label="IVA">
            <Select value={String(taxRate)} onChange={(event) => setTaxRate(Number(event.target.value))}>
              {standardVatRates.map((rate) => <option key={rate} value={rate}>{rate === 0 ? "Sin IVA (exento)" : `${rate} %`}</option>)}
            </Select>
          </AccessibleField>
          <AccessibleField helperText="Alquileres de local: 19 %." id={id("retention")} label="Retención IRPF">
            <Select value={String(retentionRate)} onChange={(event) => setRetentionRate(Number(event.target.value))}>
              {[...new Set([...standardRetentionRates, retentionRate])].sort((a, b) => a - b).map((rate) => <option key={rate} value={rate}>{rate === 0 ? "Sin retención" : `${rate} %`}</option>)}
            </Select>
          </AccessibleField>
          <AccessibleField error={errors.deductible} helperText="100 % salvo uso mixto." id={id("deductible")} label="IVA deducible">
            <PercentInput value={deductible} onChange={(event) => setDeductible(event.target.value)} />
          </AccessibleField>
        </div>
        {total !== null ? <p className="mt-2 font-mono text-sm" data-testid="recurring-expense-total">Total de cada recibo: {formatMoney(total)}</p> : null}
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
            { value: "POST", label: "Registrar automáticamente", description: "Se registra la factura del proveedor con este importe y se contabiliza en su fecha." },
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
