import Link from "next/link";

import { JournalEntriesList } from "@/components/accounting/journal-entries-list";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { listJournalEntries } from "@/server/accounting/service";

export default async function JournalEntriesPage() {
  const ctx = await requireContext("accounting.read");
  const rows = await listJournalEntries(ctx.company.id);
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
          rows={rows}
        />
      </PageSection>
    </PageShell>
  );
}
