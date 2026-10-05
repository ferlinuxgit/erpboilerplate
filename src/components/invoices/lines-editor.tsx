"use client";

import { ArrowDown, ArrowUp, CaretDown, Copy, DotsThree, Plus, Trash } from "@phosphor-icons/react";
import * as React from "react";

import {
  enterAtRowEnd,
  focusTargetsAfter,
  isAddLineShortcut,
  isPlainEnter,
  lineFieldId,
  linesGridTemplate,
  linesSectionId,
  taxPickerLabel,
  vatRateLabel,
  vatRateOptions,
} from "@/components/invoices/lines-editor-model";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { FIELD_SCROLL_MARGIN } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput, PercentInput, QuantityInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Editor de líneas único de la aplicación (facturas, rectificativas,
 * presupuestos, pedidos, recurrentes y gastos recurrentes).
 *
 * Móvil (<lg): cada línea es una tarjeta con el concepto arriba, los campos
 * numéricos en dos columnas, el importe destacado, «Eliminar» siempre visible
 * y el resto de acciones en un menú «Más».
 * Escritorio (lg+): una fila de rejilla por línea con cabecera de columnas
 * decorativa (cada campo tiene su propio nombre accesible) y las columnas
 * numéricas alineadas a la derecha.
 *
 * Teclado: Enter avanza por la fila; desde el precio (y los campos que le
 * siguen) pasa a la línea siguiente o crea una nueva; Alt+L añade una línea
 * desde cualquier campo del formulario.
 *
 * El editor no conoce el modelo de estado: cada consumidor le pasa por línea
 * los «bindings» de sus campos, que se esparcen sobre el control. Sirven tanto
 * `register()` de react-hook-form (no controlado) como `{ value, onChange }`
 * (controlado).
 */

/** Props que se esparcen sobre un campo de texto o numérico de la línea. */
export type InputBinding = Omit<React.ComponentPropsWithRef<"input">, "value" | "defaultValue" | "type" | "id"> & { value?: string | number };
/** Props que se esparcen sobre un desplegable (select nativo) de la línea. */
export type SelectBinding = Omit<React.ComponentPropsWithRef<"select">, "id">;
/** Props de cada casilla del selector de impuestos múltiple. */
export type CheckboxBinding = Omit<React.ComponentPropsWithRef<"input">, "type" | "id">;

export type LineTaxOption = {
  id: string;
  name: string;
  rate: number;
  operation: "ADD" | "SUBTRACT";
  isActive?: boolean;
};

/**
 * Cómo se eligen los impuestos de cada línea:
 * - `multi`: varios impuestos configurados (casillas), p. ej. IVA + recargo + IRPF.
 * - `vat`: un único tipo de IVA en un desplegable.
 * - `fixed`: impuestos congelados de otro documento, solo lectura.
 * - `none`: sin columna de impuestos.
 */
export type LinesTaxMode =
  | { kind: "none" }
  | { kind: "multi"; taxes: readonly LineTaxOption[] }
  | { kind: "vat"; defaultRate: number }
  | { kind: "fixed" };

export type LineErrorKey = "item" | "description" | "quantity" | "unitPrice" | "discountPct" | "tax";

/** Una línea vista por el editor: bindings de sus campos, importe y errores. */
export type LinesEditorRow = {
  /** Clave estable de React (id de `useFieldArray` o clave del borrador). */
  key: string;
  item?: SelectBinding;
  description: InputBinding;
  quantity?: InputBinding;
  unitPrice: InputBinding;
  discountPct?: InputBinding;
  /** Modo `vat`: valor en texto del tipo elegido ("21"). */
  taxRate?: SelectBinding;
  /** Modo `multi`: binding de la casilla de cada impuesto. */
  taxCheckbox?: (taxId: string) => CheckboxBinding;
  /** Modo `multi`: impuestos marcados (para el resumen y el nombre accesible). */
  selectedTaxIds?: readonly string[];
  /** Modo `fixed`: descripción de los impuestos congelados. */
  taxText?: string;
  /** Importe de la línea y, si difiere y aporta información, su base. */
  total: { amount: number; base?: number | null };
  /** Errores por campo (`LineErrorKey` o la `key` de una columna extra). */
  errors?: Partial<Record<string, string | undefined>>;
};

