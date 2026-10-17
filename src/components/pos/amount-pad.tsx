"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";

import { applyKey, Keypad } from "./keypad";

const sanitize = (raw: string) => {
  // Texto pegado o tecleado: solo dígitos y una coma (el punto cuenta como coma), dos decimales.
  let result = "";
  for (const char of raw.replace(/\./g, ",")) {
    if (/\d/.test(char) || char === ",") result = applyKey(result, char);
  }
  return result;
};

/**
 * Importe con teclado táctil: el campo muestra el importe y se puede escribir con un teclado físico;
 * en móvil y tablet no abre el teclado del sistema (se usa el de la pantalla).
 */
export function AmountPad({
  autoFocus,
  className,
  currencySymbol = "€",
  hideKeypad = false,
  id,
  label,
  onChange,
  onEnter,
  placeholder = "0,00",
  value,
  children,
}: {
  autoFocus?: boolean;
  className?: string;
  currencySymbol?: string;
  hideKeypad?: boolean;
  id?: string;
  label: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  placeholder?: string;
  value: string;
  /** Botones rápidos (importe exacto, billetes…) entre el campo y el teclado. */
  children?: React.ReactNode;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className={cn("space-y-2", className)}>
      <label className="block font-mono text-xs font-bold uppercase text-muted-foreground" htmlFor={inputId}>{label}</label>
      <div className="flex items-center border-2 border-window-dark-shadow bg-white px-3 focus-within:border-primary">
        <input
          autoComplete="off"
          autoFocus={autoFocus}
          className="h-14 w-full min-w-0 bg-transparent text-right font-mono text-3xl font-black tabular-nums outline-none placeholder:text-muted-foreground/50"
          id={inputId}
          inputMode="none"
          onChange={(event) => onChange(sanitize(event.target.value))}
          onKeyDown={(event) => {
            if (event.key === "Enter" && onEnter) {
              event.preventDefault();
              onEnter();
            }
          }}
          placeholder={placeholder}
          value={value}
        />
        <span aria-hidden="true" className="ml-2 font-mono text-xl font-bold text-muted-foreground">{currencySymbol}</span>
      </div>
      {children}
      {!hideKeypad ? <Keypad onKey={(key) => onChange(applyKey(value, key))} /> : null}
    </div>
  );
}
