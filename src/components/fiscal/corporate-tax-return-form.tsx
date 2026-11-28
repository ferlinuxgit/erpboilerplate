"use client";

import Link from "next/link";
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
import { Table, TableBody, TableCell, TableContainer, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate, formatMoney } from "@/lib/format";
import { ADJUSTMENT_CATALOG, ADJUSTMENT_NATURE_LABELS, findAdjustmentCatalogEntry } from "@/server/corporate-tax/adjustments-catalog";
import type { AdjustmentNature, AdjustmentSign } from "@/server/corporate-tax/liquidation";
import { CORPORATE_TAX_REGIME_LABELS, CORPORATE_TAX_REGIMES, type CorporateTaxRegime } from "@/server/corporate-tax/rates";
import type { CorporateTaxView } from "@/server/corporate-tax/service";
import { liquidationRows } from "@/server/corporate-tax/summary";
import { formatIsoDate } from "@/server/fixed-assets/schedule";

type Inputs = CorporateTaxView["inputs"];

type Props = {
  canWrite: boolean;
  /** Permiso para generar asientos (contabilidad). */
  canPost: boolean;
  currencyCode: string;
  initialView: CorporateTaxView;
};

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const toCents = (value: number | null) => Math.round((value ?? 0) * 100);
const pct = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });

/**
 * Asistente de la liquidación del Impuesto sobre Sociedades de un ejercicio: tipo de gravamen,
 * ajustes extracontables, reducciones, bases negativas, deducciones y pagos a cuenta, con el
 * recorrido del resultado contable a la cuota diferencial recalculado mientras se edita.
 */
