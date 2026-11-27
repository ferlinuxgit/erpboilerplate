import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AnnualAccountsModelSelector } from "@/components/accounting/annual-accounts/model-selector";
import { AnnualAccountsNotesEditor } from "@/components/accounting/annual-accounts/notes-editor";
import { FileDownloadButton } from "@/components/accounting/books/file-download-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { InlineAlert, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/current-context";
import { formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { hasSpanishAnnualAccounts } from "@/server/accounting/annual-accounts/availability";
import { loadAnnualAccounts } from "@/server/accounting/annual-accounts/service";
import { SIZE_LIMITS, type SizeFigures } from "@/server/accounting/annual-accounts/size-criteria";
import { listFiscalYears } from "@/server/accounting/fiscal-years";
import { isOfficialStatementModelId, OFFICIAL_STATEMENT_MODEL_IDS, officialStatementModelInfo, type OfficialStatementLine } from "@/server/accounting/official-statements-model";

export const metadata: Metadata = { title: "Cuentas anuales" };

type SearchParams = Promise<{ year?: string | string[]; model?: string | string[] }>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const integer = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0, useGrouping: "always" });

export default async function AnnualAccountsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext("accounting.read");
  if (!hasSpanishAnnualAccounts(ctx.company.countryCode)) notFound();
  const query = await searchParams;
  const years = await listFiscalYears(ctx.company.id);
  const year = years.find((candidate) => candidate.id === first(query.year)) ?? years.find((candidate) => candidate.id === ctx.fiscalYear.id) ?? years[years.length - 1];

  if (!year) {
    return (
      <PageShell>
        <PageHeader breadcrumbs={[{ label: "Contabilidad", href: "/accounting" }, { label: "Cuentas anuales" }]} title="Cuentas anuales" />
        <InlineAlert tone="warning">No hay ejercicios contables. Abre un ejercicio en Contabilidad para preparar las cuentas anuales.</InlineAlert>
      </PageShell>
    );
  }

  const requestedModel = first(query.model);
  const accounts = await loadAnnualAccounts(ctx.company.id, year.id, { model: isOfficialStatementModelId(requestedModel) ? requestedModel : undefined });
  const { statements, equityChanges, recognizedIncome, size } = accounts;
  const currency = ctx.company.baseCurrencyCode;
  const money = (value: number) => formatMoney(value, currency);
  const canEdit = can(ctx.membership.role, "accounting.write");
  const previousLabel = accounts.previousYear?.code;
  const previewing = accounts.model !== accounts.configuredModel;
  const modelOptions = OFFICIAL_STATEMENT_MODEL_IDS.map((id) => officialStatementModelInfo(id));
  const exportHref = (format: string) => `/api/accounting/annual-accounts/export?year=${encodeURIComponent(year.id)}&format=${format}&model=${accounts.model}`;
  const recommendedName = officialStatementModelInfo(size.assessment.recommended).name.toLowerCase();

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: "Contabilidad", href: "/accounting" }, { label: "Estados financieros", href: "/accounting/reports" }, { label: "Cuentas anuales" }]}
        title={`Cuentas anuales ${year.code}`}
        description={`${accounts.modelInfo.name} · ${accounts.modelInfo.source}. Balance, cuenta de pérdidas y ganancias, estado de cambios en el patrimonio neto y memoria, con el ejercicio anterior. Revísalas con tu asesor antes de formularlas y depositarlas.`}
        actions={<Link className={buttonVariants({ variant: "outline" })} href={`/accounting/books?year=${year.id}`}>Libros oficiales</Link>}
      />

      <form action="/accounting/reports/annual-accounts" className="flex flex-wrap items-end gap-2 rounded-surface border border-window-dark-shadow bg-window-panel p-2.5" data-ignore-dirty-guard="true" method="get">
        <div className="space-y-1">
          <Label htmlFor="annual-year">Ejercicio</Label>
          <Select className="w-40" defaultValue={year.id} id="annual-year" name="year">
            {years.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.code}{candidate.isClosed ? " (cerrado)" : ""}</option>)}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="annual-model">Ver en modelo</Label>
          <Select className="w-52" defaultValue={accounts.model} id="annual-model" name="model">
            {modelOptions.map((option) => <option key={option.id} value={option.id}>{option.name}{option.id === accounts.configuredModel ? " (el de la empresa)" : ""}</option>)}
          </Select>
        </div>
        <Button type="submit" variant="secondary">Ver</Button>
      </form>

      {previewing ? (
        <InlineAlert tone="info">
          Estás viendo las cuentas en {accounts.modelInfo.name.toLowerCase()}, pero el modelo de la empresa es {officialStatementModelInfo(accounts.configuredModel).name.toLowerCase()}. Los libros oficiales usan el modelo de la empresa.
        </InlineAlert>
      ) : null}
      {!year.isClosed ? (
        <InlineAlert tone="warning">El ejercicio {year.code} no está cerrado: las cifras son provisionales y pueden cambiar.</InlineAlert>
      ) : null}
      {Math.abs(statements.difference) >= 0.01 ? (
        <InlineAlert title="Descuadre" tone="danger">El activo no coincide con el patrimonio neto más el pasivo (diferencia {money(statements.difference)}). Revisa los asientos del ejercicio.</InlineAlert>
      ) : null}
      {statements.unmapped.length > 0 ? (
        <InlineAlert title="Cuentas que este modelo no prevé" tone="warning">
          {statements.unmapped.slice(0, 8).map((account) => account.code).join(", ")}{statements.unmapped.length > 8 ? "…" : ""}. Se han sumado en el epígrafe más próximo para que el balance cuadre: reclasifícalas o cambia de modelo si no corresponde.
        </InlineAlert>
      ) : null}

      <PageSection title="¿Qué modelo te corresponde?" description="Según el activo, la cifra de negocios y la plantilla media (arts. 257 y 258 de la Ley de Sociedades de Capital y art. 2 del Real Decreto 1515/2007). Hay que cumplir dos de los tres límites durante dos ejercicios seguidos.">
        <div className="space-y-3">
          <TableContainer label="Límites de tamaño">
            <Table className="[&_td:not(:first-child)]:whitespace-nowrap">
              <TableHeader>
                <TableRow>
                  <TableHead>Magnitud</TableHead>
                  <TableHead className="text-right">{year.code}</TableHead>
                  {size.previous && previousLabel ? <TableHead className="text-right">{previousLabel}</TableHead> : null}
                  <TableHead className="text-right">Límite balance abreviado / PYMES</TableHead>
                  <TableHead className="text-right">Límite PyG abreviada</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <SizeRow label="Total activo" limitIncome={`${integer.format(SIZE_LIMITS.abbreviatedIncome.assets)} €`} limitSmall={`${integer.format(SIZE_LIMITS.small.assets)} €`} pick={(figures) => money(figures.assets)} size={size} />
                <SizeRow label="Importe neto de la cifra de negocios" limitIncome={`${integer.format(SIZE_LIMITS.abbreviatedIncome.turnover)} €`} limitSmall={`${integer.format(SIZE_LIMITS.small.turnover)} €`} pick={(figures) => money(figures.turnover)} size={size} />
                <SizeRow label="Plantilla media" limitIncome={String(SIZE_LIMITS.abbreviatedIncome.employees)} limitSmall={String(SIZE_LIMITS.small.employees)} pick={(figures) => (figures.employees === null ? "Sin indicar" : integer.format(figures.employees))} size={size} />
              </TableBody>
            </Table>
          </TableContainer>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {size.assessment.messages.map((message) => <li key={message}>{message}</li>)}
          </ul>
          <p className="text-sm">
            <strong>Con estos datos te corresponde el {recommendedName}{size.assessment.recommended === "abbreviated" ? " (o el de PYMES, si aplicas ese plan)" : ""}.</strong>
          </p>
          <AnnualAccountsModelSelector canEdit={canEdit} current={accounts.configuredModel} options={modelOptions.map((option) => ({ id: option.id, name: option.name }))} />
        </div>
      </PageSection>

      <PageSection
        title="Balance"
        description={`Al cierre del ejercicio${previousLabel ? `, comparado con ${previousLabel}` : ""}.`}
        actions={(
          <div className="flex flex-wrap gap-2">
            <FileDownloadButton fallbackFileName="cuentas-anuales.pdf" failure="No se pudieron generar las cuentas anuales." href={exportHref("pdf")} label="Descargar PDF" />
            <FileDownloadButton fallbackFileName="cuentas-anuales.xlsx" failure="No se pudieron generar las cuentas anuales." href={exportHref("xlsx")} label="Descargar Excel" />
          </div>
        )}
      >
        <div className="grid gap-3 xl:grid-cols-2">
          <StatementTable caption="Activo" currentLabel={year.code} lines={statements.assets} money={money} previousLabel={previousLabel} />
          <StatementTable caption="Patrimonio neto y pasivo" currentLabel={year.code} lines={statements.equityAndLiabilities} money={money} previousLabel={previousLabel} />
        </div>
      </PageSection>

      <PageSection title="Cuenta de pérdidas y ganancias" description="Ingresos en positivo y gastos en negativo, como la columna «(Debe) Haber» del modelo.">
        <StatementTable caption="Cuenta de pérdidas y ganancias" currentLabel={year.code} lines={statements.incomeStatement} money={money} previousLabel={previousLabel} />
      </PageSection>

      {recognizedIncome ? (
        <PageSection title="Estado de ingresos y gastos reconocidos" description="Resultado del ejercicio más los ingresos y gastos imputados directamente al patrimonio neto (grupos 8 y 9).">
          {recognizedIncome.unassigned.length > 0 ? (
            <InlineAlert tone="warning">Las cuentas {recognizedIncome.unassigned.slice(0, 6).join(", ")} tienen movimiento y el modelo no les asigna partida: revísalas.</InlineAlert>
          ) : null}
          <StatementTable caption="Ingresos y gastos reconocidos" currentLabel={year.code} lines={recognizedIncome.lines} money={money} previousLabel={previousLabel} />
        </PageSection>
      ) : null}

      <PageSection
        title="Estado de cambios en el patrimonio neto"
        description="Saldo inicial, variaciones del ejercicio y saldo final de cada partida. Las variaciones se clasifican automáticamente a partir de los asientos: revísalas. Con balance abreviado o de PYMES este estado es voluntario (art. 257.3 de la Ley de Sociedades de Capital)."
      >
        <TableContainer label="Estado de cambios en el patrimonio neto">
          <Table className="[&_td:not(:first-child)]:whitespace-nowrap">
            <TableHeader>
              <TableRow>
                <TableHead sticky>Concepto</TableHead>
                {equityChanges.columns.map((column) => <TableHead className="min-w-28 text-right align-bottom whitespace-normal" key={column.id}>{column.label}</TableHead>)}
                <TableHead className="text-right align-bottom">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {equityChanges.rows.map((row) => {
                const strong = row.kind !== "movement";
                return (
                  <TableRow className={strong ? "bg-window-panel font-bold" : undefined} key={row.id}>
                    <TableCell className={strong ? "bg-window-panel" : "pl-5"} sticky><span className="block min-w-48 max-sm:w-44">{row.label}</span></TableCell>
                    {equityChanges.columns.map((column) => (
                      <TableCell className="text-right" key={column.id}>{row.kind === "group" ? "" : (row.values[column.id] ?? 0) === 0 && !strong ? "—" : money(row.values[column.id] ?? 0)}</TableCell>
                    ))}
                    <TableCell className="text-right">{row.kind === "group" ? "" : money(row.total)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </PageSection>

      <PageSection
        title="Memoria"
        description="Apartados del modelo de memoria abreviada y de PYMES. Los cuadros se calculan de la contabilidad; el texto lo redactas tú y se guarda para este ejercicio."
      >
        <AnnualAccountsNotesEditor
          averageEmployees={accounts.notesData.averageEmployees}
          canEdit={canEdit}
          fiscalYearId={year.id}
          key={year.id}
          notes={accounts.notes}
          taxData={accounts.notesData.taxData}
        />
      </PageSection>
    </PageShell>
  );
}

function SizeRow({ label, limitIncome, limitSmall, pick, size }: { label: string; limitSmall: string; limitIncome: string; pick: (figures: SizeFigures) => string; size: { current: SizeFigures; previous: SizeFigures | null } }) {
  return (
    <TableRow>
      <TableCell>{label}</TableCell>
      <TableCell className="text-right">{pick(size.current)}</TableCell>
      {size.previous ? <TableCell className="text-right">{pick(size.previous)}</TableCell> : null}
      <TableCell className="text-right">{limitSmall}</TableCell>
      <TableCell className="text-right">{limitIncome}</TableCell>
    </TableRow>
  );
}

type Line = Pick<OfficialStatementLine, "id" | "label" | "depth" | "amount" | "previous"> & { kind: string };

/** Estado en el modelo oficial: epígrafes con sangría, totales en negrita y columna del ejercicio anterior. */
function StatementTable({ caption, currentLabel, lines, money, previousLabel }: { caption: string; currentLabel: string; lines: Line[]; money: (value: number) => string; previousLabel?: string }) {
  const indent = ["", "pl-5", "pl-8", "pl-11"];
  return (
    <TableContainer label={caption}>
      <Table className="[&_td:not(:first-child)]:whitespace-nowrap">
        <TableHeader>
          <TableRow>
            <TableHead>{caption}</TableHead>
            <TableHead className="text-right">{currentLabel}</TableHead>
            {previousLabel ? <TableHead className="text-right">{previousLabel}</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => {
            const strong = line.kind === "total" || line.depth === 0;
            return (
              <TableRow className={strong ? "bg-window-panel font-bold" : undefined} key={line.id}>
                <TableCell className={indent[Math.min(line.depth, indent.length - 1)]}>{line.label}</TableCell>
                <TableCell className="text-right">{line.amount === 0 && !strong ? "—" : money(line.amount)}</TableCell>
                {previousLabel ? <TableCell className="text-right">{!line.previous && !strong ? "—" : money(line.previous ?? 0)}</TableCell> : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
