import Link from "next/link";

import { JournalEntriesList } from "@/components/accounting/journal-entries-list";
import { RenumberEntriesButton } from "@/components/accounting/renumber-entries-button";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { dateInputValue } from "@/lib/date-input";
import { parseListParams, type RawSearchParams } from "@/lib/list-params";
import { can } from "@/lib/rbac";
import { listLegalizedYears } from "@/server/accounting/books/legalization";
import { journalEntryListConfig, listJournalEntriesPage } from "@/server/accounting/journal-entry-list";
import { toServerListState } from "@/server/lists/paginate";

export default async function JournalEntriesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireContext("accounting.read");
  const params = parseListParams(await searchParams, journalEntryListConfig);
  const [result, legalizedYears] = await Promise.all([listJournalEntriesPage(ctx.company.id, params), listLegalizedYears(ctx.company.id)]);
  const canManage = can(ctx.membership.role, "accounting.write");
  return (
    <PageShell>
      <PageHeader
        eyebrow="Contabilidad"
        title="Asientos"
        description="Libro diario con importes cuadrados y acceso a cada asiento."
        backHref="/accounting"
        backLabel="Volver al resumen"
        actions={
          canManage ? (
            <Link className={buttonVariants()} href="/accounting/entries/new">
              Nuevo asiento
            </Link>
          ) : null
        }
      />
      <PageSection
        title="Libro diario"
        description="Filtra, ordena y exporta el histórico contable."
        actions={canManage ? <RenumberEntriesButton fiscalYearId={ctx.fiscalYear.id} yearCode={ctx.fiscalYear.code} /> : undefined}
      >
        <JournalEntriesList
          canManage={canManage}
          currencyCode={ctx.company.baseCurrencyCode}
          legalizedYears={legalizedYears}
          todayKey={dateInputValue(new Date(), ctx.company.timezone)}
          rows={result.rows}
          server={toServerListState(params, result, result.unfilteredTotal)}
          totals={result.totals}
        />
      </PageSection>
    </PageShell>
  );
}
