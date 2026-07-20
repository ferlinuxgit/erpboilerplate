import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import {
  EmptyState,
  MetricCard,
  PageHeader,
  PageSection,
  PageShell,
} from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatMoney } from "@/lib/format";
import { requireContext } from "@/lib/current-context";
import { listFiscalReportsWithSummary } from "@/server/fiscal/service";

export default async function FiscalCalendarPage() {
  const ctx = await requireContext("fiscal.read");
  const reports = await listFiscalReportsWithSummary(ctx.company.id);
  const scheduled = reports
    .filter((report) => report.summary?.dueDate)
    .sort(
      (a, b) =>
        new Date(a.summary?.dueDate ?? 0).getTime() -
        new Date(b.summary?.dueDate ?? 0).getTime(),
    );
  const overdue = scheduled.filter(
    (report) =>
      report.summary?.dueStatus === "overdue" && report.status !== "FILED",
  );
  const dueSoon = scheduled.filter(
    (report) =>
      report.summary?.dueStatus === "due-soon" && report.status !== "FILED",
  );
  return (
    <PageShell>
      <PageHeader
        eyebrow="Fiscalidad"
        title="Calendario fiscal"
        description="Vencimientos, resultados estimados y estado de presentación de cada modelo."
        backHref="/fiscal"
        backLabel="Volver a modelos"
      />
      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard
          label="Vencidos"
          value={overdue.length}
          helper="Modelos no presentados"
          tone={overdue.length ? "warning" : "success"}
        />
        <MetricCard
          label="Próximos"
          value={dueSoon.length}
          helper="Requieren atención"
        />
        <MetricCard
          label="Programados"
          value={scheduled.length}
          helper="Declaraciones con vencimiento"
        />
      </section>
      <PageSection
        title="Próximos vencimientos"
        description="Ordenados por fecha límite de presentación."
      >
        {scheduled.length ? (
          <div className="divide-y border-y">
            {scheduled.map((report) => (
              <Link
                className="grid gap-3 py-4 hover:bg-muted/30 md:grid-cols-[120px_minmax(0,1fr)_140px_160px] md:items-center"
                href={`/fiscal/${report.id}`}
                key={report.id}
              >
                <span className="font-semibold">Modelo {report.code}</span>
                <span className="text-sm text-muted-foreground">
                  Periodo {report.period}
                </span>
                <StatusBadge
                  tone={
                    report.status === "FILED"
                      ? "success"
                      : report.summary?.dueStatus === "overdue"
                        ? "danger"
                        : report.summary?.dueStatus === "due-soon"
                          ? "warning"
                          : "info"
                  }
                >
                  {report.status === "FILED"
                    ? "Presentado"
                    : report.summary?.dueStatus === "overdue"
                      ? "Vencido"
                      : report.summary?.dueStatus === "due-soon"
                        ? "Próximo"
                        : "Planificado"}
                </StatusBadge>
                <span className="text-sm md:text-right">
                  <span className="block font-medium">
                    {formatDate(report.summary!.dueDate!)}
                  </span>
                  <span className="text-muted-foreground">
                    {formatMoney(report.summary?.settlementAmount ?? 0)}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Sin vencimientos"
            description="Crea un modelo fiscal para calcular su fecha límite y resultado estimado."
            action={
              <Link className={buttonVariants()} href="/fiscal/new">
                Nuevo modelo
              </Link>
            }
          />
        )}
      </PageSection>
    </PageShell>
  );
}
