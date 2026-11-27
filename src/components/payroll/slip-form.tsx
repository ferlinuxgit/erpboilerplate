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
import { expectedNetCents, proposeWithholdingCents, slipCents, validateSlip } from "@/server/payroll/model";

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
  const [values, setValues] = useState(initialValues);
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
  };
  const cents = slipCents(amounts);
  const expected = expectedNetCents(cents);
  const validation = validateSlip(cents);
  const hasAmounts = cents.grossCents > 0 || cents.inKindCents > 0;
  const money = (value: number) => formatMoney(value / 100, currencyCode);

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
        body: JSON.stringify({ employeeId: values.employeeId, period: values.period, concept: values.concept || "Nómina", ...amounts, notes: values.notes || null, post }),
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
      <AccessibleField className="md:col-span-2" helperText="Cámbialo para una paga extra del mismo mes." id="slip-concept" label="Concepto">
        <Input maxLength={60} onChange={(event) => set({ concept: event.target.value })} placeholder="Nómina" value={values.concept} />
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

      {hasAmounts ? (
        <InlineAlert className="md:col-span-6" title={validation.ok ? "La nómina cuadra" : "La nómina no cuadra"} tone={validation.ok ? "success" : "warning"}>
          {validation.ok
            ? `Asiento: sueldos (640) ${money(cents.grossCents)}${cents.employerSocialSecurityCents ? ` y Seguridad Social de la empresa (642) ${money(cents.employerSocialSecurityCents)}` : ""} al debe; retenciones (4751) ${money(cents.withholdingCents + cents.inKindWithholdingCents)}, Seguridad Social (476) ${money(cents.employeeSocialSecurityCents + cents.employerSocialSecurityCents)}${cents.advancesCents ? `, anticipos (460) ${money(cents.advancesCents)}` : ""} y líquido pendiente de pago (465) ${money(cents.netCents)} al haber.`
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
