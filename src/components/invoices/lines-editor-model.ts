import { formatPercent, parseDecimalInput } from "@/lib/format";

/**
 * Reglas puras del editor de líneas (`LinesEditor`): columnas de la rejilla,
 * opciones de IVA/IRPF, reordenación y destino del foco tras cada acción.
 * Sin React para poder probarlas en aislamiento.
 */

export const standardVatRates = [21, 10, 4, 0];
/** IRPF withholding rates commonly used on Spanish professional invoices. */
export const standardRetentionRates = [0, 7, 15, 19];

/** Tipos de IVA ofrecidos (de mayor a menor): los habituales, el actual de la línea y el predeterminado. */
export function vatRateOptions(current: string | number | null | undefined, defaultRate: number, standard: readonly number[] = standardVatRates) {
  const rates = new Set(standard);
  const parsed = typeof current === "number" ? current : parseDecimalInput(current);
  if (parsed !== null && Number.isFinite(parsed)) rates.add(parsed);
  rates.add(defaultRate);
  return [...rates].sort((left, right) => right - left);
}

export function vatRateLabel(rate: number) {
  return rate === 0 ? "Exento 0 %" : `IVA ${formatPercent(rate)}`;
}

/** Retenciones ofrecidas (de menor a mayor): las habituales más las ya usadas. */
export function retentionRateOptions(...current: number[]) {
  return [...new Set([...standardRetentionRates, ...current.filter((rate) => Number.isFinite(rate))])].sort((left, right) => left - right);
}

export function retentionRateLabel(rate: number) {
  return rate === 0 ? "Sin retención" : formatPercent(rate);
}

/** Nombre accesible del selector de impuestos: incluye los impuestos elegidos. */
export function taxPickerLabel(lineNumber: number, selectedNames: string[]) {
  return `Impuestos línea ${lineNumber}: ${selectedNames.length ? selectedNames.join(", ") : "sin impuestos"}`;
}

/** Copia de la lista con el elemento `from` en la posición `to` (fuera de rango: sin cambios). */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Id del DOM de un campo: `invoice-line` + 0 + `description` → `invoice-line-1-description`. */
export function lineFieldId(idPrefix: string, index: number, field: string) {
  return `${idPrefix}-${index + 1}-${field}`;
}

/** Id del contenedor de la sección (destino del foco cuando no quedan líneas). */
export function linesSectionId(idPrefix: string) {
  return `${idPrefix}s-section`;
}

/**
 * Candidatos para el foco tras una acción, en orden: se enfoca el primero
 * visible (los botones de mover de escritorio se ocultan en móvil).
 * - Añadir/duplicar: el primer campo de la línea nueva.
 * - Mover: el mismo botón en su nueva posición o, en móvil, el concepto.
 * - Quitar: el concepto de la línea anterior o, si no queda ninguna, la sección.
 */
export function focusTargetsAfter(
  action: { type: "add"; newIndex: number } | { type: "duplicate"; index: number } | { type: "move"; from: number; to: number } | { type: "remove"; index: number; remaining: number },
  idPrefix: string,
  firstField = "description",
): string[] {
  switch (action.type) {
    case "add":
      return [lineFieldId(idPrefix, action.newIndex, firstField)];
    case "duplicate":
      return [lineFieldId(idPrefix, action.index + 1, "description")];
    case "move":
      return [lineFieldId(idPrefix, action.to, action.from > action.to ? "move-up" : "move-down"), lineFieldId(idPrefix, action.to, "description")];
    case "remove":
      return action.remaining > 0 ? [lineFieldId(idPrefix, Math.min(Math.max(0, action.index - 1), action.remaining - 1), "description")] : [linesSectionId(idPrefix)];
  }
}

/** Qué hace Enter al final de una fila: crear línea, saltar a la siguiente o nada (envía el formulario). */
export function enterAtRowEnd({ canAdd, index, lineCount }: { canAdd: boolean; index: number; lineCount: number }): "add" | "next" | "none" {
  if (index < lineCount - 1) return "next";
  return canAdd ? "add" : "none";
}

/** Enter sin modificadores (Ctrl/Cmd+Enter queda para enviar el formulario). */
export function isPlainEnter(event: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
  return event.key === "Enter" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

/** Alt+L (por tecla o por código físico, para teclados no QWERTY). */
export function isAddLineShortcut(event: { key: string; code: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
  return event.altKey && !event.ctrlKey && !event.metaKey && (event.key.toLowerCase() === "l" || event.code === "KeyL");
}

export type LinesGridColumn = { track: string };

/** Valor de `grid-template-columns` de escritorio a partir de las pistas de cada columna. */
export function linesGridTemplate(columns: readonly LinesGridColumn[]) {
  return columns.map((column) => column.track).join(" ");
}
