import Link from "next/link";

import { BankImportWizard } from "@/components/treasury/bank-import-wizard";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import type { RawSearchParams } from "@/lib/list-params";
import { listBankAccounts } from "@/server/treasury/service";

export default async function BankImportPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireContext("treasury.write");
  const [accounts, params] = await Promise.all([listBankAccounts(ctx.company.id), searchParams]);
  const active = accounts.filter((account) => account.isActive);
  const requested = Array.isArray(params.account) ? params.account[0] : params.account;
  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería"
        title="Importar extracto bancario"
        description="Sube el fichero que descargas de tu banco (CSV, Excel o Norma 43). Revisarás las columnas antes de importar."
        backHref="/treasury/reconciliation"
        backLabel="Volver a la conciliación"
      />
      <PageSection title="Asistente de importación" description="Cada movimiento entra como «pendiente de conciliar» hasta que digas a qué corresponde.">
        {active.length ? (
          <BankImportWizard accounts={active} currencyCode={ctx.company.baseCurrencyCode} initialAccountId={requested} />
        ) : (
          <EmptyState
            title="Sin cuentas bancarias activas"
            description="Crea o reactiva una cuenta bancaria para importar su extracto."
            action={<Link className={buttonVariants({ size: "sm" })} href="/treasury/bank-accounts/new">Crear cuenta bancaria</Link>}
          />
        )}
      </PageSection>
    </PageShell>
  );
}
