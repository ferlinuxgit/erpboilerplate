import type { Metadata } from "next";
import Link from "next/link";

import { AeatBooksDownload } from "@/components/accounting/aeat-books-download";
import { GestorPackageDownload } from "@/components/accounting/gestor-package-download";
import { HelpTerm } from "@/components/help/help-term";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { InlineAlert, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { getCountryFiscalProfile } from "@/lib/country-packs/profile";
import { requireContext } from "@/lib/current-context";
import { fiscalCivilDate } from "@/lib/fiscal-spain";
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
      <InlineAlert tone="info">
        ¿Prefieres que tu asesor lo descargue cuando lo necesite?{" "}
        <Link className="font-bold underline underline-offset-2" href="/settings/asesor">Dale acceso con contraseña</Link> a su portal: facturas emitidas y recibidas, libros, modelos y listados de cada periodo.
      </InlineAlert>
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
          {getCountryFiscalProfile(ctx.company.countryCode).features.taxReports ? <AeatBooks periodKey={first(query.period)} year={year} /> : null}
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

/**
 * Libros registro en el formato electrónico de la AEAT: el que piden los requerimientos y el que
 * importan Pre303, el modelo 130 y Renta Web. Van siempre desde el 1 de enero (la AEAT los pide
 * sin fraccionar por trimestre).
 */
function AeatBooks({ periodKey, year }: { periodKey: string | undefined; year: { id: string; code: string; startsAt: Date; endsAt: Date } }) {
  const quarter = /^q([1-4])$/.exec(resolveStatementPeriod(year, periodKey).key)?.[1];
  const calendarYear = fiscalCivilDate(year.startsAt).year;
  return (
    <PageSection
      title={`3. Libros registro en formato AEAT · ${calendarYear}`}
      description="Un Excel con el diseño oficial de la Agencia Tributaria: facturas expedidas, facturas recibidas y bienes de inversión, cada libro en su pestaña."
    >
      <div className="space-y-3">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Sirve para contestar un requerimiento de la AEAT y para importarlo en la sede (Pre303 del modelo 303, modelo 130 y Renta Web).</li>
          <li>Los autónomos obtienen los libros unificados de IVA e IRPF; las sociedades, los del IVA.</li>
          <li>El nombre del fichero es el que exige la AEAT (ejercicio, NIF, tipo de libro y nombre): no lo cambies.</li>
        </ul>
        <AeatBooksDownload defaultQuarter={quarter ? Number(quarter) : 4} year={calendarYear} />
        <p className="text-xs text-muted-foreground">
          Antes de enviarlo, compruébalo con el servicio de validación de libros de la sede. El programa no rellena: los cobros y pagos del criterio de caja, la regularización anual de los bienes de inversión, los inmuebles arrendados ni el libro de determinadas operaciones intracomunitarias (peritajes, transferencias y ventas en consigna), que no registra. El concepto de gasto del IRPF se propone según la cuenta contable: revísalo.
        </p>
      </div>
    </PageSection>
  );
}
