import Link from "next/link";

import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireUserSession } from "@/lib/current-user";
import { ensureUserTenant } from "@/lib/tenant";
import { getLedgerByAccount } from "@/server/accounting/service";

export default async function LedgerPage({ params }: { params: Promise<{ accountId: string }> }) {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const { accountId } = await params;
  const rows = await getLedgerByAccount(ctx.company.id, accountId);

  return (
    <PageShell>
      <PageHeader eyebrow="Contabilidad" title="Libro mayor" description="Movimientos de la cuenta seleccionada." backHref="/accounting" backLabel="Volver a contabilidad" />
      <PageSection title="Movimientos" description="Debe, haber y referencia del asiento asociado." contentClassName="space-y-2">
          {rows.length === 0 ? <EmptyState title="Sin movimientos" description="No hay movimientos para esta cuenta." /> : null}
          {rows.map((row) => {
            const reference = row.reference ?? "sin referencia";

            return (
              <div key={row.lineId} className="rounded-md border p-3 text-sm">
                <p>
                  {row.postedAt.toISOString().slice(0, 10)} - {row.reference ?? "-"} - Debe {row.debit.toString()} / Haber {row.credit.toString()}
                </p>
                <Link className="text-muted-foreground underline-offset-4 hover:underline" href={`/accounting/entries/${row.entryId}/edit`}>
                  Ver asiento {reference}
                </Link>
              </div>
            );
          })}
      </PageSection>
    </PageShell>
  );
}
