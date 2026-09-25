import Link from "next/link";

import { CreateJournalEntryForm } from "@/components/accounting/create-journal-entry-form";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { dateInputValue } from "@/lib/date-input";
import { can } from "@/lib/rbac";
import { listPostingAccounts } from "@/server/accounting/service";

export default async function NewJournalEntryPage() {
  const ctx = await requireContext("accounting.read");
  const accounts = await listPostingAccounts(ctx.company.id);
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

      <PageSection title="Datos del asiento" description="Fecha, referencia y líneas. El total del debe tiene que ser igual al del haber (asiento cuadrado).">
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
          <CreateJournalEntryForm
            accounts={accounts.map((account) => ({ id: account.id, code: account.code, name: account.name }))}
            defaultPostedAt={dateInputValue(new Date(), ctx.company.timezone)}
            redirectHref="/accounting"
          />
        )}
      </PageSection>
    </PageShell>
  );
}
