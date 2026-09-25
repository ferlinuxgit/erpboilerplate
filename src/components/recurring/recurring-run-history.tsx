import Link from "next/link";

import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { formatScheduleDate } from "@/server/recurring/schedule";
import type { RecurringRunRow } from "@/server/recurring/service";

const statusLabels = { GENERATED: "Generada", PENDING_REVIEW: "Pendiente de revisar", DISCARDED: "Descartada" } as const;
const statusTones = { GENERATED: "success", PENDING_REVIEW: "warning", DISCARDED: "neutral" } as const;

/** Historial de periodos generados por una plantilla, con enlace al documento. */
export function RecurringRunHistory({ currencyCode = "EUR", runs }: { runs: RecurringRunRow[]; currencyCode?: string }) {
  if (runs.length === 0) return <p className="text-sm text-muted-foreground">Todavía no se ha generado ningún periodo.</p>;
  return (
    <div className="overflow-x-auto rounded-[2px] border">
      <Table data-testid="recurring-run-history">
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Documento</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Observaciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell>{formatScheduleDate(run.periodDate)}</TableCell>
              <TableCell>
                {run.document ? (
                  <Link className="font-mono font-semibold text-primary hover:underline" href={run.document.href}>{run.document.label}</Link>
                ) : run.estimatedTotal !== null ? (
                  <span className="font-mono">{formatMoney(run.estimatedTotal, currencyCode)}</span>
                ) : "—"}
              </TableCell>
              <TableCell><StatusBadge tone={statusTones[run.status]}>{statusLabels[run.status]}</StatusBadge></TableCell>
              <TableCell className="text-xs">{run.message ?? ""}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
