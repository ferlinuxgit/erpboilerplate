"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField, errorMessage, FormActions, readApiError, RequiredFieldsNote, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/number-input";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDecimalInput, formatMoney, formatPercent, parseDecimalInput } from "@/lib/format";
import {
  expectedNetCents,
  IN_KIND_POSTING_DEFAULTS,
  OTHER_DEDUCTION_KINDS,
  proposeWithholdingCents,
  SLIP_TYPE_LABELS,
  slipCents,
  validateSlip,
  type OtherDeductionKind,
  type SlipType,
} from "@/server/payroll/model";

export type SlipDeductionValues = { kind: OtherDeductionKind; concept: string; amount: string; accountCode: string };

export type SlipFormValues = {
  employeeId: string;
  period: string;
  concept: string;
  grossAmount: string;
  inKindAmount: string;
  inKindWithholdingAmount: string;
  withholdingAmount: string;
  employeeSocialSecurity: string;
  employerSocialSecurity: string;
  advancesAmount: string;
  netAmount: string;
  notes: string;
  /** Opcionales: nómina mensual por defecto, sin indemnización, sin otras deducciones ni especie contabilizada. */
  slipType?: SlipType;
  severanceAmount?: string;
  severanceExemptAmount?: string;
  otherDeductions?: SlipDeductionValues[];
  inKindPosting?: { expenseAccount: string; counterAccount: string } | null;
};

type EmployeeOption = { id: string; name: string; withholdingRate: number; isDirector: boolean };

