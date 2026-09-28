"use client";

import { ArrowClockwise, CaretDown, CaretRight } from "@phosphor-icons/react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import { AccountCode, AmountCell, BalanceCell, BlockedIcon, Highlighted, PartnerBadge } from "@/components/accounting/chart/account-code";
import { Button } from "@/components/ui/button";
import { groupAccentVar } from "@/lib/chart-of-accounts/format";
import { scrollToReveal, treeKeyAction, visibleWindow, type TreeKeyAction, type VisibleRow } from "@/lib/chart-of-accounts/tree";
import { cn } from "@/lib/utils";

export const TREE_GRID_COLUMNS = "grid-cols-[minmax(10rem,15rem)_minmax(8rem,1fr)_minmax(5.5rem,7rem)_minmax(5.5rem,7rem)_minmax(7rem,9rem)]";
const INDENT_REM = 0.875;

type AccountTreeProps = {
  rows: readonly VisibleRow[];
  rowHeight: number;
  focusedCode: string | null;
  selectedCode: string | null;
  matchCodes: ReadonlySet<string>;
  query: string;
  /** Búsqueda con el atajo del punto: la coincidencia es el código entero. */
  exactCodeMatch: boolean;
  label: string;
  onFocusCode: (code: string) => void;
  onAction: (action: TreeKeyAction, position?: { x: number; y: number }) => void;
  onToggle: (code: string) => void;
  onRetry: (code: string) => void;
  /** Id del elemento que describe el árbol (ayuda de teclado). */
  describedBy?: string;
  /** Fila que hay que traer a la vista sin moverle el foco (búsqueda, selección desde fuera). */
  scrollTarget?: { code: string; nonce: number } | null;
};

