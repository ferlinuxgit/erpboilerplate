import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";

import { CompanyDefaultsPanel } from "@/components/company/company-defaults-panel";
import { SubaccountLengthForm } from "@/components/company/subaccount-length-form";
import { LazyAccountingMasters } from "@/components/settings/lazy-accounting-masters";
import { SettingsPageHeader } from "@/components/settings/settings-page-header";
import { buttonVariants } from "@/components/ui/button";
import { PageSection, PageShell } from "@/components/ui/page";
import { companySettings } from "@/db/schema";
import { getCompanyTemplate } from "@/lib/company-templates";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { getAccountingMasterStatus } from "@/server/accounting/masters";
import { companyHasJournalEntries } from "@/server/accounting/subaccounts";
import { getCompanyDefaultsStatus } from "@/server/company/defaults";

export const metadata: Metadata = { title: "Contabilidad" };

export default async function AccountingSettingsPage() {
  const ctx = await requireContext("settings.manage");
  const template = getCompanyTemplate(ctx.company.countryCode);
  const [accountingMasterStatus, defaultsStatus, [settings], hasEntries] = await Promise.all([
    getAccountingMasterStatus(ctx.company.id, undefined, template),
    getCompanyDefaultsStatus({ companyId: ctx.company.id, fiscalYearId: ctx.fiscalYear.id, countryCode: ctx.company.countryCode }),
    db.select({ subaccountLength: companySettings.subaccountLength }).from(companySettings).where(eq(companySettings.companyId, ctx.company.id)).limit(1),
    companyHasJournalEntries(ctx.company.id),
  ]);

  return (
    <PageShell>
      <SettingsPageHeader
        actions={<Link className={buttonVariants({ variant: "outline" })} href="/accounting/accounts">Plan contable</Link>}
        sectionId="accounting"
      />
      <PageSection className="scroll-mt-24" id="plantilla" title="Plantilla de la empresa" description="Lo necesario para contabilizar sin introducir códigos contables a mano.">
        <CompanyDefaultsPanel initialStatus={defaultsStatus} />
      </PageSection>
      <PageSection className="scroll-mt-24" id="subcuentas" title="Longitud de subcuentas" description="Dígitos de las subcuentas donde se apunta (clientes 430…, proveedores 400/410…, IVA 477…).">
        <SubaccountLengthForm initialValue={settings?.subaccountLength ?? 8} locked={hasEntries} />
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