export type LinesColumnContext = {
  index: number;
  lineNumber: number;
  /** Id del control (lo nombra el `<label htmlFor>` de la celda). */
  id: string;
  describedBy?: string;
  invalid: boolean;
  /** Aplica el flujo de Enter del editor desde este control. */
  onEnter: (event: React.KeyboardEvent<HTMLElement>) => void;
};

/** Columna propia del consumidor (cuenta contable, retención…), con la misma celda que el resto. */
export type LinesExtraColumn = {
  key: string;
  label: string;
  /** Texto de la cabecera de escritorio (por defecto, `label`). */
  header?: string;
  /** Pista de `grid-template-columns` en escritorio, p. ej. "6rem". */
  track: string;
  /** `start`: antes del concepto; `end`: tras los impuestos. */
  position: "start" | "end";
  numeric?: boolean;
  wide?: boolean;
  /** Ayuda breve: visible en la tarjeta móvil, solo para lectores en escritorio. */
  hint?: string;
  render: (context: LinesColumnContext) => React.ReactNode;
};

export type LinesEditorProps = {
  /** Prefijo de ids y test ids: "invoice-line" → "invoice-line-1-description". */
  idPrefix: string;
  title: React.ReactNode;
  titleId?: string;
  headingLevel?: 2 | 3;
  description?: React.ReactNode;
  rows: LinesEditorRow[];
  tax: LinesTaxMode;
  /** Desplegable de artículo del catálogo (antes del concepto). */
  itemOptions?: ReadonlyArray<{ id: string; label: string }>;
  /** `false` oculta la cantidad (p. ej. gastos con una base por línea). */
  withQuantity?: boolean;
  withDiscount?: boolean;
  extraColumns?: LinesExtraColumn[];
  unitPriceLabel?: string;
  unitPriceHint?: string;
  totalLabel?: string;
  currencyCode?: string;
  /** Sin `onAdd` no se pueden crear líneas (p. ej. rectificativas). */
  onAdd?: () => void;
  maxLines?: number;
  onRemove: (index: number) => void;
  /** Líneas mínimas (por defecto 1). */
  minLines?: number;
  removeVerb?: "Eliminar" | "Quitar";
  onMove?: (from: number, to: number) => void;
  onDuplicate?: (index: number) => void;
  /** Contenido cuando no queda ninguna línea. */
  empty?: React.ReactNode;
  addTestId?: string;
  rowTestId?: (lineNumber: number) => string;
  listTestId?: string;
};

/** Estilos compartidos de los desplegables con casillas (impuestos, formas de pago). */
export const PICKER_SUMMARY =
  "flex h-9 cursor-pointer list-none items-center justify-between gap-2 rounded-control border border-window-dark-shadow bg-window-highlight px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:h-10 [&::-webkit-details-marker]:hidden";
// En el flujo del documento (no flotante): nunca se sale de pantallas estrechas.
export const PICKER_PANEL = "mt-1 w-full min-w-0 max-w-full overflow-y-auto rounded-surface border border-window-dark-shadow bg-popover p-1.5 shadow-drop-sm";
export const PICKER_OPTION = "flex cursor-pointer gap-2 rounded-control px-2 py-2 font-mono text-xs hover:bg-window-panel pointer-coarse:min-h-10";

const TRACKS = {
  item: "minmax(10rem,.6fr)",
  description: "minmax(13rem,1fr)",
  quantity: "5.5rem",
  unitPrice: "7.5rem",
  discount: "5rem",
  multi: "minmax(10rem,.7fr)",
  vat: "6.5rem",
  fixed: "minmax(8rem,.6fr)",
  total: "7.5rem",
};

const DEFAULT_DESCRIPTION = "Enter avanza por la fila; desde el precio crea la siguiente línea. Alt+L añade una línea desde cualquier campo.";

type Column = { key: string; header: string; track: string; numeric?: boolean };

