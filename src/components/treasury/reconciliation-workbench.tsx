"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AssignAccountDialog } from "@/components/treasury/assign-account-dialog";
import { PENDING_ACCOUNT_EXPLANATION } from "@/components/treasury/movement-status";
import { acceptSafeReconciliations, applyReconciliation } from "@/components/treasury/reconciliation-api";
import { SplitAllocationDialog, type AccountOption, type InvoiceOption } from "@/components/treasury/split-allocation-dialog";
import { undoReconciliationRequest } from "@/components/treasury/undo-reconciliation-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState, InlineAlert } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import type { AllocationInput } from "@/lib/bank-import/allocations";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export type WorkbenchSuggestion = {
  key: string;
  kind: string;
  title: string;
  detail: string;
  score: number;
  confidence: "alta" | "media" | "baja";
  safe: boolean;
  ruleId?: string;
  allocations: AllocationInput[];
};

export type WorkbenchMovementRow = {
  id: string;
  bankName: string;
  amount: number;
  description: string;
  reference: string | null;
  postedAt: Date | string;
  suggestions: WorkbenchSuggestion[];
};

type Props = {
  movements: WorkbenchMovementRow[];
  customerInvoices: InvoiceOption[];
  supplierInvoices: InvoiceOption[];
  accounts: AccountOption[];
  currencyCode: string;
  canWrite: boolean;
  focusId?: string | null;
  truncated: boolean;
};

const confidenceTone = { alta: "success", media: "info", baja: "neutral" } as const;
const confidenceLabel = { alta: "Confianza alta", media: "Confianza media", baja: "Confianza baja" } as const;

function describeResult(created: string[]) {
  return created.length ? `Registrado: ${created.join(", ")}.` : "El banco y las facturas ya cuadran.";
}

/**
 * Mesa de conciliación: cada movimiento pendiente con sus propuestas. Nada se aplica sin que el
 * usuario lo acepte (una a una o "todas las seguras") y todo se puede deshacer desde el aviso.
 */
