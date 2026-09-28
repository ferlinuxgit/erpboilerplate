"use client";

import { ArrowClockwise, CaretRight, Info } from "@phosphor-icons/react";

import { AccountCode, BalanceCell, BlockedIcon, Highlighted, PartnerBadge } from "@/components/accounting/chart/account-code";
import { Button } from "@/components/ui/button";
import { ROOT_KEY, isExpandable, type LoadStatus, type TreeStore } from "@/lib/chart-of-accounts/tree";

type ChartMobileViewProps = {
  store: TreeStore;
  parentCode: string;
  status: ReadonlyMap<string, LoadStatus>;
  query: string;
  matchCodes: ReadonlySet<string>;
  onNavigate: (code: string) => void;
  onOpen: (code: string) => void;
  onRetry: (code: string) => void;
};

/**
 * Móvil: un nivel cada vez, como un explorador de carpetas, con migas de pan. Pulsar una cuenta
 * con subcuentas entra en ella; una subcuenta abre la ficha a pantalla completa.
 */
export function ChartMobileView({ matchCodes, onNavigate, onOpen, onRetry, parentCode, query, status, store }: ChartMobileViewProps) {
  const trail: string[] = [];
  let cursor: string | null = parentCode || null;
  const guard = new Set<string>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    trail.unshift(cursor);
    cursor = store.nodes.get(cursor)?.parentCode ?? null;
  }
  const codes = store.children.get(parentCode) ?? [];
  const currentStatus = parentCode ? status.get(parentCode) : undefined;
  const loaded = store.loaded.has(parentCode || ROOT_KEY);

  return (
    <div className="space-y-2" data-testid="chart-mobile">
      <nav aria-label="Ruta en el plan contable">
        <ol className="flex flex-wrap items-center gap-1 font-mono text-xs">
          <li>
            {parentCode ? (
              <button className="text-link underline-offset-2 hover:underline" onClick={() => onNavigate(ROOT_KEY)} type="button">Plan</button>
            ) : (
              <span aria-current="location" className="font-bold">Plan</span>
            )}
          </li>
          {trail.map((code) => (
            <li className="flex items-center gap-1" key={code}>
              <span aria-hidden="true">›</span>
              {code === parentCode ? (
                <span aria-current="location" className="font-bold">{code} {store.nodes.get(code)?.name}</span>
              ) : (
                <button className="text-link underline-offset-2 hover:underline" onClick={() => onNavigate(code)} type="button">{code}</button>
              )}
            </li>
          ))}
        </ol>
      </nav>
      {currentStatus?.state === "error" ? (
        <div className="flex items-center gap-2 border border-destructive/70 bg-destructive/10 p-2 text-xs text-danger-text" role="alert">
          <span className="flex-1">{currentStatus.message}</span>
          <Button onClick={() => onRetry(parentCode)} size="xs" type="button" variant="outline">
            <ArrowClockwise aria-hidden="true" />
            Reintentar
          </Button>
        </div>
      ) : !loaded ? (
        <p className="p-2 text-xs text-muted-foreground motion-safe:animate-pulse" role="status">Cargando cuentas…</p>
      ) : codes.length === 0 ? (
        <p className="p-2 text-xs text-muted-foreground">No hay cuentas en este nivel con los filtros actuales.</p>
      ) : (
        <ul className="divide-y divide-window-shadow/60 border-y border-window-shadow/60">
          {codes.map((code) => {
            const node = store.nodes.get(code);
            if (!node) return null;
            const expandable = isExpandable(store, node);
            return (
              <li className="flex items-stretch" key={code}>
                <button
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-accent"
                  onClick={() => (expandable ? onNavigate(code) : onOpen(code))}
                  type="button"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1">
                      <AccountCode code={node.code} highlightPrefix={matchCodes.has(code) ? query.trim() : undefined} parentCode={node.parentCode} />
                      {node.partnerId ? <PartnerBadge name={node.partnerName} taxId={node.partnerTaxId} /> : null}
                      {node.isBlocked ? <BlockedIcon /> : null}
                    </span>
                    <span className={node.isPostable ? "block truncate" : "block truncate font-bold"}>
                      <Highlighted query={matchCodes.has(code) ? query : ""} text={node.name} />
                    </span>
                  </span>
                  <span className="shrink-0 text-xs">
                    <BalanceCell cents={node.balanceCents} nature={node.nature} />
                  </span>
                  {expandable ? <CaretRight aria-hidden="true" className="size-4 shrink-0" /> : null}
                  <span className="sr-only">{expandable ? `, ${node.childCount} cuentas dentro` : ", abrir ficha"}</span>
                </button>
                {expandable ? (
                  <button
                    aria-label={`Ficha de ${node.code} ${node.name}`}
                    className="flex w-11 shrink-0 items-center justify-center border-l border-window-shadow/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-accent"
                    onClick={() => onOpen(code)}
                    type="button"
                  >
                    <Info aria-hidden="true" className="size-4" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
