import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserSession } from "@/lib/current-user";
import { ensureUserTenant } from "@/lib/tenant";
import { getLedgerByAccount } from "@/server/accounting/service";

export default async function LedgerPage({ params }: { params: Promise<{ accountId: string }> }) {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const { accountId } = await params;
  const rows = await getLedgerByAccount(ctx.company.id, accountId);

  return (
    <main className="container mx-auto px-4 py-10">
      <Card>
        <CardHeader><CardTitle>Libro mayor</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {rows.length === 0 ? <p className="text-sm text-muted-foreground">No hay movimientos para esta cuenta.</p> : null}
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
        </CardContent>
      </Card>
    </main>
  );
}
