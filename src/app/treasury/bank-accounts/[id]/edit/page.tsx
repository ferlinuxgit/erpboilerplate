import { notFound } from "next/navigation";

import { EditBankAccountForm } from "@/components/treasury/edit-bank-account-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { getBankAccount } from "@/server/treasury/service";

export default async function EditBankAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "treasury.write")) notFound();
  const { id } = await params;
  const account = await getBankAccount(ctx.company.id, id);
  if (!account) notFound();

  return (
    <main className="container mx-auto px-4 py-10">
      <Card>
        <CardHeader><CardTitle>Editar cuenta bancaria</CardTitle></CardHeader>
        <CardContent>
          <EditBankAccountForm id={account.id} defaultBankName={account.bankName} defaultIban={account.iban} />
        </CardContent>
      </Card>
    </main>
  );
}
