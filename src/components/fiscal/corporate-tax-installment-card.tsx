"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { DecimalInput } from "@/components/ui/number-input";
import { InlineAlert, PageSection } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableRow } from "@/components/ui/table";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/format";
import { INSTALLMENT_METHOD_LABELS, type BaseInstallmentResult, type InstallmentMethod } from "@/server/corporate-tax/installments-model";
import type { InstallmentsView, InstallmentView } from "@/server/corporate-tax/service";
import { formatIsoDate } from "@/server/fixed-assets/schedule";

type Props = {
  bankAccounts: InstallmentsView["bankAccounts"];
  canPost: boolean;
  canWrite: boolean;
  currencyCode: string;
  fiscalYearId: string;
  initial: InstallmentView;
  methodLocked: boolean;
  today: string;
  yearClosed: boolean;
};

const toCents = (value: number | null) => Math.max(Math.round((value ?? 0) * 100), 0);
const pct = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });
const SOURCE_LABELS = {
  filed: "de la liquidación presentada",
  live: "de la liquidación calculada (aún sin marcar como presentada)",
  manual: "indicada a mano",
  none: "sin datos: indica la base a mano",
} as const;

/** Un periodo del modelo 202: modalidad, cálculo, presentación y asiento del pago. */
/** Casillas del modelo 202 para entidades con más de un porcentaje: base, porcentaje e importe de cada tipo. */
const MULTI_RATE_BOXES: ReadonlyArray<readonly [string, string, string]> = [["20", "21", "22"], ["23", "24", "25"], ["61", "62", "63"], ["64", "65", "66"]];

/** Los cálculos guardados antes de agrupar porcentajes no traen `groupedBrackets`. */
function groupedOf(result: { brackets: BaseInstallmentResult["brackets"]; groupedBrackets?: BaseInstallmentResult["groupedBrackets"] }) {
  return result.groupedBrackets ?? result.brackets;
}

