import { notFound } from "next/navigation";

import { EditAccountForm } from "@/components/accounting/edit-account-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
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
    <PageShell>
      <PageHeader eyebrow="Contabilidad" title="Editar cuenta" description={`${account.code} - ${account.name}`} backHref="/accounting" backLabel="Volver a contabilidad" />
      <PageSection title="Datos de la cuenta" description="Actualiza código, nombre y tipo contable.">
        <EditAccountForm id={account.id} defaultCode={account.code} defaultName={account.name} defaultType={account.type} />
      </PageSection>
    </PageShell>
  );
}
