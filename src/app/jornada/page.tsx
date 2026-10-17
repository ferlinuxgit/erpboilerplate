import type { Metadata } from "next";
import Link from "next/link";

import { DaysTable, MyClock, TeamPanel } from "@/components/timesheets/timesheet-panels";
import { InlineAlert, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { ForbiddenError } from "@/lib/http";
import { can } from "@/lib/rbac";
import { zonedParts } from "@/modules/hospitality/bookings";
import { formatMinutes } from "@/modules/timesheets/model";
import { isModuleEnabled } from "@/server/modules/service";
import { currentState, monthReport, teamNow } from "@/server/timesheets/service";

export const metadata: Metadata = { title: "Registro de jornada" };

/** Registro de jornada: fichar la propia y, para responsables y gestor, la del equipo. */
export default async function TimesheetPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const ctx = await requireContext();
  const role = ctx.membership.role;
  const canOwn = can(role, "timesheet.own");
  const canRead = can(role, "timesheet.read");
  if (!canOwn && !canRead) throw new ForbiddenError();
  const query = await searchParams;
  const timeZone = ctx.company.timezone;
  const month = query.mes && /^\d{4}-\d{2}$/.test(query.mes) ? query.mes : zonedParts(new Date(), timeZone).date.slice(0, 7);
  const [mine, myReport, team, teamReport, posEnabled] = await Promise.all([
    canOwn ? currentState(ctx.company.id, ctx.user.id) : null,
    canOwn ? monthReport(ctx.company.id, ctx.tenant.id, month, ctx.user.id) : null,
    canRead ? teamNow(ctx.company.id, ctx.tenant.id) : null,
    canRead ? monthReport(ctx.company.id, ctx.tenant.id, month) : null,
    isModuleEnabled(ctx.company.id, "hospitality"),
  ]);
  const myWorker = myReport?.workers[0];
  return (
    <PageShell>
      <PageHeader description="Registro diario de entrada, pausas y salida de cada trabajador (art. 34.9 del Estatuto de los Trabajadores). Se conserva 4 años y no se puede modificar: las correcciones quedan anotadas." title="Registro de jornada" />
      {mine && myWorker ? (
        <PageSection description={`Este mes llevas ${formatMinutes(myWorker.workedMinutes)}.`} title="Mi jornada">
          <div className="space-y-4">
            <MyClock actions={mine.actions} since={mine.since?.toISOString() ?? null} state={mine.state} timeZone={timeZone} />
            <div className="border border-window-shadow">
              <DaysTable canManage={false} days={myWorker.days} />
            </div>
            <a className="text-sm text-link underline" href={`/api/timesheets/export?month=${month}&userId=${ctx.user.id}`}>Descargar mi registro del mes (CSV)</a>
          </div>
        </PageSection>
      ) : null}
      {team && teamReport ? (
        <PageSection description="Quién está trabajando ahora y las horas del mes de cada persona." title="Equipo">
          <TeamPanel canManage={can(role, "timesheet.manage")} month={month} now={team.map((member) => ({ userId: member.userId, name: member.name, state: member.state, since: member.since?.toISOString() ?? null }))} report={teamReport} />
        </PageSection>
      ) : null}
      <InlineAlert tone="neutral">
        {posEnabled ? (
          <>Para fichar en una tablet compartida abre <Link className="underline" href="/fichar">la pantalla de fichar</Link>: cada persona entra con su PIN (se configuran en <Link className="underline" href="/pos/settings#camareros">TPV → Cajas → Camareros</Link>).</>
        ) : (
          <>Cada persona ficha desde su sesión (móvil u ordenador). Con el módulo de Hostelería también podréis fichar en una tablet con PIN.</>
        )}
      </InlineAlert>
    </PageShell>
  );
}
