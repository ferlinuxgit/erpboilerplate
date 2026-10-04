"use client";

import { BalanceCell } from "@/components/accounting/chart/account-code";
import { Button } from "@/components/ui/button";
import { balanceSideWord, formatCents, groupAccentVar } from "@/lib/chart-of-accounts/format";
import { buildSchemeGroups, schemeResult } from "@/lib/chart-of-accounts/scheme";
import type { ChartNode } from "@/lib/chart-of-accounts/types";
import { formatMoney } from "@/lib/format";

type ChartSchemeViewProps = {
  nodes: readonly ChartNode[];
  currency: string;
  loading: boolean;
  onOpenInTree: (code: string) => void;
};

const bevel = "rounded-surface border border-window-dark-shadow bg-window-surface shadow-raised";

/**
 * Vista «Esquema»: los 9 grupos del PGC en tarjetas (3×3) con su saldo y barras por subgrupo
 * proporcionales al saldo (con el importe siempre en texto), y el resultado 7 − 6.
 */
export function ChartSchemeView({ currency, loading, nodes, onOpenInTree }: ChartSchemeViewProps) {
  const groups = buildSchemeGroups(nodes);
  const result = schemeResult(groups);
  const nature = (code: string) => nodes.find((node) => node.code === code)?.nature ?? "MIXED";

  return (
    <div aria-busy={loading || undefined} className="space-y-3" data-testid="chart-scheme">
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => {
          const empty = !group.hasMovements && group.balanceCents === 0;
          const titleId = `scheme-group-${group.code}`;
          if (empty && (group.code === "8" || group.code === "9")) {
            return (
              <details className={`${bevel} self-start`} data-testid="chart-scheme-group" key={group.code}>
                <summary className="flex cursor-pointer items-center gap-2 border-l-4 px-2 py-1.5 font-mono text-xs font-bold" style={{ borderLeftColor: groupAccentVar(group.code) }}>
                  <span>{group.code}</span>
                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
                  <span className="font-normal text-muted-foreground">Sin movimientos</span>
                </summary>
                <SubgroupList group={group} onOpenInTree={onOpenInTree} />
              </details>
            );
          }
          return (
            <section aria-labelledby={titleId} className={`${bevel} flex flex-col`} data-testid="chart-scheme-group" key={group.code}>
              <header className="flex items-start gap-2 border-b border-l-4 border-b-window-shadow bg-window-panel px-2 py-1.5" style={{ borderLeftColor: groupAccentVar(group.code) }}>
                <h3 className="min-w-0 flex-1 font-mono text-xs font-bold" id={titleId}>
                  <span className="mr-1">{group.code}</span>
                  {group.name}
                </h3>
                <span className="shrink-0 text-xs">
                  <BalanceCell cents={group.balanceCents} nature={nature(group.code)} />
                </span>
              </header>
              <SubgroupList group={group} onOpenInTree={onOpenInTree} />
              <div className="mt-auto border-t border-window-shadow/60 p-1.5">
                <Button onClick={() => onOpenInTree(group.code)} size="xs" type="button" variant="ghost">
                  Abrir en árbol
                </Button>
              </div>
            </section>
          );
        })}
      </div>
      <section aria-labelledby="scheme-result" className={`${bevel} flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2`} data-testid="chart-scheme-result">
        <h3 className="font-mono text-xs font-bold" id="scheme-result">Resultado = 7 − 6</h3>
        <span className="text-xs">Ingresos (7) {formatMoney(result.revenueCents / 100, currency)}</span>
        <span className="text-xs">− Gastos (6) {formatMoney(result.expenseCents / 100, currency)}</span>
        <span className={result.resultCents >= 0 ? "font-mono text-sm font-bold text-success-text" : "font-mono text-sm font-bold text-danger-text"}>
          = {result.resultCents >= 0 ? "Beneficio" : "Pérdida"} {formatMoney(Math.abs(result.resultCents) / 100, currency)}
        </span>
      </section>
    </div>
  );
}

function SubgroupList({ group, onOpenInTree }: { group: ReturnType<typeof buildSchemeGroups>[number]; onOpenInTree: (code: string) => void }) {
  if (group.subgroups.length === 0) return <p className="px-2 py-2 text-xs text-muted-foreground">Sin subgrupos en el plan.</p>;
  return (
    <ul className="space-y-0.5 p-1.5">
      {group.subgroups.map((subgroup) => (
        <li key={subgroup.code}>
          <button
            aria-label={`${subgroup.code} ${subgroup.name}: ${subgroup.balanceCents === 0 ? "saldo cero" : `${formatCents(Math.abs(subgroup.balanceCents))} ${balanceSideWord(subgroup.balanceCents)}`}. Abrir en el árbol`}
            className="grid w-full grid-cols-[2rem_minmax(0,1fr)_minmax(4rem,40%)] items-center gap-2 rounded-control px-1 py-0.5 text-left text-xs hover:bg-window-highlight focus-visible:outline-2 focus-visible:outline-focus-accent"
            onClick={() => onOpenInTree(subgroup.code)}
            type="button"
          >
            <span className="font-mono font-bold">{subgroup.code}</span>
            <span className="truncate">{subgroup.name}</span>
            <span className="flex items-center gap-1">
              <span aria-hidden="true" className="h-2.5 min-w-0 flex-1 bg-window-shadow/20">
                <span className="block h-full" style={{ width: `${Math.round(subgroup.share * 100)}%`, backgroundColor: groupAccentVar(group.code) }} />
              </span>
              <span className="w-[5.5rem] shrink-0 text-right font-mono tabular-nums">
                {subgroup.balanceCents === 0 ? <span className="text-muted-foreground">·</span> : `${formatCents(Math.abs(subgroup.balanceCents))} ${subgroup.balanceCents > 0 ? "D" : "A"}`}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