export function LinesEditor({
  addTestId,
  currencyCode = "EUR",
  description,
  empty,
  extraColumns = [],
  headingLevel = 2,
  idPrefix,
  itemOptions,
  listTestId,
  maxLines = Number.POSITIVE_INFINITY,
  minLines = 1,
  onAdd,
  onDuplicate,
  onMove,
  onRemove,
  removeVerb = "Eliminar",
  rowTestId = (lineNumber) => `${idPrefix}-${lineNumber}`,
  rows,
  tax,
  title,
  titleId = `${idPrefix}s-title`,
  totalLabel = "Importe",
  unitPriceHint,
  unitPriceLabel = "Precio unitario",
  withDiscount = false,
  withQuantity = true,
}: LinesEditorProps) {
  const sectionRef = React.useRef<HTMLElement>(null);
  // Ids candidatos para el foco tras añadir/mover/quitar: se usa el primero visible.
  const [pendingFocus, setPendingFocus] = React.useState<string[] | null>(null);
  const lineCount = rows.length;
  const canAdd = Boolean(onAdd) && lineCount < maxLines;
  const withItem = Boolean(itemOptions);
  const startColumns = extraColumns.filter((column) => column.position === "start");
  const endColumns = extraColumns.filter((column) => column.position === "end");
  const hasMenuActions = Boolean(onMove || onDuplicate);

  const columns: Column[] = [
    withItem ? { key: "item", header: "Artículo", track: TRACKS.item } : null,
    ...startColumns.map((column) => ({ key: column.key, header: column.header ?? column.label, track: column.track, numeric: column.numeric })),
    { key: "description", header: "Concepto", track: TRACKS.description },
    withQuantity ? { key: "quantity", header: "Cantidad", track: TRACKS.quantity, numeric: true } : null,
    { key: "unitPrice", header: unitPriceLabel, track: TRACKS.unitPrice, numeric: true },
    withDiscount ? { key: "discount", header: "Dto.", track: TRACKS.discount, numeric: true } : null,
    tax.kind === "multi" ? { key: "tax", header: "Impuestos", track: TRACKS.multi } : null,
    tax.kind === "vat" ? { key: "tax", header: "IVA", track: TRACKS.vat } : null,
    tax.kind === "fixed" ? { key: "tax", header: "Impuestos", track: TRACKS.fixed } : null,
    ...endColumns.map((column) => ({ key: column.key, header: column.header ?? column.label, track: column.track, numeric: column.numeric })),
    { key: "total", header: totalLabel, track: TRACKS.total, numeric: true },
    { key: "actions", header: "Acciones", track: hasMenuActions ? "7.5rem" : "3rem" },
  ].filter((column): column is Column => column !== null);
  const gridStyle = { "--lines-grid": linesGridTemplate(columns) } as React.CSSProperties;

  // Campos en los que Enter avanza dentro de la fila; a partir del precio, Enter cierra la fila.
  const advanceFields = [withItem ? "item" : null, ...startColumns.map((column) => column.key), "description", withQuantity ? "quantity" : null].filter(
    (field): field is string => field !== null,
  );
  const firstField = advanceFields[0];

  React.useEffect(() => {
    if (!pendingFocus) return;
    const frame = requestAnimationFrame(() => {
      focusFirstVisible(pendingFocus);
      setPendingFocus(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingFocus, lineCount]);

  const add = () => {
    if (!onAdd || !canAdd) return;
    onAdd();
    setPendingFocus(focusTargetsAfter({ type: "add", newIndex: lineCount }, idPrefix, firstField));
  };
  const duplicate = (index: number) => {
    if (!onDuplicate || !canAdd) return;
    onDuplicate(index);
    setPendingFocus(focusTargetsAfter({ type: "duplicate", index }, idPrefix));
  };
  const move = (from: number, to: number) => {
    if (!onMove || to < 0 || to >= lineCount) return;
    onMove(from, to);
    setPendingFocus(focusTargetsAfter({ type: "move", from, to }, idPrefix));
  };
  const remove = (index: number) => {
    if (lineCount <= minLines) return;
    onRemove(index);
    setPendingFocus(focusTargetsAfter({ type: "remove", index, remaining: lineCount - 1 }, idPrefix));
  };

  // Alt+L desde cualquier campo del formulario (o de la sección si no hay formulario).
  const handleShortcut = React.useEffectEvent((event: KeyboardEvent) => {
    if (!canAdd || !isAddLineShortcut(event)) return;
    event.preventDefault();
    add();
  });
  React.useEffect(() => {
    const scope = sectionRef.current?.closest("form") ?? sectionRef.current;
    if (!scope) return;
    const listener = (event: KeyboardEvent) => handleShortcut(event);
    scope.addEventListener("keydown", listener);
    return () => scope.removeEventListener("keydown", listener);
  }, []);

  const handleEnter = (event: React.KeyboardEvent<HTMLElement>, index: number, field: string) => {
    if (!isPlainEnter(event)) return;
    const position = advanceFields.indexOf(field);
    if (position >= 0 && position < advanceFields.length - 1) {
      event.preventDefault();
      document.getElementById(lineFieldId(idPrefix, index, advanceFields[position + 1]))?.focus();
      return;
    }
    if (position === advanceFields.length - 1) {
      // Último campo «de avance»: sigue en el precio.
      event.preventDefault();
      document.getElementById(lineFieldId(idPrefix, index, "unit-price"))?.focus();
      return;
    }
    const action = enterAtRowEnd({ canAdd, index, lineCount });
    if (action === "none") return;
    event.preventDefault();
    if (action === "add") add();
    else document.getElementById(lineFieldId(idPrefix, index + 1, firstField))?.focus();
  };

  const Heading = headingLevel === 2 ? "h2" : "h3";
  const addButtons = Boolean(onAdd);

  return (
    <section aria-labelledby={titleId} className="space-y-2 outline-none" id={linesSectionId(idPrefix)} ref={sectionRef} tabIndex={-1}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Heading className="font-mono text-sm font-bold" id={titleId}>{title}</Heading>
          <p className="text-xs text-muted-foreground">{description ?? (addButtons ? DEFAULT_DESCRIPTION : null)}</p>
        </div>
        {addButtons ? (
          <Button aria-keyshortcuts="Alt+L" className="max-sm:w-full" data-testid={addTestId ?? `${idPrefix}-add`} disabled={!canAdd} onClick={add} type="button" variant="outline">
            <Plus aria-hidden="true" />
            Añadir línea
          </Button>
        ) : null}
      </div>
      {lineCount === 0 && empty ? (
        empty
      ) : (
        <div
          className="space-y-2 lg:space-y-0 lg:rounded-surface lg:border lg:border-window-dark-shadow lg:bg-window-surface"
          data-testid={listTestId}
          style={gridStyle}
        >
          <div aria-hidden="true" className="hidden gap-px border-b border-window-dark-shadow bg-window-dark-shadow lg:grid lg:grid-cols-(--lines-grid)">
            {columns.map((column) => (
              <div className={cn("bg-window-panel px-2 py-1.5 font-mono text-xs font-bold uppercase tracking-[0.04em]", column.numeric && "text-right")} key={column.key}>
                {column.header}
              </div>
            ))}
          </div>
          {rows.map((row, index) => {
            const lineNumber = index + 1;
            const errors = row.errors ?? {};
            const ids = {
              item: lineFieldId(idPrefix, index, "item"),
              description: lineFieldId(idPrefix, index, "description"),
              quantity: lineFieldId(idPrefix, index, "quantity"),
              unitPrice: lineFieldId(idPrefix, index, "unit-price"),
              discountPct: lineFieldId(idPrefix, index, "discount"),
              taxRate: lineFieldId(idPrefix, index, "tax-rate"),
              taxes: lineFieldId(idPrefix, index, "taxes"),
            };
            const errorId = (id: string, key: string) => (errors[key] ? `${id}-error` : undefined);
            const describedBy = (...parts: Array<string | undefined>) => parts.filter(Boolean).join(" ") || undefined;
            const unitPriceHintId = unitPriceHint ? `${ids.unitPrice}-hint` : undefined;
            const renderExtra = (column: LinesExtraColumn) => {
              const id = lineFieldId(idPrefix, index, column.key);
              const hintId = column.hint ? `${id}-hint` : undefined;
              return (
                <LineField
                  error={errors[column.key]}
                  errorId={errorId(id, column.key)}
                  hint={column.hint}
                  hintId={hintId}
                  htmlFor={id}
                  key={column.key}
                  label={column.label}
                  lineNumber={lineNumber}
                  wide={column.wide}
                >
                  {column.render({
                    describedBy: describedBy(hintId, errorId(id, column.key)),
                    id,
                    index,
                    invalid: Boolean(errors[column.key]),
                    lineNumber,
                    onEnter: (event) => handleEnter(event, index, column.key),
                  })}
                </LineField>
              );
            };
            return (
              <fieldset
                className={cn(
                  "grid min-w-0 grid-cols-2 gap-x-2 gap-y-2 rounded-surface border border-window-dark-shadow bg-card p-2 shadow-drop-sm",
                  "lg:grid-cols-(--lines-grid) lg:items-start lg:gap-1 lg:rounded-none lg:border-x-0 lg:border-t-0 lg:border-window-shadow lg:shadow-none lg:last:border-b-0",
                )}
                data-testid={rowTestId(lineNumber)}
                key={row.key}
              >
                <legend className="sr-only">Línea {lineNumber}</legend>
                {withItem ? (
                  <LineField error={errors.item} errorId={errorId(ids.item, "item")} htmlFor={ids.item} label="Artículo" lineNumber={lineNumber} wide>
                    <Select
                      aria-describedby={errorId(ids.item, "item")}
                      aria-invalid={Boolean(errors.item) || undefined}
                      className="h-9"
                      data-testid={ids.item}
                      id={ids.item}
                      onKeyDown={(event) => handleEnter(event, index, "item")}
                      {...row.item}
                    >
                      <option value="">Concepto libre</option>
                      {itemOptions?.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </Select>
                  </LineField>
                ) : null}
                {startColumns.map(renderExtra)}
                <LineField error={errors.description} errorId={errorId(ids.description, "description")} htmlFor={ids.description} label="Concepto" lineNumber={lineNumber} wide>
                  <div className="flex items-center gap-1">
                    <span aria-hidden="true" className="w-5 shrink-0 text-center font-mono text-xs text-muted-foreground">{lineNumber}</span>
                    <Input
                      aria-describedby={errorId(ids.description, "description")}
                      aria-invalid={Boolean(errors.description) || undefined}
                      className="h-9"
                      data-testid={ids.description}
                      id={ids.description}
                      onKeyDown={(event) => handleEnter(event, index, "description")}
                      placeholder="Producto o servicio"
                      {...row.description}
                    />
                  </div>
                </LineField>
                {withQuantity ? (
                  <LineField error={errors.quantity} errorId={errorId(ids.quantity, "quantity")} htmlFor={ids.quantity} label="Cantidad" lineNumber={lineNumber}>
                    <QuantityInput
                      aria-describedby={errorId(ids.quantity, "quantity")}
                      aria-invalid={Boolean(errors.quantity) || undefined}
                      className="h-9"
                      data-testid={ids.quantity}
                      id={ids.quantity}
                      onKeyDown={(event) => handleEnter(event, index, "quantity")}
                      {...row.quantity}
                    />
                  </LineField>
                ) : null}
                <LineField
                  error={errors.unitPrice}
                  errorId={errorId(ids.unitPrice, "unitPrice")}
                  hint={unitPriceHint}
                  hintId={unitPriceHintId}
                  htmlFor={ids.unitPrice}
                  label={unitPriceLabel}
                  lineNumber={lineNumber}
                >
                  <MoneyInput
                    aria-describedby={describedBy(unitPriceHintId, errorId(ids.unitPrice, "unitPrice"))}
                    aria-invalid={Boolean(errors.unitPrice) || undefined}
                    className="h-9"
                    data-testid={ids.unitPrice}
                    id={ids.unitPrice}
                    onKeyDown={(event) => handleEnter(event, index, "unitPrice")}
                    {...row.unitPrice}
                  />
                </LineField>
                {withDiscount ? (
                  <LineField error={errors.discountPct} errorId={errorId(ids.discountPct, "discountPct")} htmlFor={ids.discountPct} label="Descuento (%)" lineNumber={lineNumber}>
                    <PercentInput
                      aria-describedby={errorId(ids.discountPct, "discountPct")}
                      aria-invalid={Boolean(errors.discountPct) || undefined}
                      className="h-9"
                      data-testid={ids.discountPct}
                      id={ids.discountPct}
                      onKeyDown={(event) => handleEnter(event, index, "discountPct")}
                      placeholder="0"
                      {...row.discountPct}
                    />
                  </LineField>
                ) : null}
                {tax.kind === "multi" ? (
                  <LineField error={errors.tax} label="Impuestos" lineNumber={lineNumber}>
                    <LineTaxPicker
                      binding={row.taxCheckbox}
                      lineNumber={lineNumber}
                      selectedTaxes={tax.taxes.filter((option) => row.selectedTaxIds?.includes(option.id))}
                      taxes={tax.taxes}
                      testId={ids.taxes}
                    />
                  </LineField>
                ) : null}
                {tax.kind === "vat" ? (
                  <LineField error={errors.tax} errorId={errorId(ids.taxRate, "tax")} htmlFor={ids.taxRate} label="IVA" lineNumber={lineNumber}>
                    <Select
                      aria-describedby={errorId(ids.taxRate, "tax")}
                      aria-invalid={Boolean(errors.tax) || undefined}
                      className="h-9"
                      data-testid={ids.taxRate}
                      id={ids.taxRate}
                      onKeyDown={(event) => handleEnter(event, index, "tax")}
                      {...row.taxRate}
                    >
                      {vatRateOptions(typeof row.taxRate?.value === "string" ? row.taxRate.value : undefined, tax.defaultRate).map((rate) => (
                        <option key={rate} value={String(rate)}>{vatRateLabel(rate)}</option>
                      ))}
                    </Select>
                  </LineField>
                ) : null}
                {tax.kind === "fixed" ? (
                  <div className={cn("col-span-2 min-w-0 space-y-1 lg:col-span-1 lg:flex lg:min-h-9 lg:items-center", FIELD_SCROLL_MARGIN)} data-testid={ids.taxes}>
                    <p className="font-mono text-xs">
                      <span className="font-bold lg:sr-only">Impuestos<span className="sr-only"> de la línea {lineNumber}</span>: </span>
                      <span className="text-muted-foreground">{row.taxText ?? "Sin impuestos"}</span>
                    </p>
                  </div>
                ) : null}
                {endColumns.map(renderExtra)}
                {/* Pie de la tarjeta móvil (acciones a la izquierda, importe a la derecha); en escritorio, dos celdas. */}
                <div className="col-span-2 flex flex-row-reverse items-center justify-between gap-2 border-t border-window-shadow pt-2 lg:contents">
                  <LineTotal
                    amount={formatMoney(row.total.amount, currencyCode)}
                    base={row.total.base === null || row.total.base === undefined ? null : formatMoney(row.total.base, currencyCode)}
                    label={totalLabel}
                  />
                  <LineActions
                    canAdd={canAdd}
                    canRemove={lineCount > minLines}
                    idPrefix={idPrefix}
                    index={index}
                    lineCount={lineCount}
                    onDuplicate={onDuplicate ? duplicate : undefined}
                    onMove={onMove ? move : undefined}
                    onRemove={remove}
                    removeVerb={removeVerb}
                  />
                </div>
              </fieldset>
            );
          })}
        </div>
      )}
      {addButtons ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{lineCount} línea{lineCount === 1 ? "" : "s"}{Number.isFinite(maxLines) && !canAdd ? ` (máximo ${maxLines})` : ""}</p>
          <Button disabled={!canAdd} onClick={add} size="sm" type="button" variant="ghost"><Plus aria-hidden="true" />Añadir otra línea</Button>
        </div>
      ) : null}
    </section>
  );
}

/** Texto de error de un campo de línea (mismo estilo que `FormErrorMessage`). */
export function LineErrorText({ children, className, id }: { children?: React.ReactNode; className?: string; id?: string }) {
  if (!children) return null;
  return (
    <p className={cn("font-mono text-xs text-danger-text", className)} id={id} role="alert">
      {children}
    </p>
  );
}

/**
 * Celda de una línea con un único nombre accesible: la etiqueta visible (oculta
 * en escritorio, donde manda la cabecera) más «de la línea N» solo para lectores.
 * `wide` ocupa las dos columnas de la tarjeta móvil (concepto, artículo).
 */
function LineField({
  children,
  error,
  errorId,
  hint,
  hintId,
  htmlFor,
  label,
  lineNumber,
  wide = false,
}: {
  children: React.ReactNode;
  error?: string;
  errorId?: string;
  hint?: string;
  hintId?: string;
  /** Sin `htmlFor` la etiqueta es un texto (p. ej. el desplegable de impuestos, que nombra su `summary`). */
  htmlFor?: string;
  label: string;
  lineNumber: number;
  wide?: boolean;
}) {
  const labelClassName = "font-mono text-xs font-bold lg:sr-only";
  return (
    <div className={cn("min-w-0 space-y-1", FIELD_SCROLL_MARGIN, wide ? "col-span-2 lg:col-span-1" : "col-span-1")}>
      {htmlFor ? (
        <label className={labelClassName} htmlFor={htmlFor}>
          {label}<span className="sr-only"> de la línea {lineNumber}</span>
        </label>
      ) : (
        <span aria-hidden="true" className={cn("block", labelClassName)}>{label}</span>
      )}
      {children}
      {hint ? <p className="text-xs text-muted-foreground lg:sr-only" id={hintId}>{hint}</p> : null}
      <LineErrorText id={errorId}>{error}</LineErrorText>
    </div>
  );
}

/** Importe de la línea: destacado y alineado a la derecha, con la base si difiere. */
function LineTotal({ amount, base, label }: { amount: string; base?: string | null; label: string }) {
  return (
    <div className="min-w-0 text-right font-mono tabular-nums lg:flex lg:min-h-9 lg:flex-col lg:items-end lg:justify-center">
      <span className="block text-xs font-bold text-muted-foreground lg:sr-only">{label}</span>
      <span className="block text-base font-bold lg:text-control">{amount}</span>
      {base ? <span className="block text-xs text-muted-foreground">Base {base}</span> : null}
    </div>
  );
}

/**
 * Acciones de una línea. Escritorio: subir, bajar, duplicar y eliminar como
 * iconos. Móvil: «Eliminar» siempre visible y el resto en un menú «Más», ambos
 * de 40 px para el dedo. Las acciones sin callback no se muestran.
 */
function LineActions({
  canAdd,
  canRemove,
  idPrefix,
  index,
  lineCount,
  onDuplicate,
  onMove,
  onRemove,
  removeVerb,
}: {
  canAdd: boolean;
  canRemove: boolean;
  idPrefix: string;
  index: number;
  lineCount: number;
  onDuplicate?: (index: number) => void;
  onMove?: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  removeVerb: string;
}) {
  const lineNumber = index + 1;
  const isFirst = index === 0;
  const isLast = index === lineCount - 1;
  const removeLabel = `${removeVerb} línea ${lineNumber}`;
  return (
    <div aria-label={`Acciones línea ${lineNumber}`} className="flex items-center gap-1 lg:min-h-9 lg:justify-end lg:gap-0.5" role="group">
      <div className="hidden lg:contents">
        {onMove ? (
          <>
            <Button aria-label={`Subir línea ${lineNumber}`} disabled={isFirst} id={lineFieldId(idPrefix, index, "move-up")} onClick={() => onMove(index, index - 1)} size="icon-sm" title="Subir" type="button" variant="ghost"><ArrowUp aria-hidden="true" /></Button>
            <Button aria-label={`Bajar línea ${lineNumber}`} disabled={isLast} id={lineFieldId(idPrefix, index, "move-down")} onClick={() => onMove(index, index + 1)} size="icon-sm" title="Bajar" type="button" variant="ghost"><ArrowDown aria-hidden="true" /></Button>
          </>
        ) : null}
        {onDuplicate ? (
          <Button aria-label={`Duplicar línea ${lineNumber}`} disabled={!canAdd} onClick={() => onDuplicate(index)} size="icon-sm" title="Duplicar" type="button" variant="ghost"><Copy aria-hidden="true" /></Button>
        ) : null}
        <Button aria-label={removeLabel} disabled={!canRemove} onClick={() => onRemove(index)} size="icon-sm" title={removeVerb} type="button" variant="ghost"><Trash aria-hidden="true" /></Button>
      </div>
      <div className="flex items-center gap-1 lg:hidden">
        {onMove || onDuplicate ? (
          <DropdownMenu
            align="start"
            label={`Más acciones de la línea ${lineNumber}`}
            trigger={<DotsThree aria-hidden="true" className="size-4" weight="bold" />}
            triggerClassName="size-10"
            triggerSize="icon"
          >
            {onMove ? (
              <>
                <DropdownMenuItem aria-disabled={isFirst || undefined} disabled={isFirst} onClick={() => onMove(index, index - 1)}>
                  <ArrowUp aria-hidden="true" />Subir línea
                </DropdownMenuItem>
                <DropdownMenuItem aria-disabled={isLast || undefined} disabled={isLast} onClick={() => onMove(index, index + 1)}>
                  <ArrowDown aria-hidden="true" />Bajar línea
                </DropdownMenuItem>
              </>
            ) : null}
            {onDuplicate ? (
              <DropdownMenuItem aria-disabled={!canAdd || undefined} disabled={!canAdd} onClick={() => onDuplicate(index)}>
                <Copy aria-hidden="true" />Duplicar línea
              </DropdownMenuItem>
            ) : null}
          </DropdownMenu>
        ) : null}
        <Button aria-label={removeLabel} className="size-10" disabled={!canRemove} onClick={() => onRemove(index)} size="icon" title={removeVerb} type="button" variant="outline"><Trash aria-hidden="true" className="size-4" /></Button>
      </div>
    </div>
  );
}

/** Mueve el foco al primer elemento visible de la lista (los botones de escritorio se ocultan en móvil). */
function focusFirstVisible(ids: string[]) {
  for (const id of ids) {
    const element = document.getElementById(id);
    if (element && element.getClientRects().length > 0) {
      element.focus();
      return;
    }
  }
}

/** Desplegable de impuestos de una línea (casillas): se cierra al pulsar fuera o con Escape. */
function LineTaxPicker({
  binding,
  lineNumber,
  selectedTaxes,
  taxes,
  testId,
}: {
  binding?: (taxId: string) => CheckboxBinding;
  lineNumber: number;
  selectedTaxes: readonly LineTaxOption[];
  taxes: readonly LineTaxOption[];
  testId: string;
}) {
  const signedRate = (option: LineTaxOption) => `${option.operation === "SUBTRACT" ? "−" : ""}${formatPercent(option.rate)}`;
  return (
    <DismissibleDetails data-testid={testId}>
      <summary aria-label={taxPickerLabel(lineNumber, selectedTaxes.map((option) => `${option.name} ${signedRate(option)}`))} className={PICKER_SUMMARY}>
        <span className="truncate">{selectedTaxes.length ? selectedTaxes.map((option) => option.name).join(" · ") : "Sin impuestos"}</span>
        <CaretDown className="shrink-0 motion-safe:transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className={cn(PICKER_PANEL, "max-h-64")}>
        {taxes.map((option) => (
          <label className={cn(PICKER_OPTION, "items-center", option.isActive === false && "opacity-60")} key={option.id}>
            <input className="size-4 shrink-0 accent-primary" type="checkbox" value={option.id} {...binding?.(option.id)} />
            <span className="flex min-w-0 flex-1 justify-between gap-2">
              <span className="truncate">{option.name}{option.isActive === false ? " (archivado)" : ""}</span>
              <span className="shrink-0 font-mono text-muted-foreground">{option.operation === "SUBTRACT" ? "−" : "+"}{formatPercent(option.rate)}</span>
            </span>
          </label>
        ))}
        {taxes.length === 0 ? <p className="p-2 text-xs text-muted-foreground">No hay impuestos configurados. Créalos en Configuración › Maestros.</p> : null}
      </div>
    </DismissibleDetails>
  );
}

/**
 * `<details>` desplegable que se cierra al pulsar fuera, con Escape (devolviendo
 * el foco al `summary`) o cuando el foco sale de él.
 */
export function DismissibleDetails({ className, onKeyDown, onToggle, ...props }: React.ComponentProps<"details">) {
  const ref = React.useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const details = ref.current;
      if (details && !details.contains(event.target as Node)) details.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  return (
    <details
      className={cn("group relative min-w-0", className)}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && !event.currentTarget.contains(next)) event.currentTarget.open = false;
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.key !== "Escape" || !event.currentTarget.open) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        onToggle?.(event);
      }}
      ref={ref}
      {...props}
    />
  );
}
