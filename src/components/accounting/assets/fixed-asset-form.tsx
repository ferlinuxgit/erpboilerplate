"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AccountPicker } from "@/components/ui/account-picker";
import { Button } from "@/components/ui/button";
import { AccessibleField, errorMessage, FormActions, readApiError, RequiredFieldsNote, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { DecimalInput, MoneyInput, PercentInput } from "@/components/ui/number-input";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney, formatPercent, parseDecimalInput } from "@/lib/format";
import { effectiveAnnualPct, suggestAssetAccounts, type DepreciationMethod } from "@/server/fixed-assets/model";
import { findTaxCoefficient, suggestedTaxCoefficientKey, TAX_COEFFICIENTS, taxCoefficientWarning } from "@/server/fixed-assets/tax-coefficients";

type AccountOption = { id: string; code: string; name: string };

export type FixedAssetFormValues = {
  description: string;
  notes: string;
  assetAccountCode: string;
  accumulatedAccountCode: string;
  expenseAccountCode: string;
  isDepreciable: boolean;
  method: DepreciationMethod;
  annualPct: string;
  usefulLifeYears: string;
  taxCoefficientKey: string;
  acquisitionDate: string;
  inServiceDate: string;
  depreciationStartDate: string;
  acquisitionCost: string;
  residualValue: string;
  priorAccumulated: string;
  supplierInvoiceId: string;
};

type FixedAssetFormProps = {
  /** Sin `assetId` es un alta. */
  assetId?: string;
  initialValues: FixedAssetFormValues;
  accounts: { asset: AccountOption[]; accumulated: AccountOption[]; expense: AccountOption[] };
  supplierInvoices: Array<{ id: string; label: string }>;
  currencyCode: string;
  /** Con amortizaciones contabilizadas o de baja: solo descripción, notas, tipo fiscal y factura. */
  economicsLocked?: boolean;
};

/** Importes y años: dos decimales como mucho, así «1.500» es mil quinientos. */
const parseMoney = (value: string) => parseDecimalInput(value, { maximumFractionDigits: 2 });

const coefficientGroups = [...new Set(TAX_COEFFICIENTS.map((entry) => entry.group))];

/** Opción de la lista que mejor representa un código: la cuenta exacta o, si no, su subcuenta. */
function optionForCode(options: AccountOption[], code: string) {
  if (!code) return null;
  return options.find((option) => option.code === code) ?? options.find((option) => option.code.startsWith(code) && /^0*$/.test(option.code.slice(code.length))) ?? null;
}

/**
 * Alta y edición de un bien de inmovilizado. Al elegir la cuenta del bien se proponen la de
 * amortización acumulada, la de gasto y el tipo de elemento de la tabla fiscal; el porcentaje es
 * libre y solo se avisa si se sale del rango fiscal.
 */
