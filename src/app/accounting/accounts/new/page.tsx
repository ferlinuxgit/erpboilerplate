import { CreateAccountForm } from "@/components/accounting/create-account-form";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";

export default async function NewAccountPage() {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const canWriteAccounting = can(ctx.membership.role, "accounting.write");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Contabilidad"
        title="Nueva cuenta"
        description={`Añade una cuenta al plan contable de ${ctx.company.name}.`}
        backHref="/accounting"
        backLabel="Volver a contabilidad"
      />

      <PageSection title="Datos de la cuenta" description="Informa código, nombre y tipo contable.">
        {canWriteAccounting ? (
          <CreateAccountForm redirectHref="/accounting" />
        ) : (
          <EmptyState title="Solo lectura" description="Tu rol actual no permite crear cuentas contables." />
        )}
      </PageSection>
    </PageShell>
  );
}
