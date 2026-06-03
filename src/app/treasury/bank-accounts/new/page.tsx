import { CreateBankAccountForm } from "@/components/treasury/create-bank-account-form";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";

export default async function NewBankAccountPage() {
  const ctx = await requireContext("treasury.write");
  const canWriteTreasury = can(ctx.membership.role, "treasury.write");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería"
        title="Nueva cuenta bancaria"
        description={`Añade una cuenta operativa para ${ctx.company.name}.`}
        backHref="/treasury"
        backLabel="Volver a tesorería"
      />

      <PageSection title="Datos bancarios" description="Informa banco e IBAN asociado a la empresa activa.">
        {canWriteTreasury ? (
          <CreateBankAccountForm redirectHref="/treasury" />
        ) : (
          <EmptyState title="Solo lectura" description="Tu rol actual no permite crear cuentas bancarias." />
        )}
      </PageSection>
    </PageShell>
  );
}
