"use client";

import { ArrowClockwise, Copy, Lock, LockOpen, PencilSimple, Plus } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { BalanceCell, BlockedIcon, PartnerBadge } from "@/components/accounting/chart/account-code";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { Button, buttonVariants } from "@/components/ui/button";
import { errorMessage, readApiError } from "@/components/ui/form";
import { InlineAlert, MetricCard } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { balanceSideWord, formatCents, ledgerHref, NATURE_LABELS } from "@/lib/chart-of-accounts/format";
import type { AccountSummary } from "@/lib/chart-of-accounts/types";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate, formatMoney } from "@/lib/format";
import { accountTypeLabels, statusLabel } from "@/lib/status-labels";
import { cn } from "@/lib/utils";

type SummaryState = { key: string; summary: AccountSummary | null; error: string | null };

/** Carga la ficha de la cuenta; `loading` se deriva de la clave pedida (sin estados en efectos). */
function useAccountSummary(accountId: string, query: string, refreshKey: number) {
  const key = `${accountId}?${query}#${refreshKey}`;
  const [state, setState] = useState<SummaryState>({ key: "", summary: null, error: null });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/accounts/${encodeURIComponent(accountId)}/summary?${query}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiError(response, "No se pudo cargar la ficha de la cuenta."));
        const summary: AccountSummary = await response.json();
        setState({ key, summary, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ key, summary: null, error: errorMessage(error, "No se pudo cargar la ficha de la cuenta.") });
      });
    return () => controller.abort();
  }, [accountId, key, query, retry]);

  const current = state.key === key ? state : null;
  return { summary: current?.summary ?? null, error: current?.error ?? null, loading: !current, retry: () => setRetry((value) => value + 1) };
}

type AccountDetailPanelProps = {
  accountId: string;
  /** Parámetros del periodo (`fy=&from=&to=`). */
  query: string;
  canManage: boolean;
  currency: string;
  refreshKey: number;
  onSelectCode: (code: string) => void;
  onBlockedChange: (code: string, blocked: boolean) => void;
  headingId?: string;
};

