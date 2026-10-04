"use client";

import { ArrowDown, ArrowUp, Copy, DotsThree, Plus, Trash } from "@phosphor-icons/react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { FIELD_SCROLL_MARGIN } from "@/components/ui/form";
import { cn } from "@/lib/utils";

/**
 * Piezas comunes de los editores de líneas (facturas con react-hook-form y
 * documentos comerciales controlados): misma cabecera, misma rejilla, misma
 * tarjeta en móvil, mismas acciones de línea y mismo desplegable de impuestos.
 *
 * Móvil (<lg): cada línea es una tarjeta con el concepto arriba, los campos
 * numéricos en dos columnas y el total destacado a la derecha.
 * Escritorio (lg+): una fila de rejilla por línea con cabecera de columnas.
 */

export type LineColumn = { label: string; numeric?: boolean };

/** Encabezado de la sección: título, ayuda de teclado y botón «Añadir línea». */
export function LineEditorSection({
  addTestId,
  children,
  count,
  description,
  onAdd,
  onKeyDown,
  title,
  titleId,
}: {
  addTestId: string;
  children: React.ReactNode;
  count: number;
  description: React.ReactNode;
  onAdd: () => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLElement>;
  title: React.ReactNode;
  titleId: string;
}) {
  return (
    <section aria-labelledby={titleId} className="space-y-2" onKeyDown={onKeyDown}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-mono text-sm font-bold" id={titleId}>{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Button aria-keyshortcuts="Alt+L" className="max-sm:w-full" data-testid={addTestId} onClick={onAdd} type="button" variant="outline">
          <Plus aria-hidden="true" />
          Añadir línea
        </Button>
      </div>
      {children}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{count} línea{count === 1 ? "" : "s"}</p>
        <Button onClick={onAdd} size="sm" type="button" variant="ghost"><Plus aria-hidden="true" />Añadir otra línea</Button>
      </div>
    </section>
  );
}

/**
 * Contenedor de las líneas. En escritorio pinta la cabecera de columnas
 * (decorativa: cada campo ya tiene su etiqueta accesible) con las columnas
 * numéricas alineadas a la derecha.
 */
export function LineEditorTable({ children, columns, gridTemplate }: { children: React.ReactNode; columns: LineColumn[]; gridTemplate: string }) {
  return (
    <div className="space-y-2 lg:space-y-0 lg:rounded-surface lg:border lg:border-window-dark-shadow lg:bg-window-surface">
      <div aria-hidden="true" className={cn("hidden gap-px border-b border-window-dark-shadow bg-window-dark-shadow lg:grid", gridTemplate)}>
        {columns.map((column) => (
          <div className={cn("bg-window-panel px-2 py-1.5 font-mono text-xs font-bold uppercase tracking-[0.04em]", column.numeric && "text-right")} key={column.label}>
            {column.label}
          </div>
        ))}
      </div>
      {children}
    </div>
  );
}

/** Una línea: tarjeta en móvil, fila de la rejilla en escritorio. */
export function LineEditorRow({
  as: Component = "fieldset",
  children,
  gridTemplate,
  lineNumber,
  testId,
}: {
  as?: "fieldset" | "article";
  children: React.ReactNode;
  gridTemplate: string;
  lineNumber: number;
  testId: string;
}) {
  return (
    <Component
      aria-label={Component === "article" ? `Línea ${lineNumber}` : undefined}
      className={cn(
        "grid min-w-0 grid-cols-2 gap-x-2 gap-y-2 rounded-surface border border-window-dark-shadow bg-card p-2 shadow-drop-sm",
        "lg:items-start lg:gap-1 lg:rounded-none lg:border-x-0 lg:border-t-0 lg:border-window-shadow lg:shadow-none lg:last:border-b-0",
        gridTemplate,
      )}
      data-testid={testId}
    >
      {Component === "fieldset" ? <legend className="sr-only">Línea {lineNumber}</legend> : null}
      {children}
    </Component>
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
 * Campo de una línea con un único nombre accesible: la etiqueta visible (oculta
 * en escritorio, donde manda la cabecera) más «de la línea N» solo para lectores.
 * `wide` ocupa las dos columnas de la tarjeta móvil (concepto, artículo).
 */
export function LineField({
  children,
  error,
  errorId,
  htmlFor,
  label,
  lineNumber,
  wide = false,
}: {
  children: React.ReactNode;
  error?: string;
  errorId?: string;
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
      <LineErrorText id={errorId}>{error}</LineErrorText>
    </div>
  );
}

/** Pie de la tarjeta móvil (acciones a la izquierda, total a la derecha); en escritorio sus hijos son celdas. */
export function LineFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="col-span-2 flex flex-row-reverse items-center justify-between gap-2 border-t border-window-shadow pt-2 lg:contents">
      {children}
    </div>
  );
}

