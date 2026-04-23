import { notFound } from "next/navigation";

import { EditAccountForm } from "@/components/accounting/edit-account-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { getAccount } from "@/server/accounting/service";

export default async function EditAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "accounting.write")) notFound();
  const { id } = await params;
  const account = await getAccount(ctx.company.id, id);
  if (!account) notFound();

  return (
    <main className="container mx-auto px-4 py-10">
      <Card><CardHeader><CardTitle>Editar cuenta</CardTitle></CardHeader><CardContent>
        <EditAccountForm id={account.id} defaultCode={account.code} defaultName={account.name} defaultType={account.type} />
      </CardContent></Card>
    </main>
  );
}