const amount = (value: string) => parseDecimalInput(value, { maximumFractionDigits: 2 }) ?? 0;
const toInput = (cents: number) => formatDecimalInput(cents / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Nómina de un trabajador con los importes de la gestoría. Propone la retención (bruto × tipo de la
 * ficha) y el líquido, y enseña en vivo si la nómina cuadra.
 */
export function SlipForm({ slipId, initialValues, employees, currencyCode }: { slipId?: string; initialValues: SlipFormValues; employees: EmployeeOption[]; currencyCode: string }) {
  const router = useRouter();
  const [values, setValues] = useState<SlipFormValues>({ slipType: "monthly", severanceAmount: "", severanceExemptAmount: "", otherDeductions: [], inKindPosting: null, ...initialValues });
  const deductions = values.otherDeductions ?? [];
  const slipType: SlipType = values.slipType ?? "monthly";
  const [pending, setPending] = useState<"save" | "post" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<SlipFormValues>) => setValues((current) => ({ ...current, ...patch }));
  const employee = employees.find((option) => option.id === values.employeeId) ?? null;

  const amounts = {
    grossAmount: amount(values.grossAmount),
    inKindAmount: amount(values.inKindAmount),
    inKindWithholdingAmount: amount(values.inKindWithholdingAmount),
    withholdingAmount: amount(values.withholdingAmount),
    employeeSocialSecurity: amount(values.employeeSocialSecurity),
    employerSocialSecurity: amount(values.employerSocialSecurity),
    advancesAmount: amount(values.advancesAmount),
    netAmount: amount(values.netAmount),
    severanceAmount: amount(values.severanceAmount ?? ""),
    severanceExemptAmount: amount(values.severanceExemptAmount ?? ""),
  };
  const otherDeductions = deductions.map((item) => ({ kind: item.kind, concept: item.concept.trim(), amount: amount(item.amount), accountCode: item.accountCode.trim() }));
  const cents = slipCents({
    ...amounts,
    otherDeductions: otherDeductions.map((item) => ({ ...item, amountCents: Math.round(item.amount * 100) })),
    inKindPosting: values.inKindPosting ?? null,
  });
  const expected = expectedNetCents(cents);
  const validation = validateSlip(cents);
  const hasAmounts = cents.grossCents > 0 || cents.inKindCents > 0;
  const money = (value: number) => formatMoney(value / 100, currencyCode);

  function patchDeduction(index: number, patch: Partial<SlipDeductionValues>) {
    set({ otherDeductions: deductions.map((item, position) => (position === index ? { ...item, ...patch } : item)) });
  }

  function changeType(next: SlipType) {
    // El concepto sigue al tipo mientras el usuario no haya escrito otro.
    const defaultConcepts = Object.values(SLIP_TYPE_LABELS) as string[];
    set({ slipType: next, concept: !values.concept || defaultConcepts.includes(values.concept) ? SLIP_TYPE_LABELS[next] : values.concept });
  }

  function proposeWithholding() {
    if (!employee) return;
    const patch: Partial<SlipFormValues> = { withholdingAmount: toInput(proposeWithholdingCents(cents.grossCents, employee.withholdingRate)) };
    if (cents.inKindCents > 0) patch.inKindWithholdingAmount = toInput(proposeWithholdingCents(cents.inKindCents, employee.withholdingRate));
    set(patch);
  }

  async function submit(post: boolean) {
    setPending(post ? "post" : "save");
    setError(null);
    try {
      const response = await fetch(slipId ? `/api/payroll/slips/${slipId}` : "/api/payroll/slips", {
        method: slipId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          employeeId: values.employeeId,
          period: values.period,
          concept: values.concept || SLIP_TYPE_LABELS[slipType],
          slipType,
          ...amounts,
          otherDeductions,
          inKindPosting: values.inKindPosting ?? null,
          notes: values.notes || null,
          post,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar la nómina."));
      toast.success(post ? "Nómina guardada y contabilizada." : "Nómina guardada en borrador.");
      router.push(`/payroll?period=${values.period}`);
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught, "No se pudo guardar la nómina."));
    } finally {
      setPending(null);
    }
  }

  return (
    <form
      className="grid gap-3 md:grid-cols-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(false);
      }}
    >
      <AccessibleField className="md:col-span-3" id="slip-employee" label="Trabajador" required>
        <Select onChange={(event) => set({ employeeId: event.target.value })} required value={values.employeeId}>
          <option value="">Elige un trabajador</option>
          {employees.map((option) => (
            <option key={option.id} value={option.id}>{option.name}{option.isDirector ? " (administrador)" : ""}</option>
          ))}
        </Select>
      </AccessibleField>
      <AccessibleField className="md:col-span-1" helperText="El asiento lleva la fecha del último día del mes." id="slip-period" label="Mes" required>
        <Input onChange={(event) => set({ period: event.target.value })} required type="month" value={values.period} />
      </AccessibleField>
      <AccessibleField className="md:col-span-1" id="slip-type" label="Tipo">
        <Select onChange={(event) => changeType(event.target.value as SlipType)} value={slipType}>
          {(Object.keys(SLIP_TYPE_LABELS) as SlipType[]).map((option) => <option key={option} value={option}>{SLIP_TYPE_LABELS[option]}</option>)}
        </Select>
      </AccessibleField>
      <AccessibleField className="md:col-span-1" helperText="Distinto para cada paga del mismo mes." id="slip-concept" label="Concepto">
        <Input maxLength={60} onChange={(event) => set({ concept: event.target.value })} placeholder={SLIP_TYPE_LABELS[slipType]} value={values.concept} />
      </AccessibleField>

      <AccessibleField className="md:col-span-2" helperText="Total devengado en dinero (salario, pluses, pagas)." id="slip-gross" label="Devengos brutos" required>
        <MoneyInput onChange={(event) => set({ grossAmount: event.target.value })} placeholder="0,00" required value={values.grossAmount} />
      </AccessibleField>
      <AccessibleField
        className="md:col-span-2"
        helperText={employee ? `Tipo de la ficha: ${formatPercent(employee.withholdingRate)}.` : "Elige el trabajador para proponerla."}
        id="slip-withholding"
        label="IRPF retenido"
      >
        <MoneyInput onChange={(event) => set({ withholdingAmount: event.target.value })} placeholder="0,00" value={values.withholdingAmount} />
        <Button className="mt-1" disabled={!employee || cents.grossCents === 0} onClick={proposeWithholding} size="xs" type="button" variant="outline">
          Proponer: bruto × {employee ? formatPercent(employee.withholdingRate) : "tipo"}
        </Button>
      </AccessibleField>
      <AccessibleField className="md:col-span-2" helperText="Cuota obrera que se descuenta en la nómina." id="slip-ss-employee" label="Seguridad Social del trabajador">
        <MoneyInput onChange={(event) => set({ employeeSocialSecurity: event.target.value })} placeholder="0,00" value={values.employeeSocialSecurity} />
      </AccessibleField>

      <AccessibleField className="md:col-span-2" helperText="Coste de la empresa: no afecta al líquido." id="slip-ss-employer" label="Seguridad Social a cargo de la empresa">
        <MoneyInput onChange={(event) => set({ employerSocialSecurity: event.target.value })} placeholder="0,00" value={values.employerSocialSecurity} />
      </AccessibleField>
      <AccessibleField className="md:col-span-2" helperText="Anticipos ya entregados que se descuentan ahora." id="slip-advances" label="Anticipos">
        <MoneyInput onChange={(event) => set({ advancesAmount: event.target.value })} placeholder="0,00" value={values.advancesAmount} />
      </AccessibleField>
      <AccessibleField className="md:col-span-2" helperText={hasAmounts ? `Según los importes: ${money(expected)}.` : "Lo que cobra el trabajador."} id="slip-net" label="Líquido a percibir" required>
        <MoneyInput onChange={(event) => set({ netAmount: event.target.value })} placeholder="0,00" required value={values.netAmount} />
        <Button className="mt-1" disabled={!hasAmounts || expected < 0} onClick={() => set({ netAmount: toInput(expected) })} size="xs" type="button" variant="outline">
          Calcular el líquido
        </Button>
      </AccessibleField>

      <AccessibleField className="md:col-span-3" helperText="Valoración de coche de empresa, seguro médico… No se cobra en dinero." id="slip-in-kind" label="Retribución en especie">
        <MoneyInput onChange={(event) => set({ inKindAmount: event.target.value })} placeholder="0,00" value={values.inKindAmount} />
      </AccessibleField>
      <AccessibleField className="md:col-span-3" helperText="Ingreso a cuenta de la retribución en especie; se descuenta al trabajador." id="slip-in-kind-withholding" label="Ingreso a cuenta de la especie">
        <MoneyInput onChange={(event) => set({ inKindWithholdingAmount: event.target.value })} placeholder="0,00" value={values.inKindWithholdingAmount} />
      </AccessibleField>

      <label className="flex items-start gap-2 text-sm md:col-span-6" htmlFor="slip-in-kind-posting">
        <input
          checked={Boolean(values.inKindPosting)}
          className="mt-0.5 size-4"
          id="slip-in-kind-posting"
          onChange={(event) => set({ inKindPosting: event.target.checked ? { ...IN_KIND_POSTING_DEFAULTS } : null })}
          type="checkbox"
        />
        <span>
          Contabilizar el gasto de la retribución en especie en esta nómina
          <span className="block text-xs text-muted-foreground">Solo si no llega por factura (producto propio, vivienda de la empresa…). Si ya tienes la factura del renting o del seguro, déjalo sin marcar: el gasto ya está contabilizado.</span>
        </span>
      </label>
      {values.inKindPosting ? (
        <>
          <AccessibleField className="md:col-span-3" helperText="Cuenta del subgrupo 64 (649 «Otros gastos sociales», 640…)." id="slip-in-kind-expense" label="Cuenta de gasto de la especie">
            <Input inputMode="numeric" maxLength={12} onChange={(event) => set({ inKindPosting: { ...values.inKindPosting!, expenseAccount: event.target.value.trim() } })} value={values.inKindPosting.expenseAccount} />
          </AccessibleField>
          <AccessibleField className="md:col-span-3" helperText="Cuenta puente que cancelarás después (555 «Partidas pendientes de aplicación»…)." id="slip-in-kind-counter" label="Contrapartida">
            <Input inputMode="numeric" maxLength={12} onChange={(event) => set({ inKindPosting: { ...values.inKindPosting!, counterAccount: event.target.value.trim() } })} value={values.inKindPosting.counterAccount} />
          </AccessibleField>
        </>
      ) : null}

      {slipType === "settlement" || amount(values.severanceAmount ?? "") > 0 ? (
        <>
          <AccessibleField className="md:col-span-3" helperText="Parte de los devengos brutos que es indemnización: va a la cuenta 641." id="slip-severance" label="Indemnización (incluida en el bruto)">
            <MoneyInput onChange={(event) => set({ severanceAmount: event.target.value })} placeholder="0,00" value={values.severanceAmount ?? ""} />
          </AccessibleField>
          <AccessibleField className="md:col-span-3" helperText="La exenta de IRPF (art. 7.e): no entra en el 111 y va al 190 en la clave L.05." id="slip-severance-exempt" label="De ella, exenta">
            <MoneyInput onChange={(event) => set({ severanceExemptAmount: event.target.value })} placeholder="0,00" value={values.severanceExemptAmount ?? ""} />
          </AccessibleField>
        </>
      ) : null}

      <fieldset className="space-y-2 md:col-span-6">
        <legend className="text-sm font-bold">Otras deducciones</legend>
        <p className="text-xs text-muted-foreground">Embargos, cuotas sindicales, devolución de préstamos… Se restan del líquido y van al haber de la cuenta que indiques.</p>
        {deductions.map((item, index) => (
          <div className="grid gap-2 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_minmax(0,9rem)_minmax(0,8rem)_auto] md:items-end" key={index}>
            <AccessibleField id={`slip-deduction-kind-${index}`} label="Tipo">
              <Select
                onChange={(event) => {
                  const kind = event.target.value as OtherDeductionKind;
                  patchDeduction(index, { kind, accountCode: item.accountCode === OTHER_DEDUCTION_KINDS[item.kind].defaultAccount ? OTHER_DEDUCTION_KINDS[kind].defaultAccount : item.accountCode, concept: item.concept === OTHER_DEDUCTION_KINDS[item.kind].label ? OTHER_DEDUCTION_KINDS[kind].label : item.concept });
                }}
                value={item.kind}
              >
                {(Object.keys(OTHER_DEDUCTION_KINDS) as OtherDeductionKind[]).map((kind) => <option key={kind} value={kind}>{OTHER_DEDUCTION_KINDS[kind].label}</option>)}
              </Select>
            </AccessibleField>
            <AccessibleField id={`slip-deduction-concept-${index}`} label="Concepto">
              <Input maxLength={120} onChange={(event) => patchDeduction(index, { concept: event.target.value })} value={item.concept} />
            </AccessibleField>
            <AccessibleField id={`slip-deduction-amount-${index}`} label="Importe">
              <MoneyInput onChange={(event) => patchDeduction(index, { amount: event.target.value })} placeholder="0,00" value={item.amount} />
            </AccessibleField>
            <AccessibleField id={`slip-deduction-account-${index}`} label="Cuenta">
              <Input inputMode="numeric" maxLength={12} onChange={(event) => patchDeduction(index, { accountCode: event.target.value.trim() })} value={item.accountCode} />
            </AccessibleField>
            <Button aria-label={`Quitar la deducción ${index + 1}`} onClick={() => set({ otherDeductions: deductions.filter((_, position) => position !== index) })} size="sm" type="button" variant="ghost">Quitar</Button>
          </div>
        ))}
        <Button
          disabled={deductions.length >= 10}
          onClick={() => set({ otherDeductions: [...deductions, { kind: "garnishment", concept: OTHER_DEDUCTION_KINDS.garnishment.label, amount: "", accountCode: OTHER_DEDUCTION_KINDS.garnishment.defaultAccount }] })}
          size="sm"
          type="button"
          variant="outline"
        >
          Añadir deducción
        </Button>
      </fieldset>

      {hasAmounts ? (
        <InlineAlert className="md:col-span-6" title={validation.ok ? "La nómina cuadra" : "La nómina no cuadra"} tone={validation.ok ? "success" : "warning"}>
          {validation.ok
            ? `Asiento: sueldos (640) ${money(cents.grossCents - cents.severanceCents)}${cents.severanceCents ? `, indemnización (641) ${money(cents.severanceCents)}` : ""}${cents.inKindPosting && cents.inKindCents ? `, especie (${cents.inKindPosting.expenseAccount}) ${money(cents.inKindCents)}` : ""}${cents.employerSocialSecurityCents ? ` y Seguridad Social de la empresa (642) ${money(cents.employerSocialSecurityCents)}` : ""} al debe; retenciones (4751) ${money(cents.withholdingCents + cents.inKindWithholdingCents)}, Seguridad Social (476) ${money(cents.employeeSocialSecurityCents + cents.employerSocialSecurityCents)}${cents.advancesCents ? `, anticipos (460) ${money(cents.advancesCents)}` : ""}${cents.otherDeductions.map((item) => `, ${item.concept.toLowerCase()} (${item.accountCode}) ${money(item.amountCents)}`).join("")}${cents.inKindPosting && cents.inKindCents ? `, contrapartida de la especie (${cents.inKindPosting.counterAccount}) ${money(cents.inKindCents)}` : ""} y líquido pendiente de pago (465) ${money(cents.netCents)} al haber.`
            : validation.message}
        </InlineAlert>
      ) : null}

      <AccessibleField className="md:col-span-6" id="slip-notes" label="Notas">
        <Textarea maxLength={2000} onChange={(event) => set({ notes: event.target.value })} value={values.notes} />
      </AccessibleField>

      <RequiredFieldsNote className="md:col-span-6" />
      {error ? <InlineAlert className="md:col-span-6" role="alert" tone="danger">{error}</InlineAlert> : null}
      <FormActions className="md:col-span-6" hint="Puedes guardarla en borrador y contabilizarla después.">
        <Button onClick={() => router.push(`/payroll?period=${values.period}`)} type="button" variant="outline">Cancelar</Button>
        <SubmitButton disabled={pending !== null || !validation.ok} pending={pending === "save"} variant="outline">Guardar borrador</SubmitButton>
        <Button disabled={pending !== null || !validation.ok || !values.employeeId} onClick={() => void submit(true)} type="button">
          {pending === "post" ? "Contabilizando…" : "Guardar y contabilizar"}
        </Button>
      </FormActions>
    </form>
  );
}
