import Link from "next/link";

import { DirectDebitForm } from "@/components/treasury/direct-debit-form";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, InlineAlert, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { checkCreditorId } from "@/lib/bank-import/sepa-creditor";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { earliestCollectionDate } from "@/server/sepa/direct-debit-rules";
import { getSepaCreditorId } from "@/server/sepa/creditor";
import { listCollectableInvoices } from "@/server/sepa/direct-debits";
import { listBankAccounts } from "@/server/treasury/service";

export default async function NewDirectDebitRemittancePage() {
  const ctx = await requireContext("treasury.write");
  const [accounts, invoices, creditor] = await Promise.all([listBankAccounts(ctx.company.id), listCollectableInvoices(ctx.company.id), getSepaCreditorId(ctx.company.id)]);
  const active = accounts.filter((account) => account.isActive);
  const creditorCheck = checkCreditorId(creditor.creditorId);
  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería · Remesas de cobros"
        title="Nueva remesa de cobros"
        description="Marca las facturas que quieres cobrar por domiciliación, elige el día de cobro y genera el fichero de recibos SEPA (pain.008) para tu banco."
        backHref="/treasury/direct-debits"
        backLabel="Volver a remesas de cobros"
      />
      {!creditorCheck.valid ? (
        <InlineAlert tone="warning" title="Falta tu identificador de acreedor SEPA">
          Te lo da tu banco al contratar el cobro de recibos domiciliados. Sin él el banco rechaza el fichero.{" "}
          {can(ctx.membership.role, "settings.manage") ? <Link className="underline" href="/settings/company">Añádelo en Ajustes › Empresa</Link> : "Pide a un administrador que lo añada en Ajustes › Empresa."}
        </InlineAlert>
      ) : null}
      <PageSection title="Facturas pendientes de cobro" description="Solo se pueden incluir las de clientes con un mandato SEPA activo (se añade en la ficha del cliente).">
        {active.length === 0 ? (
          <EmptyState
            title="Sin cuentas bancarias activas"
            description="Necesitas la cuenta en la que el banco abonará los recibos (con su IBAN)."
            action={<Link className={buttonVariants({ size: "sm" })} href="/treasury/bank-accounts/new">Crear cuenta bancaria</Link>}
          />
        ) : (
          <DirectDebitForm
            accounts={active.map((account) => ({ id: account.id, bankName: account.bankName, iban: account.iban }))}
            currencyCode={ctx.company.baseCurrencyCode}
            earliestDate={earliestCollectionDate(new Date()).toISOString().slice(0, 10)}
            invoices={invoices}
            ready={creditorCheck.valid}
          />
        )}
      </PageSection>
    </PageShell>
  );
}
