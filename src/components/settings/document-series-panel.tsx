"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";
import { defaultSeriesFormat, previewSeriesFormat } from "@/lib/document-series-format";
import { cn } from "@/lib/utils";

export type DocumentSeriesRow = {
  id: string;
  type: string;
  code: string;
  name: string;
  prefix: string;
  format: string;
  nextNumber: number;
  isDefault: boolean;
  isActive: boolean;
};

/** Tipos de documento con numeración configurable (etiquetas en español). */
export const SERIES_TYPE_OPTIONS = [
  { value: "SALES_INVOICE", label: "Facturas de venta" },
  { value: "CREDIT_NOTE", label: "Facturas rectificativas" },
  { value: "SALES_QUOTE", label: "Presupuestos" },
  { value: "SALES_ORDER", label: "Pedidos de venta" },
  { value: "DELIVERY_NOTE", label: "Albaranes" },
  { value: "PURCHASE_ORDER", label: "Pedidos de compra" },
  { value: "GOODS_RECEIPT", label: "Recepciones de mercancía" },
  { value: "SUPPLIER_INVOICE", label: "Facturas recibidas (registro interno)" },
  { value: "RECEIPT", label: "Cobros" },
  { value: "PAYMENT", label: "Pagos" },
] as const;

type SeriesType = (typeof SERIES_TYPE_OPTIONS)[number]["value"];

/** 409 body when the new next number would skip numbers. */
type SeriesGap = { from: number; to: number; skipped: number; reasonRequired?: boolean };
type SeriesRequest = { method: "POST" | "PATCH"; payload: Record<string, unknown>; success: string; formKey: string; onSaved?: () => void };
type SeriesGapPrompt = { gap: SeriesGap; request: SeriesRequest };
type RowDraft = { name: string; prefix: string; format: string; nextNumber: string };
type FieldErrors = Record<string, string | undefined>;

const MIN_GAP_REASON_LENGTH = 5;
const FORMAT_TOKENS = ["{PREFIX}", "{YYYY}", "{YY}", "{NUMBER:6}", "{NUMBER:4}"];
const panelClass = "space-y-2 border border-window-dark-shadow bg-window-panel p-2.5 shadow-[inset_1px_1px_0_var(--window-highlight)]";

function draftOf(row: DocumentSeriesRow): RowDraft {
  return { name: row.name, prefix: row.prefix, format: row.format || defaultSeriesFormat, nextNumber: String(row.nextNumber) };
}

/** Validación de los campos editables de una serie (mensajes en español). */
export function validateSeriesDraft(draft: { name: string; prefix: string; format: string; nextNumber: string; code?: string }, options: { requireNextNumber: boolean }) {
  const nextNumber = Number(draft.nextNumber);
  const errors: FieldErrors = {
    name: !draft.name.trim() ? "Indica un nombre (por ejemplo, Tickets)." : draft.name.trim().length > 60 ? "Máximo 60 caracteres." : undefined,
    prefix: !draft.prefix.trim() ? "Indica el prefijo (por ejemplo, FA)." : draft.prefix.trim().length > 20 ? "El prefijo no puede superar 20 caracteres." : undefined,
    format: !draft.format.trim() ? "Indica el formato; puedes usar los botones de abajo." : draft.format.trim().length > 80 ? "El formato no puede superar 80 caracteres." : undefined,
    nextNumber: (options.requireNextNumber || draft.nextNumber.trim()) && (!Number.isInteger(nextNumber) || nextNumber < 1) ? "Indica un número entero mayor que 0." : undefined,
  };
  if (draft.code !== undefined) {
    errors.code = !/^[A-Za-z0-9-]{1,10}$/.test(draft.code.trim()) ? "Usa de 1 a 10 letras, números o guiones (por ejemplo, T o EXP)." : undefined;
  }
  return errors;
}

function hasErrors(errors: FieldErrors) {
  return Object.values(errors).some(Boolean);
}

/**
 * Series de numeración del ejercicio activo: varias por tipo (general, tickets, exportación…), una
 * por defecto. Mantiene el aviso de huecos: saltar números exige confirmación y motivo (auditado).
 */
