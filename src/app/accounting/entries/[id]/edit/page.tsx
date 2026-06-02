import { notFound } from "next/navigation";

import { EditJournalEntryForm } from "@/components/accounting/edit-journal-entry-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { getJournalEntry, listAccounts } from "@/server/accounting/service";

export default async function EditJournalEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "accounting.write")) notFound();
  const { id } = await params;
  const entry = await getJournalEntry(ctx.company.id, id);
  if (!entry) notFound();
  const accounts = await listAccounts(ctx.company.id);

  return (
    <PageShell>
      <PageHeader eyebrow="Contabilidad" title="Editar asiento" description={entry.reference ?? "Sin referencia"} backHref="/accounting" backLabel="Volver a contabilidad" />
      <PageSection title="Datos del asiento" description="Actualiza fecha, referencia y líneas contables.">
        <EditJournalEntryForm
          id={entry.id}
          accounts={accounts.map((account) => ({ id: account.id, code: account.code, name: account.name }))}
          defaultPostedAt={entry.postedAt.toISOString().slice(0, 10)}
          defaultReference={entry.reference ?? ""}
          defaultLines={entry.lines.map((line) => ({ accountId: line.accountId, debit: line.debit.toString(), credit: line.credit.toString() }))}
        />
      </PageSection>
    </PageShell>
  );
}
