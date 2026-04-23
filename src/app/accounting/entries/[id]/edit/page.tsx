import { notFound } from "next/navigation";

import { EditJournalEntryForm } from "@/components/accounting/edit-journal-entry-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <main className="container mx-auto px-4 py-10">
      <Card><CardHeader><CardTitle>Editar asiento</CardTitle></CardHeader><CardContent>
        <EditJournalEntryForm
          id={entry.id}
          accounts={accounts.map((account) => ({ id: account.id, code: account.code, name: account.name }))}
          defaultPostedAt={entry.postedAt.toISOString().slice(0, 10)}
          defaultReference={entry.reference ?? ""}
          defaultLines={entry.lines.map((line) => ({ accountId: line.accountId, debit: line.debit.toString(), credit: line.credit.toString() }))}
        />
      </CardContent></Card>
    </main>
  );
}
