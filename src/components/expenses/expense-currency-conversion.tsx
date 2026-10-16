"use client";

import { ArrowsClockwise, CurrencyEur } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { AccessibleField, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { formatMoney, parseDecimalInput } from "@/lib/format";

import { convertItemCurrency, exchangeNote, undoCurrencyConversion, type BatchItem } from "./expense-batch-model";

type EcbRate = { rate: number; rateDate: string };

const formatRate = (rate: number) => rate.toLocaleString("es-ES", { maximumFractionDigits: 6 });
const formatDate = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Factura en otra moneda: se convierte a la de la empresa con el cambio del BCE del día de la
 * factura (criterio del art. 79.Once LIVA), que se puede sustituir a mano.
 */
export function ExpenseCurrencyConversion({
  baseCurrencyCode,
  disabled,
  item,
  onPatch,
}: {
  baseCurrencyCode: string;
  disabled: boolean;
  item: BatchItem;
  onPatch: (patch: (item: BatchItem) => BatchItem) => void;
}) {
  const foreign = item.currencyCode !== baseCurrencyCode;
  const fromCurrency = item.currencyCode;
  const requestKey = foreign && /^[A-Z]{3}$/.test(fromCurrency) ? `${fromCurrency}:${baseCurrencyCode}:${item.issueDate}` : null;
  const [lookup, setLookup] = useState<{ key: string; ecb?: EcbRate; error?: string } | null>(null);
  const [typed, setTyped] = useState<{ key: string; value: string } | null>(null);

  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();
    const [from, to, date] = requestKey.split(":");
    fetch(`/api/exchange-rates?from=${from}&to=${to}&date=${date}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiError(response, "No se pudo consultar el cambio del BCE: indícalo a mano."));
        setLookup({ key: requestKey, ecb: await response.json() as EcbRate });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setLookup({ key: requestKey, error: reason instanceof Error ? reason.message : "No se pudo consultar el cambio del BCE: indícalo a mano." });
      });
    return () => controller.abort();
  }, [requestKey]);

  const current = lookup && lookup.key === requestKey ? lookup : null;
  const loading = requestKey !== null && current === null;
  const ecb = current?.ecb ?? null;
  const error = current?.error ?? null;
  const rateInput = typed && typed.key === requestKey ? typed.value : ecb ? String(ecb.rate).replace(".", ",") : "";
  const setRateInput = (value: string) => setTyped({ key: requestKey ?? "", value });

  if (!foreign && item.exchange) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border border-window-shadow bg-muted/40 px-3 py-2 text-xs" data-testid={`batch-item-${item.localId}-exchange`}>
        <p>{exchangeNote(item)}</p>
        <Button disabled={disabled} onClick={() => onPatch(undoCurrencyConversion)} size="sm" type="button" variant="ghost">
          <ArrowsClockwise aria-hidden="true" /> Deshacer conversión
        </Button>
      </div>
    );
  }
  if (!foreign) return null;

  const rate = parseDecimalInput(rateInput, { maximumFractionDigits: 6 });
  const validRate = rate !== null && rate > 0;
  const isEcbRate = validRate && ecb !== null && Math.abs(rate - ecb.rate) < 1e-9;
  const total = item.draft?.totalAmount;

  return (
    <div className="space-y-2 border border-warning bg-warning/10 p-3 text-xs" data-testid={`batch-item-${item.localId}-currency`}>
      <p className="font-mono font-bold">Factura en {fromCurrency}: se registra en {baseCurrencyCode}</p>
      <p>
        Se convierte con el cambio oficial del BCE del día de la factura{ecb ? ` (${formatDate(ecb.rateDate)})` : ""}. Si tu asesor usa otro, cámbialo.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <AccessibleField className="w-48" error={error ?? undefined} id={`exchange-rate-${item.localId}`} label={`1 ${fromCurrency} = ? ${baseCurrencyCode}`}>
          <Input disabled={disabled || loading} inputMode="decimal" onChange={(event) => setRateInput(event.target.value)} placeholder={loading ? "Consultando BCE…" : "0,92"} value={rateInput} />
        </AccessibleField>
        <Button
          disabled={disabled || !validRate}
          onClick={() => onPatch((current) => convertItemCurrency(current, baseCurrencyCode, {
            rate: rate ?? 0,
            rateDate: isEcbRate && ecb ? ecb.rateDate : current.issueDate,
            source: isEcbRate ? "BCE" : "manual",
          }))}
          size="sm"
          type="button"
        >
          <CurrencyEur aria-hidden="true" /> Convertir a {baseCurrencyCode}
        </Button>
      </div>
      {validRate && total !== undefined ? (
        <p className="font-mono">{formatMoney(total, fromCurrency)} × {formatRate(rate)} = {formatMoney(Math.round(total * rate * 100) / 100, baseCurrencyCode)}</p>
      ) : null}
    </div>
  );
}
