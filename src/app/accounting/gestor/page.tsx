import type { Metadata } from "next";

import { GestorPackageDownload } from "@/components/accounting/gestor-package-download";
import { HelpTerm } from "@/components/help/help-term";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { InlineAlert, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { requireContext } from "@/lib/current-context";
import { listFiscalYears } from "@/server/accounting/fiscal-years";
import { resolveStatementPeriod, statementPeriodOptions } from "@/server/accounting/statements-model";

export const metadata: Metadata = { title: "Paquete para el gestor" };

type SearchParams = Promise<{ year?: string | string[]; period?: string | string[] }>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function GestorPackagePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext("accounting.read");
  const query = await searchParams;
  const years = await listFiscalYears(ctx.company.id);
  const year = years.find((candidate) => candidate.id === first(query.year)) ?? years.find((candidate) => candidate.id === ctx.fiscalYear.id) ?? years[years.length - 1];

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: "Contabilidad", href: "/accounting" }, { label: "Paquete para el gestor" }]}
        title="Paquete para el gestor"
        description="Todo lo que suele pedir tu gestor o asesor, en un único ZIP: libros contables, libros registro de IVA y modelos del periodo."
      />
      {!year ? (
        <InlineAlert tone="warning">No hay ejercicios contables todavía.</InlineAlert>
      ) : (
        <>
          <PageSection title="1. Elige el periodo" description="Normalmente, el trimestre que acabas de cerrar o el ejercicio completo.">
            <form action="/accounting/gestor" className="flex flex-wrap items-end gap-2" data-ignore-dirty-guard="true" method="get">
              <div className="space-y-1">
                <Label htmlFor="gestor-year">Ejercicio</Label>
                <Select className="w-40" defaultValue={year.id} id="gestor-year" name="year">
                  {years.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.code}{candidate.isClosed ? " (cerrado)" : ""}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="gestor-period">Periodo</Label>
                <Select className="w-48" defaultValue={resolveStatementPeriod(year, first(query.period)).key} id="gestor-period" name="period">
                  {statementPeriodOptions(year).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
              </div>
              <Button type="submit" variant="secondary">Cambiar periodo</Button>
            </form>
          </PageSection>
          <PeriodDownload periodKey={first(query.period)} year={year} />
        </>
      )}
    </PageShell>
  );
}

function PeriodDownload({ periodKey, year }: { periodKey: string | undefined; year: { id: string; code: string; startsAt: Date; endsAt: Date } }) {
  const period = resolveStatementPeriod(year, periodKey);
  return (
    <PageSection title={`2. Descarga el paquete · ${period.label}`} description="Se genera en el momento con los datos actuales.">
      <div className="space-y-3">
        <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
          <li><strong><HelpTerm term="diario">Libro diario</HelpTerm></strong>: cada asiento con todas sus líneas (Excel).</li>
          <li><strong><HelpTerm term="mayor">Libro mayor</HelpTerm></strong>: movimientos por cuenta con saldo anterior y acumulado.</li>
          <li><strong><HelpTerm term="sumas-y-saldos">Sumas y saldos</HelpTerm></strong>: debe, haber y saldo final de cada cuenta.</li>
          <li><strong>Libros registro de IVA</strong>: facturas expedidas y recibidas, con NIF, base, IVA y retención.</li>
          <li><strong>Modelos</strong>: PDF de los modelos (303, 111, 130…) preparados para el periodo.</li>
          <li><strong>LEEME.txt</strong>: resumen del contenido y del periodo.</li>
        </ul>
        <GestorPackageDownload fiscalYearId={year.id} periodKey={period.key} periodLabel={period.label} />
        <p className="text-xs text-muted-foreground">
          Antes de enviarlo, revisa que no queden facturas en borrador ni movimientos del banco sin conciliar en el periodo: el paquete refleja lo que hay registrado ahora.
        </p>
      </div>
    </PageSection>
  );
}
