"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField, errorMessage, readApiError, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput, PercentInput } from "@/components/ui/number-input";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDecimalInput, formatMoney, parseDecimalInput } from "@/lib/format";
import { CAPITAL_INCOME_WITHHOLDING_RATE, proposeWithholdingCents } from "@/server/payroll/model";

type CapitalIncomeFormProps = {
  banks: Array<{ id: string; bankName: string; iban: string | null }>;
  currencyCode: string;
  today: string;
};

const amountOf = (value: string) => parseDecimalInput(value, { maximumFractionDigits: 2 }) ?? 0;

/** Alta de un dividendo o un interés pagado: calcula la retención al 19 % y crea el asiento. */
export function CapitalIncomeForm({ banks, currencyCode, today }: CapitalIncomeFormProps) {
  const router = useRouter();
  const [values, setValues] = useState({
    recipientName: "",
    recipientTaxId: "",
    kind: "dividend",
    paymentDate: today,
    grossAmount: "",
    withholdingRate: String(CAPITAL_INCOME_WITHHOLDING_RATE),
    withholdingAmount: "",
    bankAccountId: banks[0]?.id ?? "",
    notes: "",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const set = (patch: Partial<typeof values>) => setValues((current) => ({ ...current, ...patch }));

  const gross = amountOf(values.grossAmount);
  const rate = parseDecimalInput(values.withholdingRate) ?? 0;
  const proposed = proposeWithholdingCents(Math.round(gross * 100), rate) / 100;
  // Mientras no se toque a mano, la retención sigue al importe y al tipo.
  const withholding = touched ? amountOf(values.withholdingAmount) : proposed;

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/payroll/capital-income", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          recipientName: values.recipientName,
          recipientTaxId: values.recipientTaxId || null,
          kind: values.kind,
          paymentDate: values.paymentDate,
          grossAmount: gross,
          withholdingRate: rate,
          withholdingAmount: withholding,
          bankAccountId: values.bankAccountId || null,
          notes: values.notes || null,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo registrar el rendimiento."));
      toast.success("Rendimiento registrado y contabilizado.");
      setValues((current) => ({ ...current, recipientName: "", recipientTaxId: "", grossAmount: "", withholdingAmount: "", notes: "" }));
      setTouched(false);
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught, "No se pudo registrar el rendimiento."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="grid gap-3 md:grid-cols-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <AccessibleField className="md:col-span-2" id="capital-kind" label="Tipo" required>
        <Select onChange={(event) => set({ kind: event.target.value })} value={values.kind}>
          <option value="dividend">Dividendo a un socio</option>
          <option value="interest">Intereses de un préstamo</option>
        </Select>
      </AccessibleField>
      <AccessibleField className="md:col-span-3" id="capital-recipient" label="Perceptor" required>
        <Input maxLength={200} onChange={(event) => set({ recipientName: event.target.value })} required value={values.recipientName} />
      </AccessibleField>
      <AccessibleField className="md:col-span-1" helperText="Imprescindible para el 193." id="capital-tax-id" label="NIF">
        <Input maxLength={20} onChange={(event) => set({ recipientTaxId: event.target.value })} value={values.recipientTaxId} />
      </AccessibleField>

      <AccessibleField className="md:col-span-1" helperText="Decide el periodo del 123." id="capital-date" label="Fecha de pago" required>
        <Input onChange={(event) => set({ paymentDate: event.target.value })} required type="date" value={values.paymentDate} />
      </AccessibleField>
      <AccessibleField className="md:col-span-1" id="capital-gross" label="Importe íntegro" required>
        <MoneyInput onChange={(event) => set({ grossAmount: event.target.value })} placeholder="0,00" required value={values.grossAmount} />
      </AccessibleField>
      <AccessibleField className="md:col-span-1" id="capital-rate" label="Retención">
        <PercentInput onChange={(event) => set({ withholdingRate: event.target.value })} value={values.withholdingRate} />
      </AccessibleField>
      <AccessibleField className="md:col-span-1" helperText={`Líquido: ${formatMoney(gross - withholding, currencyCode)}.`} id="capital-withholding" label="Importe retenido">
        <MoneyInput
          onChange={(event) => {
            setTouched(true);
            set({ withholdingAmount: event.target.value });
          }}
          placeholder="0,00"
          value={touched ? values.withholdingAmount : proposed ? formatDecimalInput(proposed, { minimumFractionDigits: 2 }) : ""}
        />
      </AccessibleField>
      <AccessibleField className="md:col-span-2" helperText="De dónde sale el líquido." id="capital-bank" label="Cuenta bancaria">
        <Select onChange={(event) => set({ bankAccountId: event.target.value })} value={values.bankAccountId}>
          <option value="">Bancos por defecto</option>
          {banks.map((bank) => (
            <option key={bank.id} value={bank.id}>{bank.bankName}{bank.iban ? ` · ${bank.iban.slice(-4)}` : ""}</option>
          ))}
        </Select>
      </AccessibleField>

      <p className="text-xs text-muted-foreground md:col-span-6">
        {values.kind === "dividend"
          ? "Asiento: dividendo activo a pagar (526) al debe por el íntegro; retenciones (4751) y banco al haber. El acuerdo de reparto (resultado o reservas a la 526) lo contabilizas tú al aprobarlo."
          : "Asiento: intereses de deudas (662) al debe por el íntegro; retenciones (4751) y banco al haber."}
      </p>
      {error ? <InlineAlert className="md:col-span-6" role="alert" tone="danger">{error}</InlineAlert> : null}
      <div className="md:col-span-6">
        <SubmitButton disabled={gross <= 0} pending={pending} pendingLabel="Registrando…">Registrar y contabilizar</SubmitButton>
      </div>
    </form>
  );
}

/** Botón «Eliminar» de un rendimiento: anula su asiento. */
export function DeleteCapitalIncomeButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const response = await fetch(`/api/payroll/capital-income/${id}`, { method: "DELETE", headers: getCsrfHeader() });
          if (!response.ok) throw new Error(await readApiError(response, "No se pudo eliminar el rendimiento."));
          toast.success("Rendimiento eliminado y asiento anulado.");
          router.refresh();
        } catch (caught) {
          toast.error(errorMessage(caught, "No se pudo eliminar el rendimiento."));
        } finally {
          setBusy(false);
        }
      }}
      size="xs"
      type="button"
      variant="outline"
    >
      {busy ? "Eliminando…" : "Eliminar"}
    </Button>
  );
}
