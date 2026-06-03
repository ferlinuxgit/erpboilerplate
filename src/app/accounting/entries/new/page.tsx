import Link from "next/link";

import { CreateJournalEntryForm } from "@/components/accounting/create-journal-entry-form";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { listAccounts } from "@/server/accounting/service";

export default async function NewJournalEntryPage() {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const accounts = await listAccounts(ctx.company.id);
  const canWriteAccounting = can(ctx.membership.role, "accounting.write");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Contabilidad"
        title="Nuevo asiento"
        description={`Registra un asiento manual para ${ctx.company.name}.`}
        backHref="/accounting"
        backLabel="Volver a contabilidad"
      />

      <PageSection title="Datos del asiento" description="Informa fecha, referencia y líneas balanceadas de debe y haber.">
        {!canWriteAccounting ? (
          <EmptyState title="Solo lectura" description="Tu rol actual no permite crear asientos contables." />
        ) : accounts.length === 0 ? (
          <EmptyState
            title="Sin cuentas contables"
            description="Crea una cuenta antes de registrar asientos manuales."
            action={
              <Link className={buttonVariants({ variant: "secondary" })} href="/accounting/accounts/new">
                Nueva cuenta
              </Link>
            }
          />
        ) : (
          <CreateJournalEntryForm accounts={accounts.map((account) => ({ id: account.id, code: account.code, name: account.name }))} redirectHref="/accounting" />
        )}
      </PageSection>
    </PageShell>
  );
}