function escapeAttribute(value: string) {
  return value.replace(/["\\]/g, "\\$&");
}

/**
 * Árbol del plan contable (patrón treegrid de WAI-ARIA) virtualizado con filas de alto fijo:
 * solo se pintan las filas a la vista (y la enfocada), con foco itinerante (una fila con tabindex 0).
 */
export function AccountTree({
  describedBy,
  exactCodeMatch,
  focusedCode,
  label,
  matchCodes,
  onAction,
  onFocusCode,
  onRetry,
  onToggle,
  query,
  rowHeight,
  rows,
  scrollTarget,
  selectedCode,
}: AccountTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(560);
  const keyboardFocusRef = useRef(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setViewportHeight(element.clientHeight || 560);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const focusedIndex = useMemo(() => {
    const index = focusedCode ? rows.findIndex((row) => row.kind === "node" && row.key === focusedCode) : -1;
    return index >= 0 ? index : rows.findIndex((row) => row.kind === "node");
  }, [focusedCode, rows]);
  const tabCode = focusedIndex >= 0 ? rows[focusedIndex]?.key : null;

  const { start, end } = visibleWindow({ scrollTop, viewportHeight, rowHeight, total: rows.length });
  const indices = useMemo(() => {
    const list: number[] = [];
    for (let index = start; index < end; index += 1) list.push(index);
    if (focusedIndex >= 0 && (focusedIndex < start || focusedIndex >= end)) list.push(focusedIndex);
    return list;
  }, [end, focusedIndex, start]);

  // Tras mover el foco con el teclado: desplaza hasta la fila y la enfoca.
  useLayoutEffect(() => {
    if (!keyboardFocusRef.current || focusedIndex < 0) return;
    keyboardFocusRef.current = false;
    const container = containerRef.current;
    if (!container) return;
    const target = scrollToReveal({ index: focusedIndex, scrollTop: container.scrollTop, viewportHeight: container.clientHeight, rowHeight, headerHeight: rowHeight });
    // El evento scroll actualiza la ventana de filas pintadas.
    if (target !== null) container.scrollTop = target;
    const key = rows[focusedIndex]?.key;
    if (key) container.querySelector<HTMLElement>(`[data-row-key="${escapeAttribute(key)}"]`)?.focus({ preventScroll: true });
  }, [focusedIndex, rowHeight, rows]);

  // Trae a la vista la fila pedida en cuanto está en la lista (puede llegar después de cargar).
  const scrolledNonceRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!scrollTarget || scrolledNonceRef.current === scrollTarget.nonce) return;
    const index = rows.findIndex((row) => row.kind === "node" && row.key === scrollTarget.code);
    const container = containerRef.current;
    if (index < 0 || !container) return;
    scrolledNonceRef.current = scrollTarget.nonce;
    const target = scrollToReveal({ index, scrollTop: container.scrollTop, viewportHeight: container.clientHeight, rowHeight, headerHeight: rowHeight });
    // Fuera de la vista: la fila queda a un tercio de la altura, con contexto por encima.
    if (target !== null) container.scrollTop = Math.max(0, index * rowHeight - Math.floor(container.clientHeight / 3));
  }, [rowHeight, rows, scrollTarget]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "row") return;
    const index = Number(event.target.dataset.index ?? -1);
    const action = treeKeyAction(rows, index, { key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey });
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (action.type === "focus") {
      const row = rows[action.index];
      if (row?.kind === "node") {
        keyboardFocusRef.current = true;
        onFocusCode(row.key);
      }
      return;
    }
    if (action.type === "menu") {
      const rect = event.target.getBoundingClientRect();
      onAction(action, { x: rect.left + 48, y: rect.bottom });
      return;
    }
    if (action.type === "expand" || action.type === "collapse" || action.type === "expandSiblings") keyboardFocusRef.current = true;
    onAction(action);
  }

  return (
    <div
      aria-colcount={5}
      aria-describedby={describedBy}
      aria-label={label}
      aria-rowcount={rows.length + 1}
      className="relative h-[min(68vh,44rem)] min-h-64 overflow-auto border border-window-dark-shadow bg-card text-xs shadow-[inset_1px_1px_0_var(--window-shadow)]"
      data-testid="account-tree"
      onKeyDown={handleKeyDown}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      ref={containerRef}
      role="treegrid"
    >
      <div
        aria-rowindex={1}
        className={cn("sticky top-0 z-10 grid min-w-[40rem] items-center border-b border-window-dark-shadow bg-window-panel font-mono font-bold text-window-text", TREE_GRID_COLUMNS)}
        role="row"
        style={{ height: rowHeight }}
      >
        <span className="px-2" role="columnheader">Código</span>
        <span className="px-2" role="columnheader">Cuenta</span>
        <span className="px-2 text-right" role="columnheader">Debe</span>
        <span className="px-2 text-right" role="columnheader">Haber</span>
        <span className="px-2 text-right" role="columnheader">Saldo</span>
      </div>
      <div className="relative min-w-[40rem]" role="rowgroup" style={{ height: rows.length * rowHeight }}>
        {indices.map((index) => {
          const row = rows[index];
          if (!row) return null;
          const style = { top: index * rowHeight, height: rowHeight };
          if (row.kind === "node") {
            return (
              <TreeRow
                exactCodeMatch={exactCodeMatch}
                index={index}
                isFocusTarget={row.key === tabCode}
                isMatch={matchCodes.has(row.key)}
                isSelected={row.key === selectedCode}
                key={row.key}
                onAction={onAction}
                onFocusCode={onFocusCode}
                onToggle={onToggle}
                query={query}
                row={row}
                style={style}
              />
            );
          }
          return <StatusRow index={index} key={row.key} onRetry={onRetry} row={row} style={style} />;
        })}
      </div>
    </div>
  );
}

type NodeRow = Extract<VisibleRow, { kind: "node" }>;

type TreeRowProps = {
  row: NodeRow;
  index: number;
  style: { top: number; height: number };
  isFocusTarget: boolean;
  isSelected: boolean;
  isMatch: boolean;
  query: string;
  exactCodeMatch: boolean;
  onFocusCode: (code: string) => void;
  onAction: (action: TreeKeyAction, position?: { x: number; y: number }) => void;
  onToggle: (code: string) => void;
};

