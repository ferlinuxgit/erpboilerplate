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
          {rows.map((row) => (
            <p key={row.entryId + row.postedAt.toISOString()}>
              {row.postedAt.toISOString().slice(0, 10)} - {row.reference ?? "-"} - Debe {row.debit.toString()} / Haber {row.credit.toString()}
            </p>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
