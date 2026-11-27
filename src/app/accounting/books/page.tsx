import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DiaryExport } from "@/components/accounting/books/diary-export";
import { FileDownloadButton } from "@/components/accounting/books/file-download-button";
import { SubmissionForm, UndoSubmissionButton } from "@/components/accounting/books/submission-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { InlineAlert, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { requireContext } from "@/lib/current-context";
import { formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { hasSpanishAnnualAccounts } from "@/server/accounting/annual-accounts/availability";
import { getBooksOverview } from "@/server/accounting/books/service";
import { listFiscalYears } from "@/server/accounting/fiscal-years";

export const metadata: Metadata = { title: "Libros oficiales" };

type SearchParams = Promise<{ year?: string | string[] }>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const formatDay = (key: string) => key.slice(0, 10).split("-").reverse().join("/");

const BOOKS = [
  { kind: "journal", name: "Libro Diario", detail: "Todos los asientos del ejercicio por orden de fecha, numerados correlativamente, con apertura, regularización y cierre." },
  { kind: "inventory", name: "Libro de Inventarios y Cuentas Anuales", detail: "Balance inicial, balances de comprobación trimestrales de sumas y saldos, inventario de cierre y las cuentas anuales." },
  { kind: "ledger", name: "Libro Mayor", detail: "Movimientos y saldo de cada cuenta. Es un libro auxiliar: su legalización es voluntaria." },
] as const;

export default async function OfficialBooksPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext("accounting.read");
  if (!hasSpanishAnnualAccounts(ctx.company.countryCode)) notFound();
  const query = await searchParams;
  const years = await listFiscalYears(ctx.company.id);
  const year = years.find((candidate) => candidate.id === first(query.year)) ?? years.find((candidate) => candidate.id === ctx.fiscalYear.id) ?? years[years.length - 1];

  if (!year) {
    return (
      <PageShell>
        <PageHeader breadcrumbs={[{ label: "Contabilidad", href: "/accounting" }, { label: "Libros oficiales" }]} title="Libros oficiales" />
        <InlineAlert tone="warning">No hay ejercicios contables todavía.</InlineAlert>
      </PageShell>
    );
  }

  const overview = await getBooksOverview(ctx.company.id, year.id);
  const canEdit = can(ctx.membership.role, "accounting.write");
  const money = (value: number) => formatMoney(value, ctx.company.baseCurrencyCode);
  const today = new Date().toISOString().slice(0, 10);
  // Plazo de legalización: cuatro meses desde el cierre del ejercicio (art. 27 del Código de Comercio).
  const deadline = new Date(Date.UTC(year.endsAt.getUTCFullYear(), year.endsAt.getUTCMonth() + 4, year.endsAt.getUTCDate())).toISOString().slice(0, 10);
  const bookHref = (kind: string, format: string) => `/api/accounting/books?year=${encodeURIComponent(year.id)}&book=${kind}&format=${format}`;

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: "Contabilidad", href: "/accounting" }, { label: "Libros oficiales" }]}
        title={`Libros oficiales ${year.code}`}
        description="Libro Diario, Libro de Inventarios y Cuentas Anuales y Libro Mayor del ejercicio, listos para legalizarlos en el Registro Mercantil, y exportación del diario a programas de despacho."
        actions={<Link className={buttonVariants({ variant: "outline" })} href={`/accounting/reports/annual-accounts?year=${year.id}`}>Cuentas anuales</Link>}
      />

      <form action="/accounting/books" className="flex flex-wrap items-end gap-2 rounded-surface border border-window-dark-shadow bg-window-panel p-2.5" data-ignore-dirty-guard="true" method="get">
        <div className="space-y-1">
          <Label htmlFor="books-year">Ejercicio</Label>
          <Select className="w-40" defaultValue={year.id} id="books-year" name="year">
            {years.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.code}{candidate.isClosed ? " (cerrado)" : ""}</option>)}
          </Select>
        </div>
        <Button type="submit" variant="secondary">Cambiar ejercicio</Button>
      </form>

      {overview.legalizedAndChanged ? (
        <InlineAlert title="El ejercicio se ha modificado después de legalizar sus libros" tone="danger">
          Los asientos de {year.code} ya no coinciden con los libros presentados en el Registro Mercantil. Un libro legalizado no se puede cambiar: deshaz el cambio (o hazlo en el ejercicio en curso) o rectifica la legalización ante el Registro con una certificación del órgano de administración y un juego de libros nuevo.
        </InlineAlert>
      ) : overview.legalized ? (
        <InlineAlert tone="success">Los libros de {year.code} están legalizados y el ejercicio no ha cambiado desde entonces. Evita modificar sus asientos.</InlineAlert>
      ) : null}
      {!overview.balanced ? (
        <InlineAlert title="El Diario no cuadra" tone="danger">El debe y el haber del ejercicio no suman lo mismo. Revisa los asientos antes de generar los libros.</InlineAlert>
      ) : null}
      {!year.isClosed ? (
        <InlineAlert tone="warning">El ejercicio {year.code} no está cerrado: los libros saldrán sin los asientos de regularización y cierre. Puedes descargarlos para revisarlos, pero legalízalos después de cerrar.</InlineAlert>
      ) : null}
      {overview.outOfOrder > 0 ? (
        <InlineAlert tone="info">
          {overview.outOfOrder === 1 ? "Hay 1 asiento cuyo número interno no sigue" : `Hay ${overview.outOfOrder} asientos cuyo número interno no sigue`} el orden de las fechas (se registraron con fecha anterior a otros ya numerados). En el Libro Diario van por orden de fecha con un número de orden correlativo propio, que es el que exige el Código de Comercio.
        </InlineAlert>
      ) : null}

      <section aria-label="Resumen del Diario" className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Asientos del ejercicio" value={new Intl.NumberFormat("es-ES").format(overview.totals.entries)} helper={`${new Intl.NumberFormat("es-ES").format(overview.totals.lines)} apuntes`} />
        <MetricCard label="Sumas del Diario" value={money(overview.totals.debit)} helper={overview.balanced ? "Debe y haber cuadran" : `Haber: ${money(overview.totals.credit)}`} tone={overview.balanced ? "success" : "warning"} />
        <MetricCard label="Plazo para legalizar" value={formatDay(deadline)} helper="Cuatro meses desde el cierre del ejercicio" tone={!overview.legalized && today > deadline ? "warning" : undefined} />
      </section>

      <PageSection title="1. Revisa los libros" description="Descarga cada libro para comprobarlo. Estas descargas son de trabajo: no llevan huella ni quedan anotadas.">
        <ul className="divide-y divide-window-shadow">
          {BOOKS.map((book) => (
            <li className="flex flex-col gap-2 py-2.5 md:flex-row md:items-center md:justify-between" key={book.kind}>
              <div>
                <p className="font-bold">{book.name}</p>
                <p className="text-sm text-muted-foreground">{book.detail}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <FileDownloadButton fallbackFileName={`${book.kind}.xlsx`} failure="No se pudo generar el libro." href={bookHref(book.kind, "xlsx")} label="Excel" />
                <FileDownloadButton fallbackFileName={`${book.kind}.pdf`} failure="No se pudo generar el libro." href={bookHref(book.kind, "pdf")} label="PDF" />
              </div>
            </li>
          ))}
        </ul>
      </PageSection>

      <PageSection
        title="2. Genera el juego para legalizar"
        description="Un ZIP con los tres libros, la relación de huellas SHA-256 de cada fichero y las instrucciones para cargarlos en Legalia 2, el programa del Colegio de Registradores. Queda anotado aquí con sus huellas."
      >
        <div className="space-y-3">
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <FileDownloadButton body={{ fiscalYearId: year.id, format: "xlsx" }} fallbackFileName="libros-oficiales.zip" failure="No se pudieron generar los libros." href="/api/accounting/books/package" label="Generar libros en Excel (ZIP)" pendingLabel="Generando los libros…" refresh variant="default" />
              <FileDownloadButton body={{ fiscalYearId: year.id, format: "pdf" }} fallbackFileName="libros-oficiales.zip" failure="No se pudieron generar los libros." href="/api/accounting/books/package" label="Generar libros en PDF (ZIP)" pendingLabel="Generando los libros…" refresh />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Necesitas permiso de contabilidad para generar el juego de libros.</p>
          )}
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>No abras ni guardes los ficheros antes de cargarlos en Legalia 2: cualquier cambio altera la huella.</li>
            <li>Legalia 2 admite Excel y PDF. Si el ejercicio tiene muchos asientos, usa Excel.</li>
            <li>Este programa no crea el fichero de envío de Legalia 2: lo genera el propio Legalia 2 al cargar los libros. El ZIP trae los pasos.</li>
            <li>Guarda el ZIP: debes conservar una copia idéntica de lo presentado.</li>
          </ul>
        </div>
      </PageSection>

      <PageSection title="3. Anota la presentación" description="Cuando el Registro Mercantil admita los libros, anota la fecha y el número de entrada. Desde ese momento se avisa si alguien modifica el ejercicio.">
        {overview.submissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no has generado ningún juego de libros de este ejercicio.</p>
        ) : (
          <ul className="space-y-3">
            {overview.submissions.map((submission) => (
              <li className="space-y-2 rounded-control border border-window-dark-shadow bg-window-panel p-3" key={submission.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">
                    {submission.status === "submitted"
                      ? `Presentado el ${formatDay(submission.submittedAt ?? "")}${submission.registryName ? ` · Registro Mercantil de ${submission.registryName}` : ""}${submission.submissionReference ? ` · ${submission.submissionReference}` : ""}`
                      : "Generado, sin presentar"}
                  </p>
                  <p className="text-xs text-muted-foreground">Generado el {formatDay(submission.generatedAt)} · {new Intl.NumberFormat("es-ES").format(submission.entryCount)} asientos</p>
                </div>
                {submission.changedSince ? (
                  <p className="text-sm text-warning-text">El ejercicio ha cambiado desde que se generaron estos ficheros{submission.status === "submitted" ? "." : ": vuelve a generar los libros antes de presentarlos."}</p>
                ) : null}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[36rem] border-collapse text-xs">
                    <caption className="sr-only">Ficheros y huellas</caption>
                    <thead>
                      <tr className="border-b border-window-dark-shadow text-left">
                        <th className="py-1 pr-2" scope="col">Libro</th>
                        <th className="py-1 pr-2" scope="col">Fichero</th>
                        <th className="py-1" scope="col">Huella SHA-256</th>
                      </tr>
                    </thead>
                    <tbody>
                      {submission.files.map((file) => (
                        <tr className="border-b border-window-shadow align-top" key={file.name}>
                          <td className="py-1 pr-2">{file.book}</td>
                          <td className="py-1 pr-2 font-mono">{file.name}</td>
                          <td className="break-all py-1 font-mono">{file.sha256Hex}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {canEdit && submission.status === "generated" && !submission.changedSince ? <SubmissionForm submissionId={submission.id} today={today} /> : null}
                {canEdit && submission.status === "submitted" ? <UndoSubmissionButton submissionId={submission.id} /> : null}
              </li>
            ))}
          </ul>
        )}
      </PageSection>

      <PageSection title="Exportar el diario a un programa de despacho" description="Para que tu asesor importe los asientos del ejercicio en su programa. Haz primero una importación de prueba: el relleno de los campos de texto y la codificación siguen el criterio más conservador (ASCII sin tildes), porque la documentación de los fabricantes no los detalla.">
        <DiaryExport fiscalYearId={year.id} />
      </PageSection>
    </PageShell>
  );
}