export function CorporateTaxInstallmentCard({ bankAccounts, canPost, canWrite, currencyCode, fiscalYearId, initial, methodLocked, today, yearClosed }: Props) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [method, setMethod] = useState<InstallmentMethod>(initial.method);
  const [inputs, setInputs] = useState(initial.inputs);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState("");
  const [payDate, setPayDate] = useState(today < initial.dueDate ? today : initial.dueDate);
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id ?? "");
  const sequence = useRef(0);
  const money = (cents: number) => formatMoney(cents / 100, currencyCode);
  const base = `/api/corporate-tax/installments/${encodeURIComponent(fiscalYearId)}/${view.period}`;
  const filed = view.status === "filed";
  const editable = canWrite && !filed;
  const body = { method, ...inputs };

  function update(patch: Partial<typeof inputs>) {
    setInputs((current) => ({ ...current, ...patch }));
    setDirty(true);
  }

  useEffect(() => {
    if (!dirty) return;
    const current = ++sequence.current;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${base}/preview`, { method: "POST", headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: JSON.stringify({ method, ...inputs }) });
        if (!response.ok) throw new Error(await readApiError(response, "No se pudo recalcular el pago fraccionado."));
        const next: InstallmentsView = await response.json();
        const period = next.periods.find((entry) => entry.period === view.period);
        if (current === sequence.current && period) {
          setView({ ...period, status: view.status, payment: view.payment, saved: view.saved, filingReceiptNumber: view.filingReceiptNumber });
          setError(null);
        }
      } catch (caught) {
        if (current === sequence.current) setError(errorMessage(caught, "No se pudo recalcular el pago fraccionado."));
      }
    }, 450);
    return () => window.clearTimeout(timer);
    // Solo se recalcula cuando cambian los datos del formulario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, dirty, inputs, method]);

  async function call(action: string, url: string, httpMethod: string, payload: unknown, success: string) {
    setBusy(action);
    setError(null);
    try {
      sequence.current += 1;
      const response = await fetch(url, { method: httpMethod, headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: payload === undefined ? undefined : JSON.stringify(payload) });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo completar la operación."));
      const next: InstallmentsView = await response.json();
      const period = next.periods.find((entry) => entry.period === view.period);
      if (period) {
        setView(period);
        setInputs(period.inputs);
        setMethod(period.method);
      }
      setDirty(false);
      toast.success(success);
      router.refresh();
      return true;
    } catch (caught) {
      setError(errorMessage(caught, "No se pudo completar la operación."));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const save = () => call("save", base, "PUT", body, "Pago fraccionado guardado.");

  async function pay() {
    if ((dirty || !view.saved) && !(await save())) return;
    await call("pay", `${base}/payment`, "POST", { date: payDate, bankAccountId: bankAccountId || null }, "Pago contabilizado.");
  }

  const result = method === "base" ? view.base : view.quota;
  const badge = view.payment ? { tone: "success" as const, label: "Pagado" } : filed ? { tone: "info" as const, label: "Presentado" } : view.saved ? { tone: "neutral" as const, label: "Guardado" } : { tone: "neutral" as const, label: "Sin guardar" };

  return (
    <PageSection
      actions={<StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>}
      description={`Modelo 202 · periodo ${view.periodCode} · del 1 al ${formatIsoDate(view.dueDate)}`}
      title={view.label}
    >
      <div className="space-y-3">
        {error ? <InlineAlert role="alert" tone="danger">{error}</InlineAlert> : null}
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-3">
            <AccessibleField
              helperText={methodLocked ? "Obligatoria: la cifra de negocios supera 6 millones." : "La modalidad sobre la base se elige en la declaración censal (modelo 036) en febrero y vincula a todos los pagos del año."}
              id={`ct-inst-method-${view.period}`}
              label="Modalidad"
            >
              <Select disabled={!editable || methodLocked} onChange={(event) => { setMethod(event.target.value as InstallmentMethod); setDirty(true); }} value={method}>
                {(Object.keys(INSTALLMENT_METHOD_LABELS) as InstallmentMethod[]).map((option) => <option key={option} value={option}>{INSTALLMENT_METHOD_LABELS[option]}</option>)}
              </Select>
            </AccessibleField>

            {method === "quota" ? (
              <AccessibleField
                helperText={`Cuota íntegra menos deducciones, bonificaciones y retenciones del ejercicio ${view.quotaReference.yearCode ?? "de referencia"} (el último con el plazo de declaración vencido el día 1 del mes de pago). Ahora: ${money(view.quotaReference.baseCents)}, ${SOURCE_LABELS[view.quotaReference.source]}. Déjalo vacío para usar la liquidación del programa.`}
                id={`ct-inst-quota-base-${view.period}`}
                label="Base del pago fraccionado [01]"
              >
                <DecimalInput
                  adornment="€"
                  disabled={!editable}
                  onValueChange={(value, raw) => update({ quotaBaseCents: raw.trim() === "" || value === null ? null : toCents(value) })}
                  placeholder="Según la liquidación"
                  value={inputs.quotaBaseCents === null ? "" : inputs.quotaBaseCents / 100}
                />
              </AccessibleField>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <AccessibleField helperText="Gastos no deducibles del periodo." id={`ct-inst-inc-${view.period}`} label="Ajustes positivos">
                  <DecimalInput adornment="€" disabled={!editable} minimumFractionDigits={2} onValueChange={(value) => update({ increasesCents: toCents(value) })} value={inputs.increasesCents / 100} />
                </AccessibleField>
                <AccessibleField helperText="Ingresos que no tributan en el periodo." id={`ct-inst-dec-${view.period}`} label="Ajustes negativos">
                  <DecimalInput adornment="€" disabled={!editable} minimumFractionDigits={2} onValueChange={(value) => update({ decreasesCents: toCents(value) })} value={inputs.decreasesCents / 100} />
                </AccessibleField>
                <AccessibleField helperText="Vacío: el máximo permitido." id={`ct-inst-loss-${view.period}`} label="Bases negativas a compensar [14]">
                  <DecimalInput adornment="€" disabled={!editable} onValueChange={(value, raw) => update({ lossCompensationCents: raw.trim() === "" || value === null ? null : toCents(value) })} placeholder="El máximo" value={inputs.lossCompensationCents === null ? "" : inputs.lossCompensationCents / 100} />
                </AccessibleField>
                <AccessibleField id={`ct-inst-bonus-${view.period}`} label="Bonificaciones [27]">
                  <DecimalInput adornment="€" disabled={!editable} minimumFractionDigits={2} onValueChange={(value) => update({ bonusesCents: toCents(value) })} value={inputs.bonusesCents / 100} />
                </AccessibleField>
                <AccessibleField className="sm:col-span-2" helperText={`Según la cuenta 473 hasta el ${formatIsoDate(view.coveredUntil)}: ${money(view.facts.ledgerWithholdingsCents)}. Vacío: ese importe.`} id={`ct-inst-wh-${view.period}`} label="Retenciones e ingresos a cuenta [28]">
                  <DecimalInput adornment="€" disabled={!editable} onValueChange={(value, raw) => update({ withholdingsCents: raw.trim() === "" || value === null ? null : toCents(value) })} placeholder="Según la contabilidad" value={inputs.withholdingsCents === null ? "" : inputs.withholdingsCents / 100} />
                </AccessibleField>
              </div>
            )}
          </div>

          <div>
            <TableContainer label={`Cálculo del ${view.label}`}>
              <Table className="[&_td:last-child]:whitespace-nowrap [&_td:last-child]:text-right [&_td:last-child]:font-mono">
                <TableBody>
                  {result.method === "quota" ? (
                    <>
                      <TableRow><TableCell>Base del pago fraccionado [01]</TableCell><TableCell>{money(result.baseCents)}</TableCell></TableRow>
                      <TableRow><TableCell>Porcentaje</TableCell><TableCell>{pct.format(result.pct)} %</TableCell></TableRow>
                    </>
                  ) : (
                    <>
                      <TableRow><TableCell>Resultado contable antes de impuestos hasta el {formatIsoDate(view.coveredUntil)}</TableCell><TableCell>{money(view.facts.accountingResultBeforeTaxCents)}</TableCell></TableRow>
                      <TableRow><TableCell>Base imponible previa [13]</TableCell><TableCell>{money(result.priorBaseCents)}</TableCell></TableRow>
                      <TableRow><TableCell>(−) Bases negativas [14]</TableCell><TableCell>{money(-result.lossesAppliedCents)}</TableCell></TableRow>
                      <TableRow className="bg-window-panel font-bold"><TableCell>Base del pago fraccionado {groupedOf(result).length > 1 ? "[19]" : "[16]"}</TableCell><TableCell>{money(result.baseCents)}</TableCell></TableRow>
                      {groupedOf(result).map((bracket, index, all) => {
                        // Con un solo porcentaje: casillas [16] y [17]; con varios: base, porcentaje e importe de cada tipo (instrucciones del 202).
                        const boxes = all.length > 1 ? MULTI_RATE_BOXES[index] : null;
                        return (
                          <TableRow key={index}>
                            <TableCell className="pl-6 text-xs text-muted-foreground">
                              {pct.format(bracket.pct)} % {boxes ? `[${boxes[1]}]` : "[17]"} sobre {money(bracket.baseCents)}{boxes ? ` [${boxes[0]}]` : ""}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{money(bracket.quotaCents)}{boxes ? ` [${boxes[2]}]` : ""}</TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow><TableCell>(−) Bonificaciones [27]</TableCell><TableCell>{money(-result.bonusesCents)}</TableCell></TableRow>
                      <TableRow><TableCell>(−) Retenciones e ingresos a cuenta [28]</TableCell><TableCell>{money(-result.withholdingsCents)}</TableCell></TableRow>
                      <TableRow><TableCell>(−) Pagos fraccionados anteriores [30]</TableCell><TableCell>{money(-result.previousInstallmentsCents)}</TableCell></TableRow>
                      {result.largeCompany ? <TableRow><TableCell>Mínimo a ingresar [33]</TableCell><TableCell>{money(result.minimumCents)}</TableCell></TableRow> : null}
                    </>
                  )}
                  <TableRow className="bg-window-panel font-bold"><TableCell>A ingresar {result.method === "quota" ? "[03]" : "[34]"}</TableCell><TableCell>{money(result.amountCents)}</TableCell></TableRow>
                </TableBody>
              </Table>
            </TableContainer>
            {result.amountCents === 0 ? <p className="mt-1 text-xs text-muted-foreground">No sale importe a ingresar: en general no hay que presentar el modelo (salvo cifra de negocios superior a 6 millones).</p> : null}
          </div>
        </div>

        {view.payment ? (
          <InlineAlert tone="success">
            Pago de {money(view.payment.amountCents)} contabilizado el {formatIsoDate(view.payment.date)}: (473) a banco.
            {canPost && !yearClosed ? (
              <Button className="ml-2" disabled={busy !== null} onClick={() => void call("unpay", `${base}/payment`, "DELETE", undefined, "Pago anulado.")} size="sm" type="button" variant="outline">
                {busy === "unpay" ? "Anulando…" : "Anular el pago"}
              </Button>
            ) : null}
          </InlineAlert>
        ) : null}

        <div className="flex flex-wrap items-end gap-2 border-t border-window-shadow pt-2">
          {editable ? <Button disabled={busy !== null || (!dirty && view.saved)} onClick={() => void save()} type="button">{busy === "save" ? "Guardando…" : "Guardar cálculo"}</Button> : null}
          {canWrite && !filed ? (
            <>
              <AccessibleField className="w-44" id={`ct-inst-receipt-${view.period}`} label="Justificante (opcional)">
                <Input maxLength={40} onChange={(event) => setReceipt(event.target.value)} value={receipt} />
              </AccessibleField>
              <Button disabled={busy !== null} onClick={() => void call("file", base, "PUT", { ...body, filed: true, receiptNumber: receipt || null }, "Pago fraccionado marcado como presentado.")} type="button" variant="secondary">Marcar como presentado</Button>
            </>
          ) : null}
          {canWrite && filed ? <Button disabled={busy !== null} onClick={() => void call("reopen", base, "PUT", { ...body, filed: false }, "Pago fraccionado reabierto.")} type="button" variant="outline">Reabrir</Button> : null}
          {canPost && !view.payment && !yearClosed && view.amountCents > 0 ? (
            <div className="ml-auto flex flex-wrap items-end gap-2">
              <AccessibleField className="w-40" id={`ct-inst-paydate-${view.period}`} label="Fecha del pago">
                <Input onChange={(event) => setPayDate(event.target.value)} type="date" value={payDate} />
              </AccessibleField>
              {bankAccounts.length > 0 ? (
                <AccessibleField className="w-52" id={`ct-inst-bank-${view.period}`} label="Cuenta bancaria">
                  <Select onChange={(event) => setBankAccountId(event.target.value)} value={bankAccountId}>
                    {bankAccounts.map((bank) => <option key={bank.id} value={bank.id}>{bank.label}</option>)}
                  </Select>
                </AccessibleField>
              ) : null}
              <Button disabled={busy !== null || !payDate} onClick={() => void pay()} type="button">{busy === "pay" ? "Contabilizando…" : `Contabilizar el pago de ${money(view.amountCents)}`}</Button>
            </div>
          ) : null}
        </div>
      </div>
    </PageSection>
  );
}
