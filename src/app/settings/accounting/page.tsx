import { and, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";

import { DefaultAccountsForm } from "@/components/accounting/default-accounts-form";
import { FiscalYearLifecyclePanel } from "@/components/accounting/fiscal-year-lifecycle-panel";
import { FiscalYearsList } from "@/components/accounting/fiscal-years-list";
import { CompanyDefaultsPanel } from "@/components/company/company-defaults-panel";
import { SubaccountLengthForm } from "@/components/company/subaccount-length-form";
import { LazyAccountingMasters } from "@/components/settings/lazy-accounting-masters";
import { SettingsPageHeader } from "@/components/settings/settings-page-header";
import { buttonVariants } from "@/components/ui/button";
import { PageSection, PageShell } from "@/components/ui/page";
import { accountChart, companySettings } from "@/db/schema";
import { getCompanyTemplate } from "@/lib/company-templates";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { resolvePostingSettings } from "@/server/accounting/auto-post";
import { getFiscalYearLifecycle, listFiscalYears } from "@/server/accounting/fiscal-years";
import { getAccountingMasterStatus } from "@/server/accounting/masters";
import { companyHasJournalEntries } from "@/server/accounting/subaccounts";
import { getCompanyDefaultsStatus } from "@/server/company/defaults";

export const metadata: Metadata = { title: "Contabilidad" };

export default async function AccountingSettingsPage() {
  const ctx = await requireContext("settings.manage");
  const template = getCompanyTemplate(ctx.company.countryCode);
  const [accountingMasterStatus, defaultsStatus, [settings], hasEntries, years, lifecycle] = await Promise.all([
    getAccountingMasterStatus(ctx.company.id, undefined, template),
    getCompanyDefaultsStatus({ companyId: ctx.company.id, fiscalYearId: ctx.fiscalYear.id, countryCode: ctx.company.countryCode }),
    db.select().from(companySettings).where(eq(companySettings.companyId, ctx.company.id)).limit(1),
    companyHasJournalEntries(ctx.company.id),
    listFiscalYears(ctx.company.id),
    getFiscalYearLifecycle(ctx.company.id, ctx.fiscalYear.id),
  ]);
  // Las cuentas que de verdad usa la contabilidad automática (p. ej. 705 si solo prestas servicios).
  const { codes } = resolvePostingSettings(settings, ctx.company.countryCode);
  const defaultAccounts = { customer: codes.customer, supplier: codes.supplier, sales: codes.sales, purchase: codes.purchase, bank: codes.bank };
  const accountRows = await db
    .select({ code: accountChart.code, name: accountChart.name })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, ctx.company.id), inArray(accountChart.code, Object.values(defaultAccounts))));
  const canWriteAccounting = can(ctx.membership.role, "accounting.write");

  return (
    <PageShell>
      <SettingsPageHeader
        actions={<Link className={buttonVariants({ variant: "outline" })} href="/accounting/accounts">Plan contable</Link>}
        sectionId="accounting"
      />
      <PageSection className="scroll-mt-24" id="ejercicios" title="Ejercicios fiscales" description="Tus ejercicios contables, cuál estás usando y el paso al siguiente al cerrar el año.">
        <div className="space-y-3">
          <FiscalYearsList activeYearId={ctx.fiscalYear.id} companyId={ctx.company.id} years={years.map((year) => ({ ...year, startsAt: year.startsAt.toISOString(), endsAt: year.endsAt.toISOString() }))} />
          {lifecycle ? <FiscalYearLifecyclePanel canWrite={canWriteAccounting} lifecycle={{ ...lifecycle, companyId: ctx.company.id }} /> : null}
        </div>
      </PageSection>
      <PageSection className="scroll-mt-24" id="plantilla" title="Plantilla de la empresa" description="Lo necesario para contabilizar sin introducir códigos contables a mano.">
        <CompanyDefaultsPanel initialStatus={defaultsStatus} />
      </PageSection>
      <PageSection className="scroll-mt-24" id="subcuentas" title="Longitud de subcuentas" description="Dígitos de las subcuentas donde se apunta (clientes 430…, proveedores 400/410…, IVA 477…).">
        <SubaccountLengthForm initialValue={settings?.subaccountLength ?? 8} locked={hasEntries} />
      </PageSection>
      <PageSection className="scroll-mt-24" id="cuentas" title="Cuentas por defecto" description="Dónde apunta la contabilidad automática las ventas, compras, clientes, proveedores y bancos.">
        <DefaultAccountsForm
          accountNames={Object.fromEntries(accountRows.map((row) => [row.code, row.name]))}
          initialValues={defaultAccounts}
          locked={hasEntries}
        />
      </PageSection>
      <PageSection className="scroll-mt-24" id="catalogo" title="Cuentas y diarios predefinidos" description="Catálogo contable para revisar o completar cuentas y diarios concretos.">
        <LazyAccountingMasters
          catalogAccounts={template?.accounts ?? []}
          catalogJournals={template?.journals ?? []}
          catalogLabel={template?.label ?? "Sin plantilla"}
          missingAccounts={accountingMasterStatus.missingAccounts}
          missingJournals={accountingMasterStatus.missingJournals}
        />
      </PageSection>
    </PageShell>
  );
}
