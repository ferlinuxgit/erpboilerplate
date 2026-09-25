"use client";

import { useId } from "react";

import { InlineAlert } from "@/components/ui/page";
import { formatScheduleDate } from "@/server/recurring/schedule";

export type IssueModeOption = { value: string; label: string; description: string };

/**
 * Qué hacer en cada fecha. Los modos automáticos (emitir, enviar, registrar) exigen marcar una
 * confirmación explícita con el efecto concreto.
 */
export function IssueModeFields({
  automaticWarning,
  confirmError,
  confirmed,
  nextDate,
  onConfirmedChange,
  onChange,
  options,
  value,
}: {
  options: IssueModeOption[];
  value: string;
  onChange: (value: string) => void;
  /** Texto de la confirmación, p. ej. "Se emitirán facturas automáticamente cada mes". null = modo manual. */
  automaticWarning: string | null;
  confirmed: boolean;
  onConfirmedChange: (value: boolean) => void;
  confirmError?: string;
  nextDate: string | null;
}) {
  const idBase = useId();
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 font-mono text-xs font-bold">En cada fecha</legend>
      {options.map((option) => {
        const inputId = `${idBase}-${option.value}`;
        return (
          <label
            className="flex cursor-pointer gap-3 border border-window-dark-shadow bg-window-panel p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus"
            htmlFor={inputId}
            key={option.value}
          >
            <input
              aria-describedby={`${inputId}-description`}
              checked={value === option.value}
              className="mt-0.5"
              id={inputId}
              name={`${idBase}-mode`}
              onChange={() => onChange(option.value)}
              type="radio"
              value={option.value}
            />
            <span>
              <span className="block text-sm font-semibold">{option.label}</span>
              <span className="block text-xs text-muted-foreground" id={`${inputId}-description`}>{option.description}</span>
            </span>
          </label>
        );
      })}
      {automaticWarning ? (
        <InlineAlert tone="warning">
          <label className="flex items-start gap-2" htmlFor={`${idBase}-confirm`}>
            <input
              aria-describedby={confirmError ? `${idBase}-confirm-error` : undefined}
              aria-invalid={confirmError ? true : undefined}
              checked={confirmed}
              className="mt-0.5"
              id={`${idBase}-confirm`}
              onChange={(event) => onConfirmedChange(event.target.checked)}
              type="checkbox"
            />
            <span>
              {automaticWarning}
              {nextDate ? ` La primera será el ${formatScheduleDate(nextDate)}.` : ""} Lo entiendo y quiero activarlo.
            </span>
          </label>
          {confirmError ? <p className="mt-1 text-destructive" id={`${idBase}-confirm-error`} role="alert">{confirmError}</p> : null}
        </InlineAlert>
      ) : null}
    </fieldset>
  );
}
