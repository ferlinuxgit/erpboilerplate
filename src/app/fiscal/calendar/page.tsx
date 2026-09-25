import type { Metadata } from "next";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireContext } from "@/lib/current-context";
import { formatDate, formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { buildFiscalCalendar, type FiscalCalendarEntry } from "@/server/fiscal/calendar";
import { listFiscalReportsWithSummary } from "@/server/fiscal/service";
import { getFiscalSettings } from "@/server/fiscal/settings";

export const metadata: Metadata = { title: "Calendario fiscal" };

const stateBadge: Record<FiscalCalendarEntry["state"], { label: string; tone: "success" | "danger" | "warning" | "info" | "neutral" }> = {
  filed: { label: "Presentado", tone: "success" },
  overdue: { label: "Vencido", tone: "danger" },
  "due-soon": { label: "Próximo", tone: "warning" },
  planned: { label: "Planificado", tone: "info" },
  past: { label: "Sin presentar", tone: "neutral" },
};

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export default async function FiscalCalendarPage({ searchParams }: { searchParams: Promise<{ year?: string | string[] }> }) {
  const ctx = await requireContext("fiscal.read");
  const query = await searchParams;
  const currentYear = new Date().getFullYear();
  const requested = Number(Array.isArray(query.year) ? query.year[0] : query.year);
  const year = Number.isInteger(requested) && requested >= 2000 && requested <= currentYear + 1 ? requested : currentYear;
  const [reports, settings] = await Promise.all([listFiscalReportsWithSummary(ctx.company.id), getFiscalSettings(ctx.company.id)]);
  const canWrite = can(ctx.membership.role, "fiscal.write");
  const entries = buildFiscalCalendar({
    year,
    periodicity: settings.taxPeriodicity,
    taxpayerType: settings.taxpayerType,
    fiscalRegime: settings.fiscalRegime,
    reports,
  });
  const overdue = entries.filter((entry) => entry.state === "overdue");
  const dueSoon = entries.filter((entry) => entry.state === "due-soon");
  const filed = entries.filter((entry) => entry.state === "filed");
  const byMonth = MONTHS.map((label, month) => ({
    label,
    entries: entries.filter((entry) => new Date(entry.dueDate).getUTCMonth() === month),
  })).filter((group) => group.entries.length > 0);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Fiscalidad"
        title="Calendario fiscal"
        description={`Plazos de presentación de ${year} según tu perfil fiscal, aunque todavía no hayas preparado el borrador.`}
        backHref="/fiscal"
        backLabel="Volver a fiscalidad"
        actions={<Link className={buttonVariants({ variant: "outline" })} href="/fiscal/settings">Perfil fiscal</Link>}
      />
      <form action="/fiscal/calendar" className="flex flex-wrap items-end gap-2 rounded-[2px] border border-window-dark-shadow bg-window-panel p-2.5" data-ignore-dirty-guard="true" method="get">
        <div className="space-y-1">
          <Label htmlFor="fiscal-calendar-year">Año</Label>
          <Select className="w-32" defaultValue={String(year)} id="fiscal-calendar-year" name="year">
            {[currentYear - 2, currentYear - 1, currentYear, currentYear + 1].map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="secondary">Ver año</Button>
      </form>
      <section aria-label="Resumen del calendario" className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Vencidos" value={overdue.length} helper="Obligatorios sin presentar" tone={overdue.length ? "danger" : "success"} />
        <MetricCard label="Próximos 7 días" value={dueSoon.length} helper="Prepáralos cuanto antes" tone={dueSoon.length ? "warning" : "neutral"} />
        <MetricCard label="Presentados" value={filed.length} helper={`De ${entries.length} plazos del año`} />
      </section>
      {byMonth.map((group) => (
        <PageSection description={`${group.entries.length} ${group.entries.length === 1 ? "plazo" : "plazos"}`} key={group.label} title={`${group.label} ${year}`}>
          <ul className="divide-y divide-window-shadow">
            {group.entries.map((entry) => {
              const badge = stateBadge[entry.state];
              return (
                <li className="grid gap-2 py-2.5 md:grid-cols-[110px_minmax(0,1fr)_130px_minmax(160px,auto)] md:items-center" key={`${entry.code}-${entry.period}`}>
                  <span className="font-mono text-sm font-bold">{formatDate(entry.dueDate)}</span>
                  <span className="min-w-0 text-sm">
                    <span className="font-semibold">{entry.name} · {entry.periodLabel}</span>
                    <span className="block text-xs text-muted-foreground">
                      {entry.requirement === "if-applicable" ? "Solo si aplica. " : ""}
                      {entry.reason}
                    </span>
                  </span>
                  <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                  <span className="flex flex-wrap items-center gap-2 text-sm md:justify-end">
                    {entry.report?.amountDue !== null && entry.report?.amountDue !== undefined ? (
                      <span className="font-mono text-xs">{entry.report.amountDue >= 0 ? "A ingresar" : "A compensar"} {formatMoney(Math.abs(entry.report.amountDue))}</span>
                    ) : null}
                    {entry.report ? (
                      <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={`/fiscal/${entry.report.id}`}>Abrir</Link>
                    ) : canWrite && entry.state !== "past" ? (
                      <Link className={buttonVariants({ size: "sm", variant: entry.requirement === "required" ? "default" : "outline" })} href={`/fiscal/new?code=${entry.code}&period=${entry.period}`}>
                        Preparar
                      </Link>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </PageSection>
      ))}
    </PageShell>
  );
}
