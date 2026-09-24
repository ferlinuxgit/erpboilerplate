import Link from "next/link";

import { JournalEntriesList } from "@/components/accounting/journal-entries-list";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { parseListParams, type RawSearchParams } from "@/lib/list-params";
import { can } from "@/lib/rbac";
import { journalEntryListConfig, listJournalEntriesPage } from "@/server/accounting/journal-entry-list";
import { toServerListState } from "@/server/lists/paginate";

export default async function JournalEntriesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireContext("accounting.read");
  const params = parseListParams(await searchParams, journalEntryListConfig);
  const result = await listJournalEntriesPage(ctx.company.id, params);
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
      >
        <JournalEntriesList
          canManage={canManage}
          currencyCode={ctx.company.baseCurrencyCode}
          rows={result.rows}
          server={toServerListState(params, result, result.unfilteredTotal)}
          totals={result.totals}
        />
      </PageSection>
    </PageShell>
  );
}
