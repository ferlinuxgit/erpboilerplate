"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/number-input";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDecimalInput, parseDecimalInput } from "@/lib/format";
import type { Modelo190ExtraData } from "@/server/fiscal/withholdings";

type Pair = { total: number; whole: number };
type DisabilityCounts = NonNullable<Modelo190ExtraData["descendantsDisability"]>;

const EMPTY_PAIR: Pair = { total: 0, whole: 0 };
const EMPTY_DISABILITY: DisabilityCounts = { from33: EMPTY_PAIR, reducedMobility: EMPTY_PAIR, from65: EMPTY_PAIR };

type FormState = {
  geographicMobility: boolean;
  housingLoanCommunication: boolean;
  reductions: string;
  deductibleExpenses: string;
  compensatoryPension: string;
  childSupport: string;
  descendantsUnder3: Pair;
  descendantsRest: Pair;
  descendantsDisability: DisabilityCounts;
  ascendantsUnder75: Pair;
  ascendantsFrom75: Pair;
  ascendantsDisability: DisabilityCounts;
  firstThreeChildren: [number, number, number];
};

const moneyText = (cents: number | undefined) => (cents ? formatDecimalInput(cents / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
const toCents = (value: string) => Math.max(Math.round((parseDecimalInput(value, { maximumFractionDigits: 2 }) ?? 0) * 100), 0);

function toForm(data: Modelo190ExtraData | null | undefined): FormState {
  return {
    geographicMobility: data?.geographicMobility ?? false,
    housingLoanCommunication: data?.housingLoanCommunication ?? false,
    reductions: moneyText(data?.reductionsCents),
    deductibleExpenses: moneyText(data?.deductibleExpensesCents),
    compensatoryPension: moneyText(data?.compensatoryPensionCents),
    childSupport: moneyText(data?.childSupportCents),
    descendantsUnder3: data?.descendantsUnder3 ?? EMPTY_PAIR,
    descendantsRest: data?.descendantsRest ?? EMPTY_PAIR,
    descendantsDisability: data?.descendantsDisability ?? EMPTY_DISABILITY,
    ascendantsUnder75: data?.ascendantsUnder75 ?? EMPTY_PAIR,
    ascendantsFrom75: data?.ascendantsFrom75 ?? EMPTY_PAIR,
    ascendantsDisability: data?.ascendantsDisability ?? EMPTY_DISABILITY,
    firstThreeChildren: data?.firstThreeChildren ?? [0, 0, 0],
  };
}

function toData(form: FormState): Modelo190ExtraData {
  return {
    geographicMobility: form.geographicMobility,
    housingLoanCommunication: form.housingLoanCommunication,
    reductionsCents: toCents(form.reductions),
    deductibleExpensesCents: toCents(form.deductibleExpenses),
    compensatoryPensionCents: toCents(form.compensatoryPension),
    childSupportCents: toCents(form.childSupport),
    descendantsUnder3: form.descendantsUnder3,
    descendantsRest: form.descendantsRest,
    descendantsDisability: form.descendantsDisability,
    ascendantsUnder75: form.ascendantsUnder75,
    ascendantsFrom75: form.ascendantsFrom75,
    ascendantsDisability: form.ascendantsDisability,
    firstThreeChildren: form.firstThreeChildren,
  };
}

function PairInputs({ id, label, value, onChange }: { id: string; label: string; value: Pair; onChange: (value: Pair) => void }) {
  const count = (text: string) => Math.min(Math.max(Number.parseInt(text, 10) || 0, 0), 99);
  return (
    <fieldset className="rounded border border-border p-2">
      <legend className="px-1 text-xs font-bold">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        <AccessibleField id={`${id}-total`} label="Total">
          <Input inputMode="numeric" min={0} max={99} onChange={(event) => onChange({ ...value, total: count(event.target.value) })} type="number" value={value.total} />
        </AccessibleField>
        <AccessibleField id={`${id}-whole`} label="Por entero">
          <Input inputMode="numeric" min={0} max={99} onChange={(event) => onChange({ ...value, whole: count(event.target.value) })} type="number" value={value.whole} />
        </AccessibleField>
      </div>
    </fieldset>
  );
}

/**
 * Datos adicionales opcionales de la clave A del 190 (posiciones 170 a 254 de los diseños lógicos de
 * 2025): los que la empresa tuvo en cuenta para el tipo de retención. Se guardan por ejercicio.
 */
export function EmployeeModelo190ExtraForm({ employeeId, stored, years }: { employeeId: string; stored: Record<string, Modelo190ExtraData>; years: number[] }) {
  const router = useRouter();
  const [year, setYear] = useState(years[0]);
  const [form, setForm] = useState<FormState>(() => toForm(stored[String(years[0])]));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));
  const invalidPairs = [form.descendantsUnder3, form.descendantsRest, form.ascendantsUnder75, form.ascendantsFrom75, ...Object.values(form.descendantsDisability), ...Object.values(form.ascendantsDisability)].some((pair) => pair.whole > pair.total);

  async function save(clear: boolean) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/payroll/employees/${employeeId}/model-190`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ year, data: clear ? null : toData(form) }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudieron guardar los datos del 190."));
      if (clear) setForm(toForm(null));
      toast.success(clear ? `Datos del ${year} borrados.` : `Datos del ${year} guardados.`);
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught, "No se pudieron guardar los datos del 190."));
    } finally {
      setPending(false);
    }
  }

  const disability = (key: "descendantsDisability" | "ascendantsDisability", title: string) => (
    <div className="grid gap-2 md:col-span-6 md:grid-cols-3">
      <PairInputs id={`${key}-33`} label={`${title} ≥ 33 % y < 65 %`} onChange={(value) => set({ [key]: { ...form[key], from33: value } })} value={form[key].from33} />
      <PairInputs id={`${key}-mobility`} label={`${title} con movilidad reducida`} onChange={(value) => set({ [key]: { ...form[key], reducedMobility: value } })} value={form[key].reducedMobility} />
      <PairInputs id={`${key}-65`} label={`${title} ≥ 65 %`} onChange={(value) => set({ [key]: { ...form[key], from65: value } })} value={form[key].from65} />
    </div>
  );

  return (
    <form
      className="grid gap-3 md:grid-cols-6"
      onSubmit={(event) => {
        event.preventDefault();
        void save(false);
      }}
    >
      <AccessibleField className="md:col-span-2" helperText="El 190 de un año se presenta en enero del siguiente." id="m190-year" label="Ejercicio">
        <Select
          onChange={(event) => {
            const next = Number(event.target.value);
            setYear(next);
            setForm(toForm(stored[String(next)]));
          }}
          value={year}
        >
          {years.map((option) => <option key={option} value={option}>{option}{stored[String(option)] ? " · con datos" : ""}</option>)}
        </Select>
      </AccessibleField>
      <p className="text-xs text-muted-foreground md:col-span-4">Opcionales. Son los datos que la empresa tuvo en cuenta para calcular la retención (modelo 145); lo que no indiques se declara a cero.</p>

      <AccessibleField className="md:col-span-3" helperText="Art. 18.2 y 18.3 de la Ley del IRPF y disposiciones transitorias 11.ª y 12.ª." id="m190-reductions" label="Reducciones aplicables">
        <MoneyInput onChange={(event) => set({ reductions: event.target.value })} placeholder="0,00" value={form.reductions} />
      </AccessibleField>
      <AccessibleField className="md:col-span-3" helperText="Cotizaciones, cuotas sindicales y colegiales y defensa jurídica considerados para la retención." id="m190-expenses" label="Gastos deducibles">
        <MoneyInput onChange={(event) => set({ deductibleExpenses: event.target.value })} placeholder="0,00" value={form.deductibleExpenses} />
      </AccessibleField>
      <AccessibleField className="md:col-span-3" helperText="Pensión compensatoria al cónyuge fijada por resolución judicial." id="m190-pension" label="Pensiones compensatorias">
        <MoneyInput onChange={(event) => set({ compensatoryPension: event.target.value })} placeholder="0,00" value={form.compensatoryPension} />
      </AccessibleField>
      <AccessibleField className="md:col-span-3" helperText="A favor de los hijos por decisión judicial." id="m190-child-support" label="Anualidades por alimentos">
        <MoneyInput onChange={(event) => set({ childSupport: event.target.value })} placeholder="0,00" value={form.childSupport} />
      </AccessibleField>

      <div className="grid gap-2 md:col-span-6 md:grid-cols-4">
        <PairInputs id="m190-desc-3" label="Descendientes menores de 3 años" onChange={(value) => set({ descendantsUnder3: value })} value={form.descendantsUnder3} />
        <PairInputs id="m190-desc-rest" label="Resto de descendientes" onChange={(value) => set({ descendantsRest: value })} value={form.descendantsRest} />
        <PairInputs id="m190-asc-75" label="Ascendientes menores de 75 años" onChange={(value) => set({ ascendantsUnder75: value })} value={form.ascendantsUnder75} />
        <PairInputs id="m190-asc-from75" label="Ascendientes de 75 años o más" onChange={(value) => set({ ascendantsFrom75: value })} value={form.ascendantsFrom75} />
      </div>
      {disability("descendantsDisability", "Descendientes con discapacidad")}
      {disability("ascendantsDisability", "Ascendientes con discapacidad")}

      <fieldset className="grid gap-2 md:col-span-6 md:grid-cols-3">
        <legend className="text-xs font-bold">Cómputo de los tres primeros hijos</legend>
        {[0, 1, 2].map((index) => (
          <AccessibleField id={`m190-child-${index}`} key={index} label={`Hijo ${index + 1}.º`}>
            <Select
              onChange={(event) => {
                const next = [...form.firstThreeChildren] as [number, number, number];
                next[index] = Number(event.target.value);
                set({ firstThreeChildren: next });
              }}
              value={form.firstThreeChildren[index]}
            >
              <option value={0}>No hay o no consta</option>
              <option value={1}>Computado por entero</option>
              <option value={2}>Computado por mitad</option>
            </Select>
          </AccessibleField>
        ))}
      </fieldset>

      <label className="flex items-start gap-2 text-sm md:col-span-3" htmlFor="m190-mobility">
        <input checked={form.geographicMobility} className="mt-0.5 size-4" id="m190-mobility" onChange={(event) => set({ geographicMobility: event.target.checked })} type="checkbox" />
        <span>Movilidad geográfica (art. 19.2.f de la Ley del IRPF)</span>
      </label>
      <label className="flex items-start gap-2 text-sm md:col-span-3" htmlFor="m190-housing">
        <input checked={form.housingLoanCommunication} className="mt-0.5 size-4" id="m190-housing" onChange={(event) => set({ housingLoanCommunication: event.target.checked })} type="checkbox" />
        <span>Comunicó pagos por la vivienda habitual con préstamo (reducción del tipo, art. 86.1 del Reglamento)</span>
      </label>

      {invalidPairs ? <InlineAlert className="md:col-span-6" tone="warning">Los computados por entero no pueden ser más que el total.</InlineAlert> : null}
      {error ? <InlineAlert className="md:col-span-6" role="alert" tone="danger">{error}</InlineAlert> : null}
      <div className="flex flex-wrap justify-end gap-2 md:col-span-6">
        {stored[String(year)] ? <Button disabled={pending} onClick={() => void save(true)} type="button" variant="outline">Borrar los datos de {year}</Button> : null}
        <Button disabled={pending || invalidPairs} type="submit">{pending ? "Guardando…" : `Guardar los datos de ${year}`}</Button>
      </div>
    </form>
  );
}