export function DocumentSeriesPanel() {
  const [rows, setRows] = useState<DocumentSeriesRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<SeriesType>("SALES_INVOICE");
  const [pending, setPending] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, FieldErrors>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string | null>>({});
  const [newSeries, setNewSeries] = useState({ code: "", name: "", prefix: "", format: defaultSeriesFormat, nextNumber: "", isDefault: false });
  const [gapPrompt, setGapPrompt] = useState<SeriesGapPrompt | null>(null);
  const [gapReason, setGapReason] = useState("");
  const [gapReasonError, setGapReasonError] = useState<string | undefined>(undefined);

  const [version, setVersion] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const response = await fetch("/api/document-series?fiscalYear=active");
        if (!response.ok) throw new Error(await readApiError(response, "No se pudieron cargar las series."));
        const loaded = (await response.json()) as DocumentSeriesRow[];
        if (ignore) return;
        setRows(loaded);
        setDrafts(Object.fromEntries(loaded.map((row) => [row.id, draftOf(row)])));
      } catch (error) {
        if (!ignore) toast.error(errorMessage(error, "No se pudieron cargar las series de numeración. Recarga la página para intentarlo de nuevo."));
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    void load();
    return () => {
      ignore = true;
    };
  }, [version]);

  const typeRows = rows.filter((row) => row.type === type);
  const typeLabel = SERIES_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
  const busy = pending !== null;

  const setFormError = (key: string, message: string | null) => setFormErrors((current) => ({ ...current, [key]: message }));
  const updateDraft = (id: string, patch: Partial<RowDraft>) => setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));

  /**
   * Envía la petición. Si el nuevo número deja huecos, la API responde 409 con `code: "SERIES_GAP"`:
   * se explica en un diálogo y se reenvía con `confirmGap` y el motivo.
   */
  const send = async (request: SeriesRequest, confirmation?: { gapReason: string }) => {
    setPending(request.formKey);
    setFormError(request.formKey, null);
    try {
      const response = await fetch("/api/document-series", {
        method: request.method,
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(confirmation ? { ...request.payload, confirmGap: true, gapReason: confirmation.gapReason } : request.payload),
      });
      if (response.status === 409) {
        const body = (await response.clone().json().catch(() => null)) as { code?: string; message?: string; gap?: SeriesGap } | null;
        if (body?.code === "SERIES_GAP" && body.gap) {
          setGapPrompt({ gap: body.gap, request });
          if (confirmation) setGapReasonError(body.message ?? "Revisa el motivo del salto.");
          else { setGapReason(""); setGapReasonError(undefined); }
          return;
        }
      }
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar la serie."));
      setGapPrompt(null);
      request.onSaved?.();
      toast.success(confirmation ? `${request.success} El salto queda registrado en la auditoría.` : request.success);
      setVersion((current) => current + 1);
    } catch (error) {
      const message = errorMessage(error, "No se pudo guardar la serie.");
      if (confirmation) setGapReasonError(message);
      else setFormError(request.formKey, message);
      toast.error(message);
    } finally {
      setPending(null);
    }
  };

  const saveRow = (event: React.FormEvent<HTMLFormElement>, row: DocumentSeriesRow) => {
    event.preventDefault();
    const draft = drafts[row.id] ?? draftOf(row);
    const key = `series-${row.id}`;
    const errors = validateSeriesDraft(draft, { requireNextNumber: true });
    setFieldErrors((current) => ({ ...current, [key]: errors }));
    if (hasErrors(errors)) {
      toast.error("Revisa los campos marcados antes de guardar.");
      return;
    }
    void send({
      method: "PATCH",
      formKey: key,
      payload: { id: row.id, name: draft.name, prefix: draft.prefix, format: draft.format, nextNumber: Number(draft.nextNumber) },
      success: `Serie «${draft.name.trim()}» guardada.`,
    });
  };

  const patchRow = (row: DocumentSeriesRow, patch: { isDefault?: boolean; isActive?: boolean }, success: string) => {
    void send({ method: "PATCH", formKey: `series-${row.id}`, payload: { id: row.id, ...patch }, success });
  };

  const createSeries = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors = validateSeriesDraft(newSeries, { requireNextNumber: false });
    setFieldErrors((current) => ({ ...current, "series-new": errors }));
    if (hasErrors(errors)) {
      toast.error("Revisa los campos marcados antes de crear la serie.");
      return;
    }
    void send({
      method: "POST",
      formKey: "series-new",
      payload: {
        type,
        code: newSeries.code.trim().toUpperCase(),
        name: newSeries.name,
        prefix: newSeries.prefix,
        format: newSeries.format,
        ...(newSeries.nextNumber.trim() ? { nextNumber: Number(newSeries.nextNumber) } : {}),
        isDefault: newSeries.isDefault,
      },
      success: `Serie «${newSeries.name.trim()}» creada.`,
      onSaved: () => setNewSeries({ code: "", name: "", prefix: "", format: defaultSeriesFormat, nextNumber: "", isDefault: false }),
    });
  };

  const confirmGap = () => {
    if (!gapPrompt) return;
    const reason = gapReason.trim();
    if (reason.length < MIN_GAP_REASON_LENGTH) {
      setGapReasonError(`Explica el motivo del salto (al menos ${MIN_GAP_REASON_LENGTH} caracteres).`);
      return;
    }
    setGapReasonError(undefined);
    void send(gapPrompt.request, { gapReason: reason });
  };

  const cancelGap = () => {
    if (busy) return;
    setGapPrompt(null);
    setGapReasonError(undefined);
  };

  const newErrors = fieldErrors["series-new"] ?? {};

  return (
    <section aria-labelledby="masters-series-title" className={panelClass}>
      <div className="space-y-0.5">
        <h3 className="font-mono text-sm font-bold" id="masters-series-title">Series de numeración</h3>
        <p className="text-xs text-muted-foreground">
          Usa series distintas para tickets, facturas de exportación o rectificativas: cada serie tiene su propia numeración
          correlativa y el número se asigna al emitir. La serie «por defecto» es la que se usa si no eliges otra.
        </p>
      </div>

      <AccessibleField className="max-w-sm" id="masters-series-type" label="Tipo de documento">
        <Select id="masters-series-type" value={type} onChange={(event) => setType(event.target.value as SeriesType)}>
          {SERIES_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
      </AccessibleField>

      <div className="divide-y divide-window-shadow border border-window-shadow bg-card px-2.5" data-testid="series-list">
        {loading ? <p className="py-2 text-xs text-muted-foreground">Cargando series…</p> : null}
        {!loading && typeRows.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">
            Sin series de {typeLabel.toLowerCase()} en el ejercicio activo. Crea la primera con el formulario de abajo; será la serie por defecto.
          </p>
        ) : null}
        {typeRows.map((row) => {
          const key = `series-${row.id}`;
          const draft = drafts[row.id] ?? draftOf(row);
          const errors = fieldErrors[key] ?? {};
          const preview = previewSeriesFormat(draft.format, draft.prefix, Number(draft.nextNumber) || 1);
          const isMainInvoiceSeries = row.type === "SALES_INVOICE" && row.isDefault;
          return (
            <form className={cn("space-y-2 py-2.5", !row.isActive && "opacity-70")} data-testid={`series-row-${row.code}`} key={row.id} noValidate onSubmit={(event) => saveRow(event, row)}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-bold">{row.code}</span>
                {row.isDefault ? <StatusBadge tone="info">Por defecto</StatusBadge> : null}
                {!row.isActive ? <StatusBadge>Desactivada</StatusBadge> : null}
              </div>
              <div className="grid gap-2 md:grid-cols-12">
                <AccessibleField className="md:col-span-3" error={errors.name} id={`${key}-name`} label="Nombre" required>
                  <Input id={`${key}-name`} maxLength={60} value={draft.name} onChange={(event) => updateDraft(row.id, { name: event.target.value })} />
                </AccessibleField>
                <AccessibleField className="md:col-span-2" error={errors.prefix} id={`${key}-prefix`} label="Prefijo" required>
                  <Input
                    aria-label={isMainInvoiceSeries ? "Prefijo factura" : `Prefijo ${row.name}`}
                    className="font-mono"
                    id={`${key}-prefix`}
                    value={draft.prefix}
                    onChange={(event) => updateDraft(row.id, { prefix: event.target.value })}
                  />
                </AccessibleField>
                <AccessibleField className="md:col-span-4" error={errors.format} helperText={`Códigos: ${FORMAT_TOKENS.join(" ")}`} id={`${key}-format`} label="Formato" required>
                  <Input
                    aria-label={isMainInvoiceSeries ? "Formato factura" : `Formato ${row.name}`}
                    className="font-mono"
                    id={`${key}-format`}
                    value={draft.format}
                    onChange={(event) => updateDraft(row.id, { format: event.target.value })}
                  />
                </AccessibleField>
                <AccessibleField className="md:col-span-3" error={errors.nextNumber} helperText="Número del próximo documento." id={`${key}-next`} label="Siguiente número" required>
                  <Input
                    aria-label={isMainInvoiceSeries ? "Siguiente número factura" : `Siguiente número ${row.name}`}
                    className="text-right tabular-nums"
                    id={`${key}-next`}
                    inputMode="numeric"
                    value={draft.nextNumber}
                    onChange={(event) => updateDraft(row.id, { nextNumber: event.target.value.replace(/\D/g, "") })}
                  />
                </AccessibleField>
              </div>
              <p className="text-xs" data-testid={isMainInvoiceSeries ? "invoice-series-preview" : undefined}>
                Vista previa: <span className="font-mono font-bold">{preview}</span>
              </p>
              <FormErrorMessage>{formErrors[key]}</FormErrorMessage>
              <div className="flex flex-wrap justify-end gap-2">
                {!row.isDefault && row.isActive ? (
                  <Button disabled={busy} size="sm" type="button" variant="ghost" onClick={() => patchRow(row, { isDefault: true }, `«${row.name}» es ahora la serie por defecto.`)}>
                    Usar por defecto
                  </Button>
                ) : null}
                {!row.isDefault ? (
                  <Button
                    disabled={busy}
                    size="sm"
                    type="button"
                    variant="ghost"
                    onClick={() => patchRow(row, { isActive: !row.isActive }, row.isActive ? `Serie «${row.name}» desactivada: ya no se podrá elegir.` : `Serie «${row.name}» activada.`)}
                  >
                    {row.isActive ? "Desactivar" : "Activar"}
                  </Button>
                ) : null}
                <SubmitButton disabled={busy} pending={pending === key} size="sm" variant="outline">
                  Guardar
                </SubmitButton>
              </div>
            </form>
          );
        })}
      </div>

      <form className="space-y-2 border border-window-shadow bg-card p-2.5" data-testid="series-create-form" noValidate onSubmit={createSeries}>
        <p className="font-mono text-xs font-bold">Nueva serie de {typeLabel.toLowerCase()}</p>
        <div className="grid gap-2 md:grid-cols-12">
          <AccessibleField className="md:col-span-2" error={newErrors.code} helperText="Corto y único, p. ej. T." id="series-new-code" label="Código" required>
            <Input className="font-mono uppercase" id="series-new-code" maxLength={10} placeholder="T" value={newSeries.code} onChange={(event) => setNewSeries((current) => ({ ...current, code: event.target.value }))} />
          </AccessibleField>
          <AccessibleField className="md:col-span-3" error={newErrors.name} id="series-new-name" label="Nombre" required>
            <Input id="series-new-name" maxLength={60} placeholder="Tickets" value={newSeries.name} onChange={(event) => setNewSeries((current) => ({ ...current, name: event.target.value }))} />
          </AccessibleField>
          <AccessibleField className="md:col-span-2" error={newErrors.prefix} id="series-new-prefix" label="Prefijo" required>
            <Input className="font-mono" id="series-new-prefix" placeholder="T-" value={newSeries.prefix} onChange={(event) => setNewSeries((current) => ({ ...current, prefix: event.target.value }))} />
          </AccessibleField>
          <AccessibleField className="md:col-span-3" error={newErrors.format} id="series-new-format" label="Formato" required>
            <Input className="font-mono" id="series-new-format" value={newSeries.format} onChange={(event) => setNewSeries((current) => ({ ...current, format: event.target.value }))} />
          </AccessibleField>
          <AccessibleField className="md:col-span-2" error={newErrors.nextNumber} helperText="Vacío: empieza en 1." id="series-new-next" label="Empieza en">
            <Input
              className="text-right tabular-nums"
              id="series-new-next"
              inputMode="numeric"
              value={newSeries.nextNumber}
              onChange={(event) => setNewSeries((current) => ({ ...current, nextNumber: event.target.value.replace(/\D/g, "") }))}
            />
          </AccessibleField>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Insertar código en el formato">
          {FORMAT_TOKENS.map((token) => (
            <Button key={token} size="sm" type="button" variant="outline" onClick={() => setNewSeries((current) => ({ ...current, format: `${current.format}${token}` }))}>
              {token}
            </Button>
          ))}
        </div>
        <p className="text-xs">
          Vista previa: <span className="font-mono font-bold">{previewSeriesFormat(newSeries.format, newSeries.prefix, Number(newSeries.nextNumber) || 1)}</span>
        </p>
        <label className="flex items-center gap-2 font-mono text-xs font-bold" htmlFor="series-new-default">
          <input checked={newSeries.isDefault} id="series-new-default" type="checkbox" onChange={(event) => setNewSeries((current) => ({ ...current, isDefault: event.target.checked }))} />
          Usarla por defecto
        </label>
        <FormErrorMessage>{formErrors["series-new"]}</FormErrorMessage>
        <div className="flex justify-end">
          <SubmitButton disabled={busy || loading} pending={pending === "series-new"}>Crear serie</SubmitButton>
        </div>
      </form>

      <Dialog
        description="La numeración debe ser correlativa. Revisa el salto antes de confirmarlo."
        initialFocusId="series-gap-reason"
        onClose={cancelGap}
        open={gapPrompt !== null}
        size="sm"
        title="¿Saltar números?"
      >
        {gapPrompt ? (
          <form
            className="space-y-3"
            data-testid="series-gap-dialog"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              confirmGap();
            }}
          >
            <p className="text-sm">
              Ahora el próximo documento sería el número <strong className="font-mono">{gapPrompt.gap.from}</strong>. Si lo
              cambias al <strong className="font-mono">{gapPrompt.gap.to}</strong>, quedarán{" "}
              <strong>{gapPrompt.gap.skipped} {gapPrompt.gap.skipped === 1 ? "número sin usar" : "números sin usar"}</strong>
              {gapPrompt.gap.skipped > 1 ? ` (del ${gapPrompt.gap.from} al ${gapPrompt.gap.to - 1})` : ` (el ${gapPrompt.gap.from})`}.
            </p>
            <p className="text-xs text-muted-foreground">
              Hacienda puede pedir explicaciones por los huecos en la numeración. Hazlo solo si es intencionado, por ejemplo al
              continuar la numeración de otro programa. El motivo quedará guardado en el registro de auditoría.
            </p>
            <AccessibleField error={gapReasonError} id="series-gap-reason" label="Motivo del salto" required>
              <Textarea
                id="series-gap-reason"
                maxLength={500}
                placeholder="Por ejemplo: continuamos la numeración del programa anterior, que llegó a la factura 119."
                value={gapReason}
                onChange={(event) => {
                  setGapReason(event.target.value);
                  if (gapReasonError) setGapReasonError(undefined);
                }}
              />
            </AccessibleField>
            <DialogFooter>
              <Button disabled={busy} onClick={cancelGap} type="button" variant="outline">
                Cancelar
              </Button>
              <Button data-testid="series-gap-confirm" disabled={busy} type="submit">
                {busy ? "Guardando…" : "Confirmar salto"}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </Dialog>
    </section>
  );
}
