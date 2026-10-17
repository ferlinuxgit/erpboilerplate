"use client";

import { Backspace } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

/**
 * Teclado numérico táctil del TPV (importes con coma decimal). Trabaja sobre el texto del importe
 * ("12,5"): añade dígitos, una sola coma y como mucho dos decimales.
 */
export function applyKey(value: string, key: string) {
  if (key === "C") return "";
  if (key === "⌫") return value.slice(0, -1);
  if (key === ",") return value.includes(",") ? value : `${value || "0"},`;
  const [integer, decimals] = value.split(",");
  if (decimals !== undefined && decimals.length >= 2) return value;
  if (decimals === undefined && integer.replace(/^0+/, "").length >= 7) return value;
  const next = `${value}${key}`;
  // Sin ceros a la izquierda: "0" + "5" → "5".
  return next.startsWith("0") && !next.startsWith("0,") && next.length > 1 ? next.replace(/^0+(?=\d)/, "") : next;
}

const KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ",", "0", "⌫"];

export function Keypad({ onKey, className, disabled = false }: { onKey: (key: string) => void; className?: string; disabled?: boolean }) {
  return (
    <div className={cn("grid select-none grid-cols-3 gap-1.5 [touch-action:manipulation]", className)} data-testid="pos-keypad">
      {KEYS.map((key) => (
        <button
          aria-label={key === "⌫" ? "Borrar" : key === "," ? "Coma decimal" : key}
          className="flex h-14 items-center justify-center border border-window-dark-shadow bg-window-panel font-mono text-2xl font-bold shadow-raised active:translate-y-px active:bg-window-highlight disabled:opacity-40 sm:h-12"
          disabled={disabled}
          key={key}
          onClick={() => onKey(key)}
          type="button"
        >
          {key === "⌫" ? <Backspace aria-hidden="true" className="size-6" /> : key}
        </button>
      ))}
    </div>
  );
}

/** Teclas físicas (ordenador con teclado o lector) que alimentan el mismo importe. */
export function keyFromKeyboard(event: Pick<KeyboardEvent, "key">) {
  if (/^\d$/.test(event.key)) return event.key;
  if (event.key === "," || event.key === ".") return ",";
  if (event.key === "Backspace") return "⌫";
  if (event.key === "Delete" || event.key === "Escape") return null;
  return null;
}
