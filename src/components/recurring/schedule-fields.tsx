"use client";

import { useId } from "react";

import type { ScheduleDraft } from "@/components/recurring/schedule-draft";
import { AccessibleField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  RECURRING_FREQUENCIES,
  describeSchedule,
  formatScheduleDate,
  intervalForFrequency,
  isDateInput,
  isRecurringFrequency,
  nextRunAfter,
  recurringFrequencyLabels,
  upcomingOccurrences,
  type RecurringSchedule,
} from "@/server/recurring/schedule";

export type { ScheduleDraft };

export type ScheduleErrors = Partial<Record<"startDate" | "everyMonths" | "endDate" | "maxOccurrences", string>>;

function wholeNumber(value: string) {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) ? parsed : null;
}

/** Periodicidad del borrador (null si aún no es válida). */
export function scheduleFromDraft(draft: ScheduleDraft): RecurringSchedule | null {
  if (!isDateInput(draft.startDate)) return null;
  const everyMonths = wholeNumber(draft.everyMonths);
  return {
    startDate: draft.startDate,
    dayOfMonth: draft.lastDayOfMonth ? 31 : Number(draft.startDate.slice(8, 10)),
    intervalMonths: intervalForFrequency(draft.frequency, everyMonths),
    endDate: draft.endMode === "date" && isDateInput(draft.endDate) ? draft.endDate : null,
    maxOccurrences: draft.endMode === "count" ? wholeNumber(draft.maxOccurrences) : null,
  };
}

export function validateScheduleDraft(draft: ScheduleDraft): ScheduleErrors {
  const errors: ScheduleErrors = {};
  if (!isDateInput(draft.startDate)) errors.startDate = "Indica la fecha de la primera emisión.";
  const every = wholeNumber(draft.everyMonths);
  if (draft.frequency === "EVERY_N_MONTHS" && (every === null || every < 1 || every > 60)) errors.everyMonths = "Entre 1 y 60 meses.";
  if (draft.endMode === "date") {
    if (!isDateInput(draft.endDate)) errors.endDate = "Indica la fecha final.";
    else if (isDateInput(draft.startDate) && draft.endDate < draft.startDate) errors.endDate = "No puede ser anterior a la primera emisión.";
  }
  const count = wholeNumber(draft.maxOccurrences);
  if (draft.endMode === "count" && (count === null || count < 1 || count > 600)) errors.maxOccurrences = "Entre 1 y 600 emisiones.";
  return errors;
}

/** Campos del payload de la API a partir del borrador. */
export function schedulePayload(draft: ScheduleDraft) {
  return {
    frequency: draft.frequency,
    everyMonths: draft.frequency === "EVERY_N_MONTHS" ? wholeNumber(draft.everyMonths) : null,
    startDate: draft.startDate,
    lastDayOfMonth: draft.lastDayOfMonth,
    endDate: draft.endMode === "date" ? draft.endDate : null,
    maxOccurrences: draft.endMode === "count" ? wholeNumber(draft.maxOccurrences) : null,
  };
}

/** Fechas de la vista previa: las 3 siguientes después de lo ya generado. */
export function previewDates(draft: ScheduleDraft, generated: { lastPeriod: string | null; count: number }) {
  const schedule = scheduleFromDraft(draft);
  if (!schedule) return [];
  const next = nextRunAfter(schedule, generated.lastPeriod, generated.count);
  return upcomingOccurrences(schedule, next, generated.count, 3);
}

/** Periodicidad: cada cuánto, primera fecha, último día del mes y fin (nunca, fecha o número). */
export function ScheduleFields({
  disabled,
  draft,
  errors,
  generated = { lastPeriod: null, count: 0 },
  noun,
  onChange,
}: {
  draft: ScheduleDraft;
  onChange: (draft: ScheduleDraft) => void;
  errors: ScheduleErrors;
  /** "factura" o "gasto": para los textos. */
  noun: string;
  generated?: { lastPeriod: string | null; count: number };
  disabled?: boolean;
}) {
  const idBase = useId();
  const id = (suffix: string) => `${idBase}-${suffix}`;
  const update = (patch: Partial<ScheduleDraft>) => onChange({ ...draft, ...patch });
  const schedule = scheduleFromDraft(draft);
  const dates = previewDates(draft, generated);
  const startDay = isDateInput(draft.startDate) ? Number(draft.startDate.slice(8, 10)) : null;

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="sr-only">Periodicidad</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <AccessibleField id={id("frequency")} label="Se repite" required>
          <Select value={draft.frequency} onChange={(event) => update({ frequency: isRecurringFrequency(event.target.value) ? event.target.value : "MONTHLY" })}>
            {RECURRING_FREQUENCIES.map((frequency) => <option key={frequency} value={frequency}>{recurringFrequencyLabels[frequency]}</option>)}
          </Select>
        </AccessibleField>
        {draft.frequency === "EVERY_N_MONTHS" ? (
          <AccessibleField error={errors.everyMonths} id={id("every")} label="Cada cuántos meses" required>
            <Input inputMode="numeric" value={draft.everyMonths} onChange={(event) => update({ everyMonths: event.target.value })} />
          </AccessibleField>
        ) : null}
        <AccessibleField error={errors.startDate} helperText={`Fecha de la primera ${noun}. Las siguientes, el mismo día del mes.`} id={id("start")} label="Primera emisión" required>
          <Input type="date" value={draft.startDate} onChange={(event) => update({ startDate: event.target.value })} />
        </AccessibleField>
      </div>
      <label className="flex items-center gap-2 text-sm" htmlFor={id("last-day")}>
        <input checked={draft.lastDayOfMonth} id={id("last-day")} onChange={(event) => update({ lastDayOfMonth: event.target.checked })} type="checkbox" />
        Emitir siempre el último día del mes
        {!draft.lastDayOfMonth && startDay && startDay > 28 ? <span className="text-xs text-muted-foreground">(en meses más cortos se usa el último día)</span> : null}
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <AccessibleField id={id("end-mode")} label="Termina">
          <Select value={draft.endMode} onChange={(event) => update({ endMode: event.target.value === "date" ? "date" : event.target.value === "count" ? "count" : "never" })}>
            <option value="never">Nunca (hasta que la pauses)</option>
            <option value="date">En una fecha</option>
            <option value="count">Tras un número de emisiones</option>
          </Select>
        </AccessibleField>
        {draft.endMode === "date" ? (
          <AccessibleField error={errors.endDate} id={id("end-date")} label="Última fecha posible" required>
            <Input type="date" value={draft.endDate} onChange={(event) => update({ endDate: event.target.value })} />
          </AccessibleField>
        ) : null}
        {draft.endMode === "count" ? (
          <AccessibleField error={errors.maxOccurrences} helperText={generated.count > 0 ? `Ya se han generado ${generated.count}.` : undefined} id={id("count")} label="Número de emisiones" required>
            <Input inputMode="numeric" value={draft.maxOccurrences} onChange={(event) => update({ maxOccurrences: event.target.value })} />
          </AccessibleField>
        ) : null}
      </div>
      <div aria-live="polite" className="rounded-[2px] border border-window-dark-shadow bg-window-panel p-3 text-sm" data-testid="recurring-preview">
        {schedule ? <p className="font-semibold">{describeSchedule(schedule)}</p> : null}
        {dates.length > 0 ? (
          <p>Próximas fechas: {dates.map((date) => formatScheduleDate(date)).join(" · ")}</p>
        ) : (
          <p className="text-muted-foreground">Con estas fechas no habría ninguna emisión pendiente.</p>
        )}
      </div>
    </fieldset>
  );
}
