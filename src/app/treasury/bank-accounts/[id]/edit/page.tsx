import { notFound } from "next/navigation";

import { EditBankAccountForm } from "@/components/treasury/edit-bank-account-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
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
    <PageShell>
      <PageHeader eyebrow="Tesorería" title="Editar cuenta bancaria" description={account.bankName} backHref="/treasury" backLabel="Volver a tesorería" />
      <PageSection title="Datos bancarios" description="Actualiza banco e IBAN asociado a la empresa activa.">
        <EditBankAccountForm id={account.id} defaultBankName={account.bankName} defaultIban={account.iban} />
      </PageSection>
    </PageShell>
  );
}