const TreeRow = memo(function TreeRow({ exactCodeMatch, index, isFocusTarget, isMatch, isSelected, onAction, onFocusCode, onToggle, query, row, style }: TreeRowProps) {
  const { node } = row;
  const isGroupRow = node.level === 1;
  const indent = (row.depth - 1) * INDENT_REM;

  return (
    <div
      aria-expanded={row.expandable ? row.expanded : undefined}
      aria-level={row.depth}
      aria-posinset={row.posinset}
      aria-rowindex={index + 2}
      aria-selected={isSelected}
      aria-setsize={row.setsize}
      className={cn(
        "absolute inset-x-0 grid cursor-default items-center border-b border-window-shadow/40 outline-none",
        TREE_GRID_COLUMNS,
        isGroupRow && "bg-window-panel",
        !node.isPostable && "font-bold",
        isSelected && "bg-window-surface shadow-[inset_0_0_0_1px_var(--focus-accent)]",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-dashed focus-visible:outline-focus-accent",
      )}
      data-code={node.code}
      data-index={index}
      data-row-key={row.key}
      data-testid="account-tree-row"
      onClick={() => {
        onFocusCode(node.code);
        onAction({ type: "open", code: node.code });
      }}
      onContextMenu={(event: MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        onFocusCode(node.code);
        onAction({ type: "menu", code: node.code }, { x: event.clientX, y: event.clientY });
      }}
      onDoubleClick={() => {
        if (row.expandable) onToggle(node.code);
      }}
      role="row"
      style={style}
      tabIndex={isFocusTarget ? 0 : -1}
    >
      <span className="relative flex h-full min-w-0 items-center" role="gridcell">
        <span
          aria-hidden="true"
          className="flex h-full w-5 shrink-0 items-center justify-center border-l-4 font-mono text-xs font-bold text-muted-foreground"
          style={{ borderLeftColor: groupAccentVar(node.code) }}
          title={`Grupo ${node.code.charAt(0)}`}
        >
          {node.code.charAt(0)}
        </span>
        <span aria-hidden="true" className="relative h-full shrink-0" style={{ width: `${indent}rem` }}>
          {Array.from({ length: row.depth - 1 }, (_, level) => (
            <span className="absolute inset-y-0 border-l border-dotted border-window-shadow" key={level} style={{ left: `${level * INDENT_REM + INDENT_REM / 2}rem` }} />
          ))}
        </span>
        <span className="flex w-4 shrink-0 justify-center">
          {row.expandable ? (
            <span
              aria-hidden="true"
              className="inline-flex size-4 items-center justify-center rounded-[1px] text-window-text hover:bg-window-highlight"
              onClick={(event) => {
                event.stopPropagation();
                onFocusCode(node.code);
                onToggle(node.code);
              }}
            >
              {row.expanded ? <CaretDown className="size-3" weight="bold" /> : <CaretRight className="size-3" weight="bold" />}
            </span>
          ) : null}
        </span>
        <AccountCode className="ml-0.5 truncate" code={node.code} highlightAll={isMatch && exactCodeMatch} highlightPrefix={isMatch ? query.trim() : undefined} parentCode={node.parentCode} />
      </span>
      <span className="flex min-w-0 items-center gap-1 px-2" role="gridcell">
        <span className="truncate">
          <Highlighted query={isMatch ? query : ""} text={node.name} />
        </span>
        {node.partnerId ? <PartnerBadge name={node.partnerName} taxId={node.partnerTaxId} /> : null}
        {node.isBlocked ? <BlockedIcon /> : null}
      </span>
      <span className="px-2 text-right" role="gridcell">
        <AmountCell cents={node.debitCents} />
      </span>
      <span className="px-2 text-right" role="gridcell">
        <AmountCell cents={node.creditCents} />
      </span>
      <span className="px-2 text-right" role="gridcell">
        <BalanceCell cents={node.balanceCents} nature={node.nature} />
      </span>
    </div>
  );
});

function StatusRow({ index, onRetry, row, style }: { row: Exclude<VisibleRow, { kind: "node" }>; index: number; style: { top: number; height: number }; onRetry: (code: string) => void }) {
  const indent = { paddingLeft: `${1.25 + row.depth * INDENT_REM}rem` };
  return (
    <div aria-rowindex={index + 2} className={cn("absolute inset-x-0 flex items-center gap-2 border-b border-window-shadow/40", row.kind === "loading" && "motion-safe:animate-pulse")} role="row" style={style}>
      <span className="flex min-w-0 flex-1 items-center gap-2" role="gridcell" style={indent}>
        {row.kind === "loading" ? (
          <>
            <span aria-hidden="true" className="h-3 w-16 rounded-[1px] bg-window-shadow/40" />
            <span aria-hidden="true" className="h-3 w-40 rounded-[1px] bg-window-shadow/30" />
            <span className="sr-only">Cargando subcuentas…</span>
          </>
        ) : row.kind === "error" ? (
          <>
            <span className="truncate text-danger-text">{row.message}</span>
            <Button onClick={() => onRetry(row.parentCode)} size="xs" type="button" variant="outline">
              <ArrowClockwise aria-hidden="true" />
              Reintentar
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground">Ninguna cuenta de esta rama cumple los filtros.</span>
        )}
      </span>
    </div>
  );
}