export function CorporateTaxReturnForm({ canWrite, canPost, currencyCode, initialView }: Props) {
  const router = useRouter();
  const [view, setView] = useState(initialView);
  const [inputs, setInputs] = useState<Inputs>(initialView.inputs);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState("");
  const previewSeq = useRef(0);
  const money = (cents: number) => formatMoney(cents / 100, currencyCode);
  const filed = view.status === "filed";
  const editable = canWrite && !filed;
  const base = `/api/corporate-tax/returns/${encodeURIComponent(view.year.id)}`;

  function update(patch: Partial<Inputs>) {
    setInputs((current) => ({ ...current, ...patch }));
    setDirty(true);
  }

  // Vista previa: recalcula en el servidor (con los saldos del libro) poco después de cada cambio.
  useEffect(() => {
    if (!dirty) return;
    const sequence = ++previewSeq.current;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${base}/preview`, { method: "POST", headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: JSON.stringify(inputs) });
        if (!response.ok) throw new Error(await readApiError(response, "No se pudo recalcular la liquidación."));
        const next: CorporateTaxView = await response.json();
        if (sequence === previewSeq.current) {
          setView(next);
          setError(null);
        }
      } catch (caught) {
        if (sequence === previewSeq.current) setError(errorMessage(caught, "No se pudo recalcular la liquidación."));
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [base, dirty, inputs]);

  async function call(action: string, url: string, method: string, body: unknown, success: string) {
    setBusy(action);
    setError(null);
    try {
      previewSeq.current += 1;
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo completar la operación."));
      const next: CorporateTaxView = await response.json();
      setView(next);
      setInputs(next.inputs);
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

  const save = () => call("save", base, "PUT", inputs, "Liquidación guardada.");

  async function postEntry() {
    if (dirty && !(await save())) return;
    await call("post", `${base}/entry`, "POST", undefined, "Impuesto sobre Sociedades contabilizado.");
  }

  async function markFiled() {
    if (dirty && !(await save())) return;
    await call("file", `${base}/filing`, "POST", { receiptNumber: receipt || null }, "Liquidación marcada como presentada.");
  }

  function addAdjustment(key: string, preset?: { concept: string; amountCents: number }) {
    const entry = findAdjustmentCatalogEntry(key);
    if (!entry) return;
    update({ adjustments: [...inputs.adjustments, { id: newId(), kind: entry.key, concept: preset?.concept ?? entry.label, sign: entry.sign, amountCents: preset?.amountCents ?? 0, nature: entry.nature }] });
  }

  function patchAdjustment(id: string, patch: Partial<Inputs["adjustments"][number]>) {
    update({ adjustments: inputs.adjustments.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  }

  function patchCredit(id: string, patch: Partial<Inputs["credits"][number]>) {
    update({ credits: inputs.credits.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  }

  const { result, facts } = view;
  const rows = liquidationRows(view);
  const regime = inputs.regime as CorporateTaxRegime;
  const rateText = result.brackets.length > 1
    ? result.schedule.brackets.map((bracket) => `${pct.format(bracket.pct)} %${bracket.upToCents !== null ? ` hasta ${money(bracket.upToCents)}` : " el resto"}`).join(" y ")
    : `${pct.format(result.marginalRatePct)} %`;
  const entryDebit = view.entry.lines.reduce((sum, line) => sum + line.debitCents, 0);

  return (
    <div className="space-y-3">
      <InlineAlert title="El modelo 200 se presenta en la sede de la AEAT con Sociedades WEB" tone="info">
        Este asistente prepara los importes a partir de tu contabilidad y de los ajustes que indiques. No presenta la declaración ni genera su fichero: cuando lo tengas, copia los importes del resumen en Sociedades WEB.
        {" "}Plazo de este ejercicio: del {formatIsoDate(view.window.from)} al {formatIsoDate(view.window.to)}.
      </InlineAlert>

      {filed ? (
        <InlineAlert title="Liquidación marcada como presentada" tone="success">
          Presentada el {view.filedAt ? formatDate(view.filedAt) : "—"}{view.filingReceiptNumber ? ` · justificante ${view.filingReceiptNumber}` : ""}. Los datos están bloqueados; reábrela si necesitas cambiarlos.
        </InlineAlert>
      ) : null}
      {error ? <InlineAlert role="alert" tone="danger">{error}</InlineAlert> : null}
      {view.warnings.length > 0 ? (
        <InlineAlert title="Revisa antes de presentar" tone="warning">
          <ul className="list-disc space-y-1 pl-4">
            {view.warnings.map((warning) => <li key={warning.code}>{warning.message}</li>)}
          </ul>
        </InlineAlert>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)] xl:items-start">
        <div className="space-y-3">
          <PageSection description="Depende de la cifra de negocios del ejercicio anterior." title="1. Tipo de gravamen">
            <div className="grid gap-3 md:grid-cols-2">
              <AccessibleField helperText={`Se aplica el ${rateText} (${result.schedule.source}).`} id="ct-regime" label="Tipo aplicable">
                <Select disabled={!editable} onChange={(event) => update({ regime: event.target.value, customRatePct: event.target.value === "custom" ? inputs.customRatePct ?? 25 : null })} value={regime}>
                  {CORPORATE_TAX_REGIMES.map((option) => (
                    <option key={option} value={option}>{CORPORATE_TAX_REGIME_LABELS[option]}{option === view.suggestedRegime ? " · propuesto" : ""}</option>
                  ))}
                </Select>
              </AccessibleField>
              {regime === "custom" ? (
                <AccessibleField helperText="Para tipos especiales (cooperativas, entidades sin fines lucrativos…)." id="ct-custom-rate" label="Tipo de gravamen">
                  <DecimalInput adornment="%" disabled={!editable} onValueChange={(value) => update({ customRatePct: value ?? 0 })} value={inputs.customRatePct ?? 25} />
                </AccessibleField>
              ) : null}
              <AccessibleField
                helperText={facts.ledgerPriorYearRevenueCents === null ? "El ejercicio anterior no está en el programa: indícala para proponer el tipo." : `Según el libro: ${money(facts.ledgerPriorYearRevenueCents)}. Déjalo vacío para usar ese importe.`}
                id="ct-prior-revenue"
                label="Cifra de negocios del ejercicio anterior"
              >
                <DecimalInput
                  adornment="€"
                  disabled={!editable}
                  onValueChange={(value, raw) => update({ priorYearRevenueCents: raw.trim() === "" || value === null ? null : toCents(value) })}
                  placeholder={facts.ledgerPriorYearRevenueCents === null ? "" : String(facts.ledgerPriorYearRevenueCents / 100)}
                  value={inputs.priorYearRevenueCents === null ? "" : inputs.priorYearRevenueCents / 100}
                />
              </AccessibleField>
            </div>
          </PageSection>

          <PageSection description="Gastos que Hacienda no deja deducir e ingresos que no tributan. Suman o restan al resultado contable." title="2. Ajustes extracontables">
            {view.suggestions.length > 0 && editable ? (
              <InlineAlert className="mb-2" title="Propuestas a partir de tu contabilidad" tone="info">
                <ul className="space-y-1.5">
                  {view.suggestions.map((suggestion) => (
                    <li className="flex flex-wrap items-center justify-between gap-2" key={`${suggestion.kind}-${suggestion.concept}`}>
                      <span className="min-w-0 flex-1">
                        <span className="font-bold">{suggestion.concept}: {money(suggestion.amountCents)}</span>
                        <span className="block font-sans">{suggestion.detail}</span>
                      </span>
                      <Button onClick={() => addAdjustment(suggestion.kind, suggestion)} size="sm" type="button" variant="outline">Añadir</Button>
                    </li>
                  ))}
                </ul>
              </InlineAlert>
            ) : null}
            {inputs.adjustments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin ajustes: la base imponible coincide con el resultado contable.</p>
            ) : (
              <TableContainer label="Ajustes extracontables">
                <Table className="min-w-[46rem]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Concepto</TableHead>
                      <TableHead>Sentido</TableHead>
                      <TableHead>Naturaleza</TableHead>
                      <TableHead className="text-right">Importe</TableHead>
                      <TableHead><span className="sr-only">Acciones</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inputs.adjustments.map((item, index) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <Input aria-label={`Concepto del ajuste ${index + 1}`} disabled={!editable} maxLength={200} onChange={(event) => patchAdjustment(item.id, { concept: event.target.value })} value={item.concept} />
                          {findAdjustmentCatalogEntry(item.kind) ? <span className="mt-0.5 block text-xs text-muted-foreground">{findAdjustmentCatalogEntry(item.kind)?.help}</span> : null}
                        </TableCell>
                        <TableCell>
                          <Select aria-label={`Sentido del ajuste ${index + 1}`} className="w-32" disabled={!editable} onChange={(event) => patchAdjustment(item.id, { sign: event.target.value as AdjustmentSign })} value={item.sign}>
                            <option value="increase">Suma (+)</option>
                            <option value="decrease">Resta (−)</option>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select aria-label={`Naturaleza del ajuste ${index + 1}`} className="w-52" disabled={!editable} onChange={(event) => patchAdjustment(item.id, { nature: event.target.value as AdjustmentNature })} value={item.nature}>
                            {(Object.keys(ADJUSTMENT_NATURE_LABELS) as AdjustmentNature[]).map((nature) => <option key={nature} value={nature}>{ADJUSTMENT_NATURE_LABELS[nature]}</option>)}
                          </Select>
                        </TableCell>
                        <TableCell>
                          <DecimalInput adornment="€" aria-label={`Importe del ajuste ${index + 1}`} disabled={!editable} minimumFractionDigits={2} onValueChange={(value) => patchAdjustment(item.id, { amountCents: Math.max(toCents(value), 0) })} value={item.amountCents / 100} wrapperClassName="ml-auto w-36" />
                        </TableCell>
                        <TableCell className="text-right">
                          {editable ? <Button aria-label={`Quitar el ajuste ${index + 1}`} onClick={() => update({ adjustments: inputs.adjustments.filter((entry) => entry.id !== item.id) })} size="sm" type="button" variant="ghost">Quitar</Button> : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
            {editable ? (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <AccessibleField className="w-full max-w-md" id="ct-add-adjustment" label="Añadir un ajuste habitual">
                  <Select onChange={(event) => { addAdjustment(event.target.value); event.target.value = ""; }} value="">
                    <option value="">Elige un concepto…</option>
                    {ADJUSTMENT_CATALOG.map((entry) => <option key={entry.key} value={entry.key}>{entry.sign === "increase" ? "(+)" : "(−)"} {entry.label}</option>)}
                  </Select>
                </AccessibleField>
              </div>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">
              «Temporaria» significa que el ajuste se compensará en años futuros (por ejemplo, una amortización que Hacienda deja deducir más despacio). Solo esas generan impuesto diferido en el asiento; si dudas, déjalo en «Permanente».
            </p>
          </PageSection>

          <PageSection description="Pérdidas fiscales de años anteriores y reservas que reducen la base." title="3. Bases negativas y reducciones">
            {view.losses.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay bases imponibles negativas pendientes de ejercicios anteriores. Si las hay de antes de usar el programa, anótalas más abajo, en «Bases negativas de ejercicios anteriores».</p>
            ) : (
              <TableContainer label="Bases imponibles negativas pendientes">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ejercicio de origen</TableHead>
                      <TableHead className="text-right">Importe</TableHead>
                      <TableHead className="text-right">Ya compensado</TableHead>
                      <TableHead className="text-right">Pendiente</TableHead>
                      <TableHead className="text-right">Se compensa ahora</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {view.losses.map((loss) => (
                      <TableRow key={loss.originYear}>
                        <TableCell className="font-mono font-semibold">{loss.originYear}</TableCell>
                        <TableCell className="text-right font-mono">{money(loss.originalCents)}</TableCell>
                        <TableCell className="text-right font-mono">{money(loss.appliedCents)}</TableCell>
                        <TableCell className="text-right font-mono">{money(loss.pendingCents)}</TableCell>
                        <TableCell className="text-right font-mono">{money(result.losses.applied.find((entry) => entry.originYear === loss.originYear)?.amountCents ?? 0)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <AccessibleField
                helperText={`Máximo este ejercicio: ${money(result.losses.limitCents)} (70 % de la base previa, con un mínimo de 1 millón). Déjalo vacío para compensar todo lo posible.`}
                id="ct-loss-compensation"
                label="Bases negativas a compensar"
              >
                <DecimalInput
                  adornment="€"
                  disabled={!editable || view.losses.length === 0}
                  onValueChange={(value, raw) => update({ lossCompensationCents: raw.trim() === "" || value === null ? null : Math.max(toCents(value), 0) })}
                  placeholder="El máximo"
                  value={inputs.lossCompensationCents === null ? "" : inputs.lossCompensationCents / 100}
                />
              </AccessibleField>
              <AccessibleField helperText={`Reducción por el aumento de los fondos propios (art. 25). Tope este ejercicio: ${money(result.capitalizationReserve.limitCents)}. Exige dotar una reserva indisponible.`} id="ct-capitalization" label="Reserva de capitalización">
                <DecimalInput adornment="€" disabled={!editable} minimumFractionDigits={2} onValueChange={(value) => update({ capitalizationReserveCents: Math.max(toCents(value), 0) })} value={inputs.capitalizationReserveCents / 100} />
              </AccessibleField>
              {view.proposals.capitalizationReserve && view.proposals.capitalizationReserve.reductionCents > 0 ? (
                <div className="rounded border border-border bg-window-panel p-2 text-xs md:col-span-2">
                  <p className="font-bold">Propuesta de reserva de capitalización: {money(view.proposals.capitalizationReserve.reductionCents)}</p>
                  <p className="mt-0.5 text-muted-foreground">{view.proposals.capitalizationReserve.explanation}</p>
                  {editable && inputs.capitalizationReserveCents !== view.proposals.capitalizationReserve.reductionCents ? (
                    <Button className="mt-1" onClick={() => update({ capitalizationReserveCents: view.proposals.capitalizationReserve?.reductionCents ?? 0 })} size="sm" type="button" variant="outline">Usar la propuesta</Button>
                  ) : null}
                </div>
              ) : null}
              <AccessibleField helperText={`Solo entidades de reducida dimensión (art. 105): hasta el 10 % de la base. Tope este ejercicio: ${money(result.leveling.reductionLimitCents)}.`} id="ct-leveling-reduction" label="Reserva de nivelación: minoración">
                <DecimalInput adornment="€" disabled={!editable} minimumFractionDigits={2} onValueChange={(value) => update({ levelingReductionCents: Math.max(toCents(value), 0) })} value={inputs.levelingReductionCents / 100} />
              </AccessibleField>
              <AccessibleField helperText="Minoraciones de años anteriores que toca sumar ahora (por base negativa o al cumplirse cinco años)." id="ct-leveling-addition" label="Reserva de nivelación: adición">
                <DecimalInput adornment="€" disabled={!editable} minimumFractionDigits={2} onValueChange={(value) => update({ levelingAdditionCents: Math.max(toCents(value), 0) })} value={inputs.levelingAdditionCents / 100} />
              </AccessibleField>
            </div>
            <label className="mt-3 flex items-start gap-2 text-sm" htmlFor="ct-loss-credit">
              <input checked={inputs.recognizeLossCredit === true} className="mt-0.5 size-4" disabled={!editable} id="ct-loss-credit" onChange={(event) => update({ recognizeLossCredit: event.target.checked })} type="checkbox" />
              <span>
                Registrar el crédito fiscal por bases negativas (cuenta 4745)
                <span className="block text-xs text-muted-foreground">
                  Opcional. Solo si es probable que la sociedad tenga beneficios para compensarlas (norma 13.ª del PGC). El asiento reconoce la base negativa del año al tipo del impuesto y da de baja lo que se compensa ahora, hasta el saldo de la 4745.
                  {view.lossCredit ? ` Este año: se reconocen ${money(view.lossCredit.recognizeCents)} y se aplican ${money(view.lossCredit.reverseCents)} (saldo de la 4745: ${money(view.lossCredit.ledgerBalanceCents)}).` : ""}
                </span>
              </span>
            </label>
          </PageSection>

          <PageSection description="Restan de la cuota íntegra: donativos, I+D, creación de empleo, doble imposición…" title="4. Bonificaciones y deducciones">
            {inputs.credits.length === 0 ? <p className="text-sm text-muted-foreground">Sin bonificaciones ni deducciones.</p> : (
              <ul className="space-y-2">
                {inputs.credits.map((credit, index) => (
                  <li className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-center" key={credit.id}>
                    <Input aria-label={`Concepto de la deducción ${index + 1}`} disabled={!editable} maxLength={200} onChange={(event) => patchCredit(credit.id, { concept: event.target.value })} placeholder="Concepto" value={credit.concept} />
                    <DecimalInput adornment="€" aria-label={`Importe de la deducción ${index + 1}`} disabled={!editable} minimumFractionDigits={2} onValueChange={(value) => patchCredit(credit.id, { amountCents: Math.max(toCents(value), 0) })} value={credit.amountCents / 100} />
                    {editable ? <Button onClick={() => update({ credits: inputs.credits.filter((entry) => entry.id !== credit.id) })} size="sm" type="button" variant="ghost">Quitar</Button> : <span />}
                  </li>
                ))}
              </ul>
            )}
            {editable ? <Button className="mt-2" onClick={() => update({ credits: [...inputs.credits, { id: newId(), concept: "Deducción", amountCents: 0 }] })} size="sm" type="button" variant="outline">Añadir deducción o bonificación</Button> : null}
          </PageSection>

          <PageSection description="Lo que ya has adelantado a Hacienda a cuenta de este impuesto." title="5. Retenciones y pagos a cuenta">
            <div className="grid gap-3 md:grid-cols-2">
              <AccessibleField
                helperText={`Según la cuenta 473: ${money(Math.max(facts.ledgerWithholdingsCents, 0))} (saldo de ${money(facts.account473Cents)} menos los pagos fraccionados). Déjalo vacío para usar ese importe.`}
                id="ct-withholdings"
                label="Retenciones e ingresos a cuenta"
              >
                <DecimalInput
                  adornment="€"
                  disabled={!editable}
                  onValueChange={(value, raw) => update({ withholdingsOverrideCents: raw.trim() === "" || value === null ? null : Math.max(toCents(value), 0) })}
                  placeholder="Según la contabilidad"
                  value={inputs.withholdingsOverrideCents === null ? "" : inputs.withholdingsOverrideCents / 100}
                />
              </AccessibleField>
              <AccessibleField
                helperText={`Pagos del modelo 202 contabilizados en el programa: ${money(facts.installmentsPaidCents)}. Déjalo vacío para usar ese importe.`}
                id="ct-installments"
                label="Pagos fraccionados del ejercicio"
              >
                <DecimalInput
                  adornment="€"
                  disabled={!editable}
                  onValueChange={(value, raw) => update({ installmentsOverrideCents: raw.trim() === "" || value === null ? null : Math.max(toCents(value), 0) })}
                  placeholder="Según la contabilidad"
                  value={inputs.installmentsOverrideCents === null ? "" : inputs.installmentsOverrideCents / 100}
                />
              </AccessibleField>
            </div>
            <p className="mt-2 text-xs">
              <Link className="text-link hover:underline" href={`/fiscal/sociedades/pagos-fraccionados?year=${encodeURIComponent(view.year.id)}`}>Ver los pagos fraccionados (modelo 202) de este ejercicio</Link>
            </p>
          </PageSection>

          {editable ? (
            <div className="flex flex-wrap items-center justify-end gap-2 rounded-surface border border-window-dark-shadow bg-window-panel p-2.5">
              <p className="mr-auto text-xs text-muted-foreground">{dirty ? "Hay cambios sin guardar. El cálculo de la derecha ya los tiene en cuenta." : "Sin cambios pendientes."}</p>
              <Button disabled={busy !== null || !dirty} onClick={() => void save()} type="button">{busy === "save" ? "Guardando…" : "Guardar liquidación"}</Button>
            </div>
          ) : null}
        </div>

        <div className="space-y-3 xl:sticky xl:top-2">
          <PageSection description={`Ejercicio ${view.year.code}`} title="Del resultado contable a la cuota">
            <TableContainer label="Liquidación">
              <Table className="[&_td:last-child]:whitespace-nowrap">
                <TableBody>
                  {rows.map((row) => (
                    <TableRow className={row.kind === "total" ? "bg-window-panel font-bold" : undefined} key={row.key}>
                      <TableCell className={row.kind === "detail" ? "pl-6 text-xs text-muted-foreground" : undefined}>
                        {row.label}
                        {row.box ? <span className="ml-1 whitespace-nowrap font-mono text-[10px] font-normal text-muted-foreground" title={`Casilla ${row.box.box} de la página ${row.box.page} del modelo 200`}>[{row.box.box}]</span> : null}
                      </TableCell>
                      <TableCell className={`text-right font-mono ${row.kind === "detail" ? "text-xs text-muted-foreground" : ""}`}>{money(row.cents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <p className={`mt-2 rounded-control border p-2 text-center font-mono text-sm font-bold ${result.outcome === "toRefund" ? "border-success bg-success/10 text-success-text" : "border-window-dark-shadow bg-window-highlight"}`}>
              {result.outcome === "toPay" ? `A ingresar: ${money(result.differentialCents)}` : result.outcome === "toRefund" ? `A devolver: ${money(-result.differentialCents)}` : "Cuota diferencial cero"}
            </p>
          </PageSection>

          <PageSection description="Comprueba que la liquidación cuadra con el libro." title="Conciliación con la contabilidad">
            <TableContainer label="Conciliación">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Concepto</TableHead>
                    <TableHead className="text-right">Contabilidad</TableHead>
                    <TableHead className="text-right">Liquidación</TableHead>
                    <TableHead className="text-right">Diferencia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.reconciliation.map((row) => (
                    <TableRow key={row.label}>
                      <TableCell>{row.label}<span className="block text-xs text-muted-foreground">{row.help}</span></TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono">{money(row.ledgerCents)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono">{money(row.liquidationCents)}</TableCell>
                      <TableCell className={`whitespace-nowrap text-right font-mono ${row.differenceCents !== 0 ? "font-bold text-warning-text" : ""}`}>{row.differenceCents === 0 ? "—" : money(row.differenceCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </PageSection>

          <PageSection
            actions={view.entry.posted ? <StatusBadge tone={view.entry.upToDate ? "success" : "warning"}>{view.entry.upToDate ? "Contabilizado" : "Desactualizado"}</StatusBadge> : <StatusBadge tone="neutral">Sin contabilizar</StatusBadge>}
            description={`Con fecha ${formatIsoDate(view.year.end)}, antes del cierre.`}
            title="Asiento del impuesto"
          >
            {view.entry.lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay asiento que hacer: no sale cuota ni hay retenciones o pagos a cuenta que regularizar.</p>
            ) : (
              <TableContainer label="Asiento del impuesto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cuenta</TableHead>
                      <TableHead className="text-right">Debe</TableHead>
                      <TableHead className="text-right">Haber</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {view.entry.lines.map((line, index) => (
                      <TableRow key={`${index}-${line.role}`}>
                        <TableCell><span className="font-mono font-semibold">{line.accountCode}</span> <span className="text-xs text-muted-foreground">{line.concept.split(" · ")[1] ?? line.concept}</span></TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono">{line.debitCents ? money(line.debitCents) : ""}</TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono">{line.creditCents ? money(line.creditCents) : ""}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell>Total</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono">{money(entryDebit)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono">{money(entryDebit)}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </TableContainer>
            )}
            {view.year.isClosed ? <p className="mt-2 text-xs text-muted-foreground">El ejercicio está cerrado: para contabilizar o cambiar el impuesto hay que reabrirlo desde Contabilidad.</p> : null}
            {canPost && !view.year.isClosed ? (
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                {view.entry.posted ? (
                  <Button disabled={busy !== null} onClick={() => void call("unpost", `${base}/entry`, "DELETE", undefined, "Asiento del impuesto anulado.")} type="button" variant="outline">
                    {busy === "unpost" ? "Anulando…" : "Anular el asiento"}
                  </Button>
                ) : null}
                {view.entry.lines.length > 0 && !(view.entry.posted && view.entry.upToDate && !dirty) ? (
                  <Button disabled={busy !== null} onClick={() => void postEntry()} type="button">
                    {busy === "post" ? "Contabilizando…" : view.entry.posted ? "Actualizar el asiento" : "Contabilizar el impuesto"}
                  </Button>
                ) : null}
              </div>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">Se puede repetir: si la liquidación cambia, el asiento anterior se anula con un contraasiento y se genera el nuevo.</p>
          </PageSection>

          <PageSection description="Cuando la hayas presentado en Sociedades WEB." title="Presentación">
            <div className="flex flex-wrap gap-2">
              <Link className="text-sm text-link hover:underline" href={`/fiscal/sociedades/resumen?year=${encodeURIComponent(view.year.id)}`}>Resumen para Sociedades WEB (imprimir o exportar)</Link>
            </div>
            {canWrite && !filed ? (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <AccessibleField className="min-w-48 flex-1" helperText="Opcional." id="ct-receipt" label="Número de justificante">
                  <Input maxLength={40} onChange={(event) => setReceipt(event.target.value)} value={receipt} />
                </AccessibleField>
                <Button disabled={busy !== null} onClick={() => void markFiled()} type="button" variant="secondary">{busy === "file" ? "Guardando…" : "Marcar como presentada"}</Button>
              </div>
            ) : null}
            {canWrite && filed ? (
              <Button className="mt-2" disabled={busy !== null} onClick={() => void call("reopen", `${base}/filing`, "DELETE", undefined, "Liquidación reabierta.")} type="button" variant="outline">
                {busy === "reopen" ? "Reabriendo…" : "Reabrir la liquidación"}
              </Button>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">Al marcarla se guarda una foto del cálculo. Si sale una base negativa, queda registrada para compensarla en los ejercicios siguientes.</p>
          </PageSection>
        </div>
      </div>
    </div>
  );
}
