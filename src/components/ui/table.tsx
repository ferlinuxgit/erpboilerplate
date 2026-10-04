import * as React from "react";

import { cn } from "@/lib/utils";

export { TableContainer } from "@/components/ui/table-container";

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return <table className={cn("w-full caption-bottom font-mono text-xs tabular-nums", className)} {...props} />;
}

export function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("bg-window-panel [&_tr]:border-b [&_tr]:border-window-dark-shadow", className)} {...props} />;
}

export function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-b border-window-shadow hover:bg-window-highlight data-[state=selected]:bg-primary data-[state=selected]:text-primary-foreground", className)} {...props} />;
}

// Primera columna fija al desplazar en horizontal: lleva fondo propio (la tabla colapsa los
// bordes, así que la separación se pinta con una sombra de 1px que sí viaja con la celda).
const stickyCellClassName = "sticky left-0 z-1 shadow-[1px_0_0_var(--window-shadow)]";

type CellProps = {
  /** Fija la celda a la izquierda cuando la tabla se desplaza en horizontal (usar en la primera columna). */
  sticky?: boolean;
};

export function TableHead({ className, sticky, ...props }: React.ComponentProps<"th"> & CellProps) {
  return <th className={cn("h-8 border-r border-window-shadow px-2 text-left align-middle text-xs font-bold uppercase tracking-[0.02em] text-window-muted last:border-r-0", sticky && cn(stickyCellClassName, "bg-window-panel"), className)} {...props} />;
}

export function TableCell({ className, sticky, ...props }: React.ComponentProps<"td"> & CellProps) {
  return <td className={cn("border-r border-window-shadow/60 px-2 py-1.5 align-middle last:border-r-0", sticky && cn(stickyCellClassName, "bg-card [tfoot_&]:bg-window-panel [tr:hover>&]:bg-window-highlight"), className)} {...props} />;
}

export function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return <tfoot className={cn("border-t-2 border-window-dark-shadow bg-window-panel font-bold [&>tr]:last:border-b-0", className)} {...props} />;
}

export function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return <caption className={cn("mt-2 text-left text-xs text-muted-foreground", className)} {...props} />;
}

/*
 * Tablas que son formularios (recuentos, líneas editables): en móvil cada fila se apila como
 * tarjeta con el MISMO DOM, sin duplicar campos ni etiquetas. Cada celda muestra su cabecera
 * con `data-label`; `wide` ocupa la tarjeta entera con la etiqueta encima (campos de texto).
 * Uso: <TableContainer className={stackedOnMobile.container}><Table className={stackedOnMobile.table}>…
 */
const stackedCell = "max-md:flex max-md:items-baseline max-md:justify-between max-md:gap-3 max-md:border-0 max-md:p-0 max-md:text-right max-md:before:shrink-0 max-md:before:text-left max-md:before:font-normal max-md:before:text-muted-foreground max-md:before:content-[attr(data-label)]";

export const stackedOnMobile = {
  container: "max-md:border-0 max-md:bg-transparent",
  table: "max-md:block",
  header: "max-md:hidden",
  body: "max-md:grid max-md:gap-2",
  row: "max-md:grid max-md:gap-2 max-md:border! max-md:border-window-dark-shadow max-md:bg-card max-md:p-2.5 max-md:shadow-raised max-md:hover:bg-card",
  /** Cabecera de la tarjeta (concepto, artículo): sin etiqueta. */
  title: "max-md:block max-md:border-0 max-md:p-0 max-md:text-left",
  cell: stackedCell,
  wide: cn(stackedCell, "max-md:flex-col max-md:items-stretch max-md:gap-1 max-md:text-left"),
} as const;

/*
 * Alternativa móvil de una tabla: cada fila es una tarjeta con pares etiqueta/valor.
 * Patrón: `<TableContainer className="hidden md:block">…</TableContainer>` + `<MobileRecordList>`
 * (que ya se oculta desde md). Mismo aspecto que las tarjetas de ResourceList.
 */
export function MobileRecordList({ className, ...props }: React.ComponentProps<"ul">) {
  return <ul className={cn("grid gap-2 md:hidden", className)} role="list" {...props} />;
}

type MobileRecordProps = Omit<React.ComponentProps<"li">, "title"> & {
  /** Cabecera de la tarjeta (número, concepto…). */
  title?: React.ReactNode;
  /** Dato destacado a la derecha de la cabecera (importe, estado…). */
  aside?: React.ReactNode;
};

export function MobileRecord({ aside, children, className, title, ...props }: MobileRecordProps) {
  return (
    <li className={cn("min-w-0 border border-window-dark-shadow bg-card p-2.5 font-mono text-xs shadow-raised", className)} {...props}>
      {title || aside ? (
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0 break-words font-bold">{title}</div>
          {aside ? <div className="shrink-0 text-right font-bold tabular-nums">{aside}</div> : null}
        </div>
      ) : null}
      {children}
    </li>
  );
}

export function MobileRecordFields({ className, ...props }: React.ComponentProps<"dl">) {
  return <dl className={cn("grid gap-1.5", className)} {...props} />;
}

type MobileRecordFieldProps = Omit<React.ComponentProps<"div">, "children"> & {
  label: React.ReactNode;
  children: React.ReactNode;
  /** Importes y cantidades: cifras tabulares y en negrita. */
  numeric?: boolean;
};

export function MobileRecordField({ children, className, label, numeric, ...props }: MobileRecordFieldProps) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", className)} {...props}>
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 break-words text-right", numeric && "font-bold tabular-nums")}>{children}</dd>
    </div>
  );
}
