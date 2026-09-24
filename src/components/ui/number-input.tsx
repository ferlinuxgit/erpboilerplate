"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { formatDecimalInput, parseDecimalInput } from "@/lib/format";
import { cn } from "@/lib/utils";

type DecimalInputProps = Omit<React.ComponentProps<"input">, "type" | "value" | "defaultValue"> & {
  /** Controlled value. Any string accepted by `parseDecimalInput` or a number. */
  value?: string | number | null;
  defaultValue?: string | number | null;
  /** Visual unit shown inside the field (e.g. "€", "%", "uds."). */
  adornment?: React.ReactNode;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  /** Called with the parsed number (or null) on every change. */
  onValueChange?: (value: number | null, raw: string) => void;
  wrapperClassName?: string;
};

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as React.RefObject<T | null>).current = value;
}

/**
 * Text field for decimal numbers typed the Spanish way. It accepts
 * "1.234,56" and "1234.56", shows the value formatted in es-ES when the field
 * is not being edited and never emits synthetic change events (so tabbing
 * through a form does not mark it as dirty).
 *
 * Works controlled (`value` + `onChange`/`onValueChange`, the parent stores the
 * raw string and converts it with `parseDecimalInput`) and uncontrolled with
 * react-hook-form: `register(name, decimalRegisterOptions)`.
 */
export function DecimalInput({
  adornment,
  className,
  defaultValue,
  maximumFractionDigits = 2,
  minimumFractionDigits = 0,
  onBlur,
  onChange,
  onFocus,
  onValueChange,
  ref,
  value,
  wrapperClassName,
  ...props
}: DecimalInputProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = React.useState<string | null>(null);
  const isControlled = value !== undefined;
  const format = React.useCallback(
    (raw: string | number | null | undefined) => {
      const parsed = parseDecimalInput(raw, { maximumFractionDigits });
      if (parsed === null) return raw === null || raw === undefined ? "" : String(raw);
      return formatDecimalInput(parsed, { minimumFractionDigits, maximumFractionDigits });
    },
    [maximumFractionDigits, minimumFractionDigits],
  );

  const setRefs = React.useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node;
      assignRef(ref, node);
    },
    [ref],
  );

  // Uncontrolled fields (react-hook-form `register`) receive their initial
  // value through the ref; format it once, silently.
  React.useLayoutEffect(() => {
    const node = inputRef.current;
    if (isControlled || !node || document.activeElement === node) return;
    const formatted = format(node.value);
    if (formatted !== node.value) node.value = formatted;
  }, [format, isControlled]);

  const displayValue = isControlled ? (draft ?? format(value)) : undefined;

  return (
    <div className={cn("relative min-w-0", wrapperClassName)}>
      <Input
        autoComplete="off"
        className={cn("text-right tabular-nums", adornment ? "pr-7" : undefined, className)}
        defaultValue={isControlled ? undefined : (defaultValue ?? undefined)}
        inputMode="decimal"
        onBlur={(event) => {
          if (isControlled) setDraft(null);
          else {
            const formatted = format(event.currentTarget.value);
            if (formatted !== event.currentTarget.value) event.currentTarget.value = formatted;
          }
          onBlur?.(event);
        }}
        onChange={(event) => {
          if (isControlled) setDraft(event.currentTarget.value);
          onChange?.(event);
          onValueChange?.(parseDecimalInput(event.currentTarget.value, { maximumFractionDigits }), event.currentTarget.value);
        }}
        onFocus={(event) => {
          if (isControlled) setDraft(format(value));
          onFocus?.(event);
        }}
        ref={setRefs}
        spellCheck={false}
        type="text"
        value={displayValue}
        {...props}
      />
      {adornment ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-2 flex items-center font-mono text-[0.72rem] text-window-muted"
        >
          {adornment}
        </span>
      ) : null}
    </div>
  );
}

type PublicNumberInputProps = Omit<DecimalInputProps, "adornment" | "minimumFractionDigits" | "maximumFractionDigits">;

/** Amount in currency: two decimals, "€" adornment. */
export function MoneyInput({ currencySymbol = "€", ...props }: PublicNumberInputProps & { currencySymbol?: string }) {
  return <DecimalInput adornment={currencySymbol} maximumFractionDigits={2} minimumFractionDigits={2} {...props} />;
}

/**
 * Percentage (IVA, retención, descuento): "%" adornment. Allows three
 * decimals so a single dot is always a decimal mark — the database returns
 * rates as "21.000", which must never be read as twenty-one thousand.
 */
export function PercentInput(props: PublicNumberInputProps) {
  return <DecimalInput adornment="%" maximumFractionDigits={3} {...props} />;
}

/** Quantity: up to three decimals, optional unit adornment. */
export function QuantityInput({ unit, ...props }: PublicNumberInputProps & { unit?: string }) {
  return <DecimalInput adornment={unit} maximumFractionDigits={3} {...props} />;
}

/**
 * react-hook-form options for decimal text fields. Empty or invalid input
 * becomes NaN so zod reports it exactly like `valueAsNumber` did.
 */
export const decimalRegisterOptions = {
  setValueAs: (value: unknown) => {
    if (typeof value === "number") return value;
    return parseDecimalInput(typeof value === "string" ? value : null) ?? Number.NaN;
  },
} as const;

/** Same as `decimalRegisterOptions` for money fields ("1.500" = 1500). */
export const moneyRegisterOptions = {
  setValueAs: (value: unknown) => {
    if (typeof value === "number") return value;
    return parseDecimalInput(typeof value === "string" ? value : null, { maximumFractionDigits: 2 }) ?? Number.NaN;
  },
} as const;