/** Ficha de la cuenta: ruta, naturaleza, sumas, evolución mensual frente al año anterior, últimos apuntes y acciones. */
export function AccountDetailPanel({ accountId, canManage, currency, headingId, onBlockedChange, onSelectCode, query, refreshKey }: AccountDetailPanelProps) {
  const { error, loading, retry, summary } = useAccountSummary(accountId, query, refreshKey);
  const [blocking, setBlocking] = useState(false);

  if (loading) {
    return (
      <div aria-busy="true" className="space-y-2 p-2 motion-safe:animate-pulse" data-testid="account-detail-loading">
        <span className="sr-only">Cargando la ficha de la cuenta…</span>
        <div className="h-5 w-3/4 rounded-control bg-window-shadow/40" />
        <div className="h-3 w-1/2 rounded-control bg-window-shadow/30" />
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 4 }, (_, index) => <div className="h-14 rounded-control bg-window-shadow/25" key={index} />)}
        </div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <InlineAlert className="m-2" tone="danger">
        <p>{error ?? "No se pudo cargar la ficha de la cuenta."}</p>
        <Button className="mt-2" onClick={retry} size="sm" type="button" variant="outline">
          <ArrowClockwise aria-hidden="true" />
          Reintentar
        </Button>
      </InlineAlert>
    );
  }

  const { account, totals } = summary;
  const money = (cents: number) => formatMoney(cents / 100, currency);
  const toggleBlocked = async () => {
    setBlocking(true);
    try {
      const response = await fetch(`/api/accounts/${account.id}/block`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ blocked: !account.isBlocked }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo cambiar el bloqueo."));
      toast.success(account.isBlocked ? `Cuenta ${account.code} desbloqueada.` : `Cuenta ${account.code} bloqueada: no admite apuntes manuales nuevos.`);
      onBlockedChange(account.code, !account.isBlocked);
    } catch (blockError) {
      toast.error(errorMessage(blockError, "No se pudo cambiar el bloqueo."));
    } finally {
      setBlocking(false);
    }
  };
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(account.code);
      toast.success(`Código ${account.code} copiado.`);
    } catch {
      toast.error("No se pudo copiar el código: selecciónalo y cópialo a mano.");
    }
  };
  const newChildHref = `/accounting/accounts/new?parent=${account.isPostable ? account.parentCode ?? "" : account.code}`;
  const canCreateChild = canManage && Boolean(summary.nextSubaccountCode || (!account.isPostable && account.code.length >= 3));

  return (
    <div className="space-y-3 p-2" data-testid="account-detail">
      <div className="space-y-1">
        <h2 className="flex flex-wrap items-center gap-1.5 font-mono text-sm font-bold" id={headingId}>
          <span>{account.code} · {account.name}</span>
          {account.isBlocked ? <BlockedIcon /> : null}
        </h2>
        <nav aria-label="Ruta de la cuenta">
          <ol className="flex flex-wrap items-center gap-1 font-mono text-xs text-muted-foreground">
            {summary.path.map((step, index) => (
              <li className="flex items-center gap-1" key={step.id}>
                {index > 0 ? <span aria-hidden="true">›</span> : null}
                {step.code === account.code ? (
                  <span aria-current="location" className="font-bold text-foreground">{step.code}</span>
                ) : (
                  <button className="text-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus-accent" onClick={() => onSelectCode(step.code)} title={step.name} type="button">
                    {step.code}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge>{NATURE_LABELS[account.nature]}</StatusBadge>
          <StatusBadge>{statusLabel(accountTypeLabels, account.type)}</StatusBadge>
          <StatusBadge tone={account.isPostable ? "success" : "neutral"}>{account.isPostable ? "Subcuenta" : `Grupo · ${summary.childCount} ${summary.childCount === 1 ? "cuenta" : "cuentas"}`}</StatusBadge>
          {account.isBlocked ? <StatusBadge tone="warning">Bloqueada</StatusBadge> : null}
        </div>
        {summary.partner ? (
          <p className="flex flex-wrap items-center gap-1 text-xs">
            <PartnerBadge name={summary.partner.name} taxId={summary.partner.taxId} />
            {summary.partner.href ? (
              <Link className="font-medium text-link underline-offset-2 hover:underline" href={summary.partner.href}>{summary.partner.name}</Link>
            ) : (
              <span className="font-medium">{summary.partner.name}</span>
            )}
            {summary.partner.taxId ? <span className="font-mono text-muted-foreground">NIF {summary.partner.taxId}</span> : null}
          </p>
        ) : null}
      </div>

      <div aria-label="Acciones de la cuenta" className="flex flex-wrap gap-1.5" role="group">
        {account.isPostable ? (
          <Link className={buttonVariants({ size: "sm" })} href={ledgerHref(account.id, summary.range)}>Ver mayor</Link>
        ) : null}
        {canCreateChild ? (
          <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={newChildHref}>
            <Plus aria-hidden="true" />
            Crear subcuenta aquí{summary.nextSubaccountCode ? ` (${summary.nextSubaccountCode})` : ""}
          </Link>
        ) : null}
        {canManage ? (
          <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={`/accounting/accounts/${account.id}/edit`}>
            <PencilSimple aria-hidden="true" />
            Editar
          </Link>
        ) : null}
        {canManage && account.isPostable ? (
          <Button aria-busy={blocking || undefined} disabled={blocking} onClick={toggleBlocked} size="sm" type="button" variant="outline">
            {account.isBlocked ? <LockOpen aria-hidden="true" /> : <Lock aria-hidden="true" />}
            {account.isBlocked ? "Desbloquear" : "Bloquear"}
          </Button>
        ) : null}
        <Button onClick={copyCode} size="sm" type="button" variant="ghost">
          <Copy aria-hidden="true" />
          Copiar código
        </Button>
      </div>

      <section aria-label="Sumas del periodo" className="grid grid-cols-2 gap-2">
        <MetricCard label="Saldo inicial" value={money(totals.openingCents)} helper={`Antes del ${formatDate(`${summary.range.from}T00:00:00Z`)}`} />
        <MetricCard label="Debe" value={money(totals.debitCents)} helper={`${totals.entries} ${totals.entries === 1 ? "apunte" : "apuntes"}`} />
        <MetricCard label="Haber" value={money(totals.creditCents)} />
        <MetricCard
          label="Saldo"
          tone={totals.balanceCents !== 0 && ((account.nature === "DEBIT" && totals.balanceCents < 0) || (account.nature === "CREDIT" && totals.balanceCents > 0)) ? "warning" : "neutral"}
          value={money(Math.abs(totals.balanceCents))}
          helper={totals.balanceCents === 0 ? "Saldada" : `Saldo ${balanceSideWord(totals.balanceCents)} al ${formatDate(`${summary.range.to}T00:00:00Z`)}`}
        />
      </section>

      <section aria-labelledby={`${account.id}-evolution`} className="space-y-1">
        <h3 className="font-mono text-xs font-bold uppercase text-muted-foreground" id={`${account.id}-evolution`}>Evolución del saldo</h3>
        <TimeSeriesChart
          categories={summary.months.map((month) => ({ label: month.label, longLabel: month.longLabel }))}
          currencyCode={currency}
          height={170}
          kind="line"
          series={[
            { key: "current", label: summary.current.label, color: "var(--chart-income)", values: summary.current.balanceCents.map((cents) => cents / 100) },
            ...(summary.previous ? [{ key: "previous", label: summary.previous.label, color: "var(--chart-expense)", values: summary.previous.balanceCents.map((cents) => cents / 100) }] : []),
          ]}
          testId="account-detail-chart"
          title={`Saldo acumulado de ${account.code} por mes`}
          valueLabel="Saldo (debe − haber)"
        />
      </section>

      <section aria-labelledby={`${account.id}-lines`} className="space-y-1">
        <h3 className="font-mono text-xs font-bold uppercase text-muted-foreground" id={`${account.id}-lines`}>Últimos apuntes</h3>
        {summary.lastLines.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin apuntes hasta el {formatDate(`${summary.range.to}T00:00:00Z`)}.</p>
        ) : (
          <ul className="divide-y divide-window-shadow/50 border-y border-window-shadow/50">
            {summary.lastLines.map((line) => (
              <li className="grid grid-cols-[1fr_auto] gap-x-2 py-1.5 text-xs" key={line.lineId}>
                <span className="min-w-0">
                  <Link className="font-mono font-bold text-link underline-offset-2 hover:underline" href={`/accounting/entries/${line.entryId}`}>
                    {line.number}
                  </Link>{" "}
                  <span className="text-muted-foreground">{formatDate(line.postedAt)}</span>
                  {line.accountCode !== account.code ? <span className="font-mono text-muted-foreground"> · {line.accountCode}</span> : null}
                  <span className="block truncate">{line.concept ?? line.reference ?? "Sin concepto"}</span>
                  {line.documentNumber || line.partnerName ? (
                    <span className="block truncate text-muted-foreground">{[line.documentNumber, line.partnerName].filter(Boolean).join(" · ")}</span>
                  ) : null}
                </span>
                <span className={cn("text-right font-mono tabular-nums", line.creditCents > 0 && "text-muted-foreground")}>
                  {line.debitCents > 0 ? `D ${formatCents(line.debitCents)}` : `H ${formatCents(line.creditCents)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="flex justify-between text-xs">
          <span className="text-muted-foreground">Saldo final</span>
          <BalanceCell cents={totals.balanceCents} nature={account.nature} />
        </p>
      </section>
    </div>
  );
}
