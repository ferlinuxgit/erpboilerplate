import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatMoney } from "@/lib/format";
import { describeDaysUntil, formatCount } from "@/lib/pluralize";
import type { FiscalObligation } from "@/server/fiscal/obligations";

const reportStatusLabel = { DRAFT: "Borrador", READY: "Preparado", FILED: "Presentado" } as const;

function dueText(obligation: FiscalObligation) {
  return describeDaysUntil(obligation.daysUntilDue);
}

/** Tarjeta "Qué tengo que presentar este trimestre" en /fiscal. */
export function FiscalObligationsCard({ canWrite, obligations }: { canWrite: boolean; obligations: FiscalObligation[] }) {
  const required = obligations.filter((obligation) => obligation.requirement === "required");
  const notNeeded = obligations.filter((obligation) => obligation.requirement === "not-needed");
  const pending = required.filter((obligation) => obligation.report?.status !== "FILED");

  return (
    <div className="space-y-3">
      <p className="text-sm">
        {pending.length === 0
          ? "Todo presentado para el próximo plazo. ¡Bien!"
          : `Tienes ${formatCount(pending.length, "modelo")} por presentar en el próximo plazo.`}
      </p>
      <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {required.map((obligation) => {
          const filed = obligation.report?.status === "FILED";
          return (
            <li className="flex flex-col gap-2 rounded-[2px] border p-3 text-sm" key={`${obligation.code}-${obligation.period}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{obligation.name} · {obligation.periodLabel}</p>
                  <p className="text-xs text-muted-foreground">{obligation.plainHelp}</p>
                </div>
                <StatusBadge tone={filed ? "success" : obligation.dueStatus === "overdue" ? "danger" : obligation.dueStatus === "due-soon" ? "warning" : "info"}>
                  {filed ? "Presentado" : obligation.report ? reportStatusLabel[obligation.report.status] : "Pendiente"}
                </StatusBadge>
              </div>
              <p className="text-xs">
                <span className="font-medium">Hasta el {formatDate(obligation.dueDate)}</span>
                {filed ? null : <span className="text-muted-foreground"> · {dueText(obligation)}</span>}
              </p>
              <p className="text-xs text-muted-foreground">{obligation.reason}</p>
              <div className="mt-auto flex items-center justify-between gap-2">
                {obligation.report && obligation.report.amountDue !== null ? (
                  <span className="font-mono text-xs">{obligation.report.amountDue >= 0 ? "A ingresar" : "A compensar"}: {formatMoney(Math.abs(obligation.report.amountDue))}</span>
                ) : <span />}
                {obligation.report ? (
                  <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={`/fiscal/${obligation.report.id}`}>Ver borrador</Link>
                ) : canWrite ? (
                  <Link className={buttonVariants({ size: "sm" })} href={`/fiscal/new?code=${obligation.code}&period=${obligation.period}`}>Preparar borrador</Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {notNeeded.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Este periodo no te toca: {notNeeded.map((obligation) => `${obligation.name} (${obligation.reason.charAt(0).toLowerCase()}${obligation.reason.slice(1).replace(/\.$/, "")})`).join("; ")}.
        </p>
      ) : null}
    </div>
  );
}
