import Link from "next/link";

import { RemittanceForm } from "@/components/treasury/remittance-form";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { listRemittableSupplierInvoices } from "@/server/sepa/service";
import { listBankAccounts } from "@/server/treasury/service";

export default async function NewRemittancePage() {
  const ctx = await requireContext("treasury.write");
  const [accounts, invoices] = await Promise.all([listBankAccounts(ctx.company.id), listRemittableSupplierInvoices(ctx.company.id)]);
  const active = accounts.filter((account) => account.isActive);
  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería · Remesas"
        title="Nueva remesa de pagos"
        description="Marca las facturas que quieres pagar, revisa el IBAN de cada proveedor y genera el fichero SEPA (pain.001) para tu banco."
        backHref="/treasury/remittances"
        backLabel="Volver a remesas"
      />
      <PageSection title="Facturas pendientes de pago" description="Ordenadas por vencimiento.">
        {active.length === 0 ? (
          <EmptyState
            title="Sin cuentas bancarias activas"
            description="Necesitas la cuenta desde la que pagarás (con su IBAN)."
            action={<Link className={buttonVariants({ size: "sm" })} href="/treasury/bank-accounts/new">Crear cuenta bancaria</Link>}
          />
        ) : (
          <RemittanceForm
            accounts={active.map((account) => ({ id: account.id, bankName: account.bankName, iban: account.iban, bic: account.bic }))}
            currencyCode={ctx.company.baseCurrencyCode}
            invoices={invoices}
          />
        )}
      </PageSection>
    </PageShell>
  );
}