/** Importe de la línea: destacado y alineado a la derecha, con la base si difiere. */
export function LineTotal({ amount, base, label }: { amount: string; base?: string | null; label: string }) {
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
 * de 40 px para el dedo.
 */
export function LineActions({
  canRemove,
  idPrefix,
  index,
  lineCount,
  onDuplicate,
  onMove,
  onRemove,
}: {
  canRemove: boolean;
  /** Si se indica, los botones de subir/bajar reciben id (`{idPrefix}-{n}-move-up`) para recuperar el foco. */
  idPrefix?: string;
  index: number;
  lineCount: number;
  onDuplicate: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}) {
  const lineNumber = index + 1;
  const isFirst = index === 0;
  const isLast = index === lineCount - 1;
  return (
    <div aria-label={`Acciones línea ${lineNumber}`} className="flex items-center gap-1 lg:min-h-9 lg:justify-end lg:gap-0.5" role="group">
      <div className="hidden lg:contents">
        <Button aria-label={`Subir línea ${lineNumber}`} disabled={isFirst} id={idPrefix ? `${idPrefix}-${lineNumber}-move-up` : undefined} onClick={() => onMove(index, index - 1)} size="icon-sm" title="Subir" type="button" variant="ghost"><ArrowUp aria-hidden="true" /></Button>
        <Button aria-label={`Bajar línea ${lineNumber}`} disabled={isLast} id={idPrefix ? `${idPrefix}-${lineNumber}-move-down` : undefined} onClick={() => onMove(index, index + 1)} size="icon-sm" title="Bajar" type="button" variant="ghost"><ArrowDown aria-hidden="true" /></Button>
        <Button aria-label={`Duplicar línea ${lineNumber}`} onClick={() => onDuplicate(index)} size="icon-sm" title="Duplicar" type="button" variant="ghost"><Copy aria-hidden="true" /></Button>
        <Button aria-label={`Eliminar línea ${lineNumber}`} disabled={!canRemove} onClick={() => onRemove(index)} size="icon-sm" title="Eliminar" type="button" variant="ghost"><Trash aria-hidden="true" /></Button>
      </div>
      <div className="flex items-center gap-1 lg:hidden">
        <DropdownMenu
          align="start"
          label={`Más acciones de la línea ${lineNumber}`}
          trigger={<DotsThree aria-hidden="true" className="size-4" weight="bold" />}
          triggerClassName="size-10"
          triggerSize="icon"
        >
          <DropdownMenuItem aria-disabled={isFirst || undefined} disabled={isFirst} onClick={() => onMove(index, index - 1)}>
            <ArrowUp aria-hidden="true" />Subir línea
          </DropdownMenuItem>
          <DropdownMenuItem aria-disabled={isLast || undefined} disabled={isLast} onClick={() => onMove(index, index + 1)}>
            <ArrowDown aria-hidden="true" />Bajar línea
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onDuplicate(index)}>
            <Copy aria-hidden="true" />Duplicar línea
          </DropdownMenuItem>
        </DropdownMenu>
        <Button aria-label={`Eliminar línea ${lineNumber}`} className="size-10" disabled={!canRemove} onClick={() => onRemove(index)} size="icon" title="Eliminar" type="button" variant="outline"><Trash aria-hidden="true" className="size-4" /></Button>
      </div>
    </div>
  );
}

/** Mueve el foco al primer elemento visible de la lista (los botones de escritorio se ocultan en móvil). */
export function focusFirstVisible(ids: string[]) {
  for (const id of ids) {
    const element = document.getElementById(id);
    if (element && element.getClientRects().length > 0) {
      element.focus();
      return;
    }
  }
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