export function ReconciliationWorkbench({ accounts, canWrite, currencyCode, customerInvoices, focusId, movements, supplierInvoices, truncated }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [splitFor, setSplitFor] = useState<WorkbenchMovementRow | null>(null);
  const [assignFor, setAssignFor] = useState<WorkbenchMovementRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const safeIds = movements.filter((movement) => movement.suggestions[0]?.safe).map((movement) => movement.id);

  useEffect(() => {
    if (!focusId) return;
    document.getElementById(`movement-${focusId}`)?.scrollIntoView({ block: "center" });
  }, [focusId]);

  async function undo(ids: string[]) {
    try {
      const result = await undoReconciliationRequest(ids);
      toast.success(result.undone.length === 1 ? "Conciliación deshecha." : `${result.undone.length} conciliaciones deshechas.`, {
        description: result.failed.length ? `${result.failed.length} no se pudieron deshacer: ${result.failed[0].reason}` : "Los movimientos vuelven a estar pendientes.",
      });
      router.refresh();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "No se pudo deshacer.");
    }
  }

  function notifyApplied(transactionId: string, title: string, description: string) {
    toast.success(title, { description, action: { label: "Deshacer", onClick: () => void undo([transactionId]) }, duration: 10_000 });
  }

  async function accept(movement: WorkbenchMovementRow, suggestion: WorkbenchSuggestion) {
    setBusy(movement.id);
    setError(null);
    try {
      const result = await applyReconciliation({ transactionId: movement.id, allocations: suggestion.allocations, ruleId: suggestion.ruleId ?? null });
      notifyApplied(movement.id, `Conciliado: ${suggestion.title}`, describeResult(result.createdPayments));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo conciliar el movimiento.");
    } finally {
      setBusy(null);
    }
  }

  async function acceptAllSafe() {
    setBusy("bulk");
    setError(null);
    try {
      const result = await acceptSafeReconciliations(safeIds);
      const applied = result.applied.map((entry) => entry.transactionId);
      toast.success(`${applied.length} ${applied.length === 1 ? "movimiento conciliado" : "movimientos conciliados"}.`, {
        description: result.skipped.length ? `${result.skipped.length} no se pudieron aplicar: ${result.skipped[0].reason}` : "Solo se han aplicado las propuestas seguras.",
        action: applied.length ? { label: "Deshacer todo", onClick: () => void undo(applied) } : undefined,
        duration: 15_000,
      });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudieron aplicar las propuestas.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3" data-testid="reconciliation-workbench">
      <div className="flex flex-wrap items-center gap-2">
        {canWrite ? (
          <Button data-testid="accept-safe-suggestions" disabled={safeIds.length === 0 || busy !== null} onClick={() => void acceptAllSafe()} type="button">
            {busy === "bulk" ? "Aplicando…" : `Aceptar todas las seguras (${safeIds.length})`}
          </Button>
        ) : null}
        <Link className={buttonVariants({ variant: "outline" })} href="/treasury/import">Importar extracto</Link>
        <Link className={buttonVariants({ variant: "outline" })} href="/treasury/rules">Reglas de conciliación</Link>
        <p className="text-xs text-muted-foreground">Las propuestas seguras tienen confianza alta y ninguna alternativa parecida. Todo se puede deshacer.</p>
      </div>

      <details className="border border-window-dark-shadow bg-window-panel p-2 text-sm">
        <summary className="cursor-pointer font-bold">¿Qué es «Pendiente de identificar»?</summary>
        <p className="mt-1 text-muted-foreground">{PENDING_ACCOUNT_EXPLANATION}</p>
      </details>

      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

      {movements.length === 0 ? (
        <EmptyState
          title="Todo conciliado"
          description="No quedan movimientos pendientes de identificar. Importa el siguiente extracto cuando lo tengas."
          action={<Link className={buttonVariants({ size: "sm" })} href="/treasury/import">Importar extracto</Link>}
        />
      ) : (
        <ol className="space-y-2">
          {movements.map((movement) => {
            const isDeposit = movement.amount >= 0;
            return (
              <li
                className={cn(
                  "border border-window-dark-shadow bg-card p-2 shadow-[inset_1px_1px_0_var(--window-highlight),inset_-1px_-1px_0_var(--window-shadow)]",
                  focusId === movement.id && "ring-2 ring-focus",
                )}
                data-testid="workbench-movement"
                id={`movement-${movement.id}`}
                key={movement.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{formatDate(movement.postedAt)} · {movement.bankName}</p>
                    <p className="font-medium break-words">{movement.description}</p>
                    {movement.reference ? <p className="text-xs text-muted-foreground">Ref. {movement.reference}</p> : null}
                  </div>
                  <p className={cn("font-mono text-base font-bold tabular-nums", isDeposit ? "text-success" : "text-foreground")}>
                    {formatMoney(movement.amount, currencyCode)}
                  </p>
                </div>

                {movement.suggestions.length ? (
                  <ul aria-label="Propuestas" className="mt-2 space-y-1">
                    {movement.suggestions.map((suggestion, index) => (
                      <li className="flex flex-wrap items-center gap-2 border border-dashed border-window-shadow p-1.5" data-testid="workbench-suggestion" key={suggestion.key}>
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-1 text-sm font-medium">
                            {suggestion.title}
                            <StatusBadge tone={confidenceTone[suggestion.confidence]}>{confidenceLabel[suggestion.confidence]}</StatusBadge>
                            {suggestion.safe ? <StatusBadge tone="success">Segura</StatusBadge> : null}
                          </p>
                          <p className="text-xs text-muted-foreground">{suggestion.detail}</p>
                        </div>
                        {canWrite ? (
                          <Button disabled={busy !== null} onClick={() => void accept(movement, suggestion)} size="sm" type="button" variant={index === 0 ? "default" : "outline"}>
                            {busy === movement.id ? "Aplicando…" : "Aceptar"}
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Sin propuestas. {isDeposit ? "Busca la factura que te pagan" : "Busca la factura que pagas"} o asígnalo a una cuenta (comisiones, cuotas, impuestos…).
                  </p>
                )}

                {canWrite ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Button disabled={busy !== null} onClick={() => setSplitFor(movement)} size="sm" type="button" variant="outline">
                      {isDeposit ? "Elegir facturas cobradas…" : "Elegir facturas pagadas…"}
                    </Button>
                    <Button disabled={busy !== null} onClick={() => setAssignFor(movement)} size="sm" type="button" variant="outline">Asignar a cuenta…</Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {truncated ? <p className="text-xs text-muted-foreground">Se muestran los 100 movimientos pendientes más antiguos. Concílialos para ver los siguientes.</p> : null}

      {splitFor ? (
        <SplitAllocationDialog
          accounts={accounts}
          currencyCode={currencyCode}
          invoices={splitFor.amount >= 0 ? customerInvoices : supplierInvoices}
          movement={splitFor}
          onClose={() => setSplitFor(null)}
          onSubmit={async (allocations) => {
            const result = await applyReconciliation({ transactionId: splitFor.id, allocations });
            notifyApplied(splitFor.id, "Movimiento conciliado.", describeResult(result.createdPayments));
            setSplitFor(null);
            router.refresh();
          }}
          open
        />
      ) : null}
      {assignFor ? (
        <AssignAccountDialog
          accounts={accounts}
          currencyCode={currencyCode}
          movement={assignFor}
          onClose={() => setAssignFor(null)}
          onSubmit={async ({ accountId, remember }) => {
            await applyReconciliation({
              transactionId: assignFor.id,
              allocations: [{ type: "ACCOUNT", targetId: accountId, amount: Math.abs(assignFor.amount) }],
              remember,
            });
            notifyApplied(assignFor.id, "Asignado a cuenta.", remember ? "Regla guardada: la próxima vez te lo propondremos." : "Ya no está pendiente de identificar.");
            setAssignFor(null);
            router.refresh();
          }}
          open
        />
      ) : null}
    </div>
  );
}