export function FixedAssetForm({ accounts, assetId, currencyCode, economicsLocked = false, initialValues, supplierInvoices }: FixedAssetFormProps) {
  const router = useRouter();
  const [values, setValues] = useState(initialValues);
  const [inServiceTouched, setInServiceTouched] = useState(Boolean(assetId) || initialValues.inServiceDate !== initialValues.acquisitionDate);
  const [showPrior, setShowPrior] = useState(Boolean(initialValues.depreciationStartDate) || (parseMoney(initialValues.priorAccumulated) ?? 0) > 0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<FixedAssetFormValues>) => setValues((current) => ({ ...current, ...patch }));

  const coefficient = findTaxCoefficient(values.taxCoefficientKey);
  const cost = parseMoney(values.acquisitionCost) ?? 0;
  const residual = parseMoney(values.residualValue) ?? 0;
  const pct = effectiveAnnualPct({ method: values.method, annualPct: parseDecimalInput(values.annualPct), usefulLifeYears: parseMoney(values.usefulLifeYears) });
  const warning = values.isDepreciable ? taxCoefficientWarning(pct, values.taxCoefficientKey) : null;
  const annualQuota = values.isDepreciable && pct && cost > residual ? ((cost - residual) * pct) / 100 : null;

  const assetOption = useMemo(() => optionForCode(accounts.asset, values.assetAccountCode), [accounts.asset, values.assetAccountCode]);
  const accumulatedOption = useMemo(() => optionForCode(accounts.accumulated, values.accumulatedAccountCode), [accounts.accumulated, values.accumulatedAccountCode]);
  const expenseOption = useMemo(() => optionForCode(accounts.expense, values.expenseAccountCode), [accounts.expense, values.expenseAccountCode]);

  function chooseAssetAccount(account: AccountOption | null) {
    if (!account) {
      set({ assetAccountCode: "" });
      return;
    }
    const suggestion = suggestAssetAccounts(account.code);
    const coefficientKey = suggestedTaxCoefficientKey(account.code);
    setValues((current) => {
      const suggested = findTaxCoefficient(coefficientKey);
      return {
        ...current,
        assetAccountCode: account.code,
        isDepreciable: suggestion?.depreciable ?? current.isDepreciable,
        accumulatedAccountCode: suggestion?.accumulatedCode ?? "",
        expenseAccountCode: suggestion?.expenseCode ?? "",
        taxCoefficientKey: coefficientKey ?? current.taxCoefficientKey,
        // Solo se propone porcentaje si el usuario aún no ha puesto ninguno.
        annualPct: current.annualPct || !suggested ? current.annualPct : String(suggested.maxPct),
      };
    });
  }

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const body = {
        description: values.description,
        notes: values.notes || null,
        assetAccountCode: values.assetAccountCode,
        accumulatedAccountCode: values.isDepreciable ? values.accumulatedAccountCode || null : null,
        expenseAccountCode: values.isDepreciable ? values.expenseAccountCode || null : null,
        isDepreciable: values.isDepreciable,
        method: values.method,
        annualPct: values.isDepreciable && values.method === "percent" ? parseDecimalInput(values.annualPct) : null,
        usefulLifeYears: values.isDepreciable && values.method === "years" ? parseMoney(values.usefulLifeYears) : null,
        taxCoefficientKey: values.taxCoefficientKey || null,
        acquisitionDate: values.acquisitionDate,
        inServiceDate: values.inServiceDate || values.acquisitionDate,
        depreciationStartDate: showPrior && values.depreciationStartDate ? values.depreciationStartDate : null,
        acquisitionCost: parseMoney(values.acquisitionCost) ?? 0,
        residualValue: parseMoney(values.residualValue) ?? 0,
        priorAccumulated: showPrior ? (parseMoney(values.priorAccumulated) ?? 0) : 0,
        supplierInvoiceId: values.supplierInvoiceId || null,
      };
      const response = await fetch(assetId ? `/api/fixed-assets/${assetId}` : "/api/fixed-assets", {
        method: assetId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar el bien."));
      const saved: { id: string; code: string } = await response.json();
      toast.success(assetId ? `Bien ${saved.code} guardado.` : `Bien ${saved.code} dado de alta.`);
      router.push(`/accounting/assets/${saved.id}`);
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught, "No se pudo guardar el bien."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="grid gap-3 md:grid-cols-6"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") event.currentTarget.requestSubmit();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {economicsLocked ? (
        <InlineAlert className="md:col-span-6" tone="info">
          Este bien ya tiene asientos: solo se pueden cambiar la descripción, las notas, el tipo de elemento fiscal y la factura de origen. Para cambiar importes, fechas, porcentaje o cuentas, deshaz antes sus amortizaciones (o anula la baja) desde la ficha.
        </InlineAlert>
      ) : null}

      <AccessibleField className="md:col-span-4" id="asset-description" label="Descripción" required>
        <Input maxLength={200} onChange={(event) => set({ description: event.target.value })} placeholder="Portátil Lenovo ThinkPad T14" required value={values.description} />
      </AccessibleField>
      <AccessibleField className="md:col-span-2" helperText="Opcional. Enlaza el bien con su factura de compra." id="asset-supplier-invoice" label="Factura de proveedor de origen">
        <Select onChange={(event) => set({ supplierInvoiceId: event.target.value })} value={values.supplierInvoiceId}>
          <option value="">Sin factura enlazada</option>
          {supplierInvoices.map((invoice) => (
            <option key={invoice.id} value={invoice.id}>{invoice.label}</option>
          ))}
        </Select>
      </AccessibleField>

      <AccessibleField
        className="md:col-span-3"
        helperText="Grupos 20 (intangible), 21 (material) y 22 (inversiones inmobiliarias). Si eliges la cuenta del plan (217) se usa su subcuenta."
        id="asset-account"
        label="Cuenta de inmovilizado"
        required
      >
        <AccountPicker
          accounts={accounts.asset}
          disabled={economicsLocked}
          id="asset-account"
          onChange={(_, account) => chooseAssetAccount(account)}
          placeholder="Busca la cuenta (p. ej. ordenador, vehículo, 217)"
          recentKey="fixed-asset"
          required
          value={assetOption?.id ?? ""}
        />
      </AccessibleField>
      <AccessibleField className="md:col-span-3 md:self-start" helperText="Los terrenos (210, 220) y los anticipos (209) no se amortizan." id="asset-depreciable" label="¿Se amortiza?">
        <Select disabled={economicsLocked} onChange={(event) => set({ isDepreciable: event.target.value === "yes" })} value={values.isDepreciable ? "yes" : "no"}>
          <option value="yes">Sí, amortización lineal</option>
          <option value="no">No se amortiza</option>
        </Select>
      </AccessibleField>

      <AccessibleField className="md:col-span-2" id="asset-acquisition-date" label="Fecha de adquisición" required>
        <Input
          disabled={economicsLocked}
          onChange={(event) => set(inServiceTouched ? { acquisitionDate: event.target.value } : { acquisitionDate: event.target.value, inServiceDate: event.target.value })}
          required
          type="date"
          value={values.acquisitionDate}
        />
      </AccessibleField>
      <AccessibleField className="md:col-span-2" helperText="Desde este día empieza a amortizarse." id="asset-in-service-date" label="Puesta en funcionamiento" required>
        <Input
          disabled={economicsLocked}
          min={values.acquisitionDate || undefined}
          onChange={(event) => {
            setInServiceTouched(true);
            set({ inServiceDate: event.target.value });
          }}
          required
          type="date"
          value={values.inServiceDate}
        />
      </AccessibleField>
      <AccessibleField className="md:col-span-1" helperText="Sin IVA deducible." id="asset-cost" label="Valor de adquisición" required>
        <MoneyInput disabled={economicsLocked} onChange={(event) => set({ acquisitionCost: event.target.value })} placeholder="0,00" required value={values.acquisitionCost} />
      </AccessibleField>
      <AccessibleField className="md:col-span-1" helperText="No se amortiza." id="asset-residual" label="Valor residual">
        <MoneyInput disabled={economicsLocked} onChange={(event) => set({ residualValue: event.target.value })} placeholder="0,00" value={values.residualValue} />
      </AccessibleField>

      {values.isDepreciable ? (
        <>
          <AccessibleField className="md:col-span-3" id="asset-accumulated-account" label="Cuenta de amortización acumulada" required>
            <AccountPicker
              accounts={accounts.accumulated}
              disabled={economicsLocked}
              id="asset-accumulated-account"
              onChange={(_, account) => set({ accumulatedAccountCode: account?.code ?? "" })}
              placeholder="280x, 281x o 282"
              recentKey="fixed-asset-accumulated"
              required
              value={accumulatedOption?.id ?? ""}
            />
          </AccessibleField>
          <AccessibleField className="md:col-span-3" id="asset-expense-account" label="Cuenta de gasto (dotación)" required>
            <AccountPicker
              accounts={accounts.expense}
              disabled={economicsLocked}
              id="asset-expense-account"
              onChange={(_, account) => set({ expenseAccountCode: account?.code ?? "" })}
              placeholder="680, 681 o 682"
              recentKey="fixed-asset-expense"
              required
              value={expenseOption?.id ?? ""}
            />
          </AccessibleField>

          <AccessibleField
            className="md:col-span-3"
            helperText={
              coefficient
                ? `Tabla del art. 12.1.a) de la Ley 27/2014: máximo ${formatPercent(coefficient.maxPct)} anual, periodo máximo ${coefficient.maxYears} años.`
                : "Tabla de amortización del Impuesto sobre Sociedades (art. 12.1.a de la Ley 27/2014). Sirve de guía: el porcentaje lo decides tú."
            }
            id="asset-tax-coefficient"
            label="Tipo de elemento (tabla fiscal)"
          >
            <Select onChange={(event) => set({ taxCoefficientKey: event.target.value })} value={values.taxCoefficientKey}>
              <option value="">Sin tipo fiscal de referencia</option>
              {coefficientGroups.map((group) => (
                <optgroup key={group} label={group}>
                  {TAX_COEFFICIENTS.filter((entry) => entry.group === group).map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.label} · máx. {formatPercent(entry.maxPct)} · {entry.maxYears} años
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </AccessibleField>
          <AccessibleField className="md:col-span-1" id="asset-method" label="Método lineal">
            <Select disabled={economicsLocked} onChange={(event) => set({ method: event.target.value === "years" ? "years" : "percent" })} value={values.method}>
              <option value="percent">Por porcentaje</option>
              <option value="years">Por años</option>
            </Select>
          </AccessibleField>
          {values.method === "percent" ? (
            <AccessibleField className="md:col-span-2" id="asset-annual-pct" label="Porcentaje anual" required>
              <PercentInput disabled={economicsLocked} onChange={(event) => set({ annualPct: event.target.value })} placeholder="25" required value={values.annualPct} />
              {coefficient && !economicsLocked && parseDecimalInput(values.annualPct) !== coefficient.maxPct ? (
                <Button className="mt-1" onClick={() => set({ annualPct: String(coefficient.maxPct) })} size="xs" type="button" variant="outline">
                  Usar el máximo fiscal ({formatPercent(coefficient.maxPct)})
                </Button>
              ) : null}
            </AccessibleField>
          ) : (
            <AccessibleField className="md:col-span-2" helperText={pct ? `Equivale al ${formatPercent(pct)} anual.` : undefined} id="asset-useful-life" label="Años de vida útil" required>
              <DecimalInput adornment="años" disabled={economicsLocked} onChange={(event) => set({ usefulLifeYears: event.target.value })} placeholder="4" required value={values.usefulLifeYears} wrapperClassName="[&_input]:pr-12" />
            </AccessibleField>
          )}

          {warning ? <InlineAlert className="md:col-span-6" title="Aviso fiscal (no impide guardar)" tone="warning">{warning}</InlineAlert> : null}
          {annualQuota !== null ? (
            <p className="font-mono text-xs text-muted-foreground md:col-span-6">
              Valor amortizable {formatMoney(cost - residual, currencyCode)} · cuota de un año completo {formatMoney(annualQuota, currencyCode)} · el primer ejercicio se prorratea por días desde la puesta en funcionamiento.
            </p>
          ) : null}

          <div className="md:col-span-6">
            <label className="flex w-fit items-center gap-2 text-sm">
              <input checked={showPrior} disabled={economicsLocked} onChange={(event) => setShowPrior(event.target.checked)} type="checkbox" />
              El bien ya venía amortizándose antes de llevarlo en este programa
            </label>
          </div>
          {showPrior ? (
            <>
              <AccessibleField
                className="md:col-span-3"
                helperText="Saldo de la cuenta 28x de este bien en esa fecha (ya contabilizado fuera o en el asiento de apertura)."
                id="asset-prior-accumulated"
                label="Amortización acumulada anterior"
              >
                <MoneyInput disabled={economicsLocked} onChange={(event) => set({ priorAccumulated: event.target.value })} placeholder="0,00" value={values.priorAccumulated} />
              </AccessibleField>
              <AccessibleField className="md:col-span-3" helperText="Primer día que amortiza el programa (normalmente el inicio de un ejercicio)." id="asset-start-date" label="El programa amortiza desde">
                <Input disabled={economicsLocked} min={values.inServiceDate || undefined} onChange={(event) => set({ depreciationStartDate: event.target.value })} type="date" value={values.depreciationStartDate} />
              </AccessibleField>
            </>
          ) : null}
        </>
      ) : null}

      <AccessibleField className="md:col-span-6" id="asset-notes" label="Notas">
        <Textarea maxLength={2000} onChange={(event) => set({ notes: event.target.value })} placeholder="Número de serie, matrícula, ubicación…" value={values.notes} />
      </AccessibleField>

      <RequiredFieldsNote className="md:col-span-6" />
      {error ? <InlineAlert className="md:col-span-6" role="alert" tone="danger">{error}</InlineAlert> : null}
      <FormActions className="md:col-span-6">
        <Button onClick={() => router.push(assetId ? `/accounting/assets/${assetId}` : "/accounting/assets")} type="button" variant="outline">Cancelar</Button>
        <SubmitButton pending={pending}>{assetId ? "Guardar cambios" : "Dar de alta el bien"}</SubmitButton>
      </FormActions>
    </form>
  );
}
