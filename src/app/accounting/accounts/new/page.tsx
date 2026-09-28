import { CreateAccountForm } from "@/components/accounting/create-account-form";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { listGroupAccounts } from "@/server/accounting/chart-tree";
import { getSubaccountLength } from "@/server/accounting/subaccounts";

type SearchParams = Promise<{ parent?: string | string[] }>;

export default async function NewAccountPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext("accounting.read");
  const canWriteAccounting = can(ctx.membership.role, "accounting.write");
  const query = await searchParams;
  const parentParam = Array.isArray(query.parent) ? query.parent[0] : query.parent;
  const defaultParentCode = parentParam && /^\d{1,20}$/.test(parentParam) ? parentParam : null;
  const [parentOptions, subaccountLength] = canWriteAccounting
    ? await Promise.all([listGroupAccounts(ctx.company.id), getSubaccountLength(ctx.company.id)])
    : [[], 8];
  const backHref = defaultParentCode ? `/accounting/accounts?sel=${defaultParentCode}` : "/accounting/accounts";

  return (
    <PageShell>
      <PageHeader
        eyebrow="Contabilidad"
        title="Nueva cuenta"
        description={`Añade una cuenta al plan contable de ${ctx.company.name}.`}
        backHref={backHref}
        backLabel="Volver al plan contable"
      />

      <PageSection title="Datos de la cuenta" description="Elige la cuenta padre para proponer la siguiente subcuenta libre, o escribe el código.">
        {canWriteAccounting ? (
          <CreateAccountForm defaultParentCode={defaultParentCode} parentOptions={parentOptions} subaccountLength={subaccountLength} />
        ) : (
          <EmptyState title="Solo lectura" description="Tu rol actual no permite crear cuentas contables." />
        )}
      </PageSection>
    </PageShell>
  );
}
