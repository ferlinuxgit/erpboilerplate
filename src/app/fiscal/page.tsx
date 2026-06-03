import Link from "next/link";

import { FiscalSettingsForm, type FiscalSettingsFormValues } from "@/components/fiscal/fiscal-settings-form";
import { FiscalReportsList } from "@/components/fiscal/fiscal-reports-list";
import { SpanishTaxSummary } from "@/components/fiscal/spanish-tax-summary";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { companySettings } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { canFromDb } from "@/lib/rbac";
import { listFiscalReportsWithSummary } from "@/server/fiscal/service";
import { eq } from "drizzle-orm";

function defaultFiscalSettings(): FiscalSettingsFormValues {
  return {
    logoUrl: "",
    paymentTermsDays: 30,
    fiscalRegime: "general",
    taxPeriodicity: "quarterly",
    siiEnabled: false,
    verifactuMode: "pending",
    prorrataPct: 100,
    defaultCustomerAccountCode: "430000",
    defaultSupplierAccountCode: "410000",
    defaultSalesAccountCode: "700000",
    defaultPurchaseAccountCode: "600000",
    defaultBankAccountCode: "572000",
  };
}

async function getFiscalSettings(companyId: string): Promise<FiscalSettingsFormValues> {
  const [settings] = await db
    .select()
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);

  if (!settings) return defaultFiscalSettings();

  return {
    logoUrl: settings.logoUrl ?? "",
    paymentTermsDays: settings.paymentTermsDays,
    fiscalRegime: settings.fiscalRegime as FiscalSettingsFormValues["fiscalRegime"],
    taxPeriodicity: settings.taxPeriodicity as FiscalSettingsFormValues["taxPeriodicity"],
    siiEnabled: settings.siiEnabled,
    verifactuMode: settings.verifactuMode as FiscalSettingsFormValues["verifactuMode"],
    prorrataPct: Number(settings.prorrataPct),
    defaultCustomerAccountCode: settings.defaultCustomerAccountCode,
    defaultSupplierAccountCode: settings.defaultSupplierAccountCode,
    defaultSalesAccountCode: settings.defaultSalesAccountCode,
    defaultPurchaseAccountCode: settings.defaultPurchaseAccountCode,
    defaultBankAccountCode: settings.defaultBankAccountCode,
  };
}

export default async function FiscalPage() {
  const ctx = await requireContext("fiscal.read");
  const [reports, fiscalSettings] = await Promise.all([
    listFiscalReportsWithSummary(ctx.company.id),
    getFiscalSettings(ctx.company.id),
  ]);
  const canWrite = await canFromDb(ctx.membership.role, "fiscal.write");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title="Fiscalidad España"
        description="Control operativo de modelos 303, 390, 347, 111 y 115 con cálculo de IVA desde facturación emitida."
        backHref="/dashboard"
        backLabel="Volver al panel"
        meta={<StatusBadge tone={canWrite ? "success" : "warning"}>{canWrite ? "Gestión habilitada" : "Solo lectura"}</StatusBadge>}
        actions={
          canWrite ? (
            <Link className={buttonVariants()} href="/fiscal/new">
              Nuevo modelo
            </Link>
          ) : null
        }
      />
      <PageSection title="Resumen fiscal" description="Señales de cumplimiento, modelos, automatización y conciliación fiscal.">
        <SpanishTaxSummary reports={reports} />
      </PageSection>
      <PageSection title="Configuración fiscal" description="Perfil fiscal, periodicidad, SII/Verifactu y cuentas contables por defecto.">
        {canWrite ? <FiscalSettingsForm initialValues={fiscalSettings} /> : <EmptyState title="Solo lectura" description="Tu rol actual no permite modificar configuración fiscal." />}
      </PageSection>
      <PageSection title="Modelos fiscales" description="Borradores, presentados y modelos pendientes de revisión.">
        <FiscalReportsList canWrite={canWrite} reports={reports} />
      </PageSection>
    </PageShell>
  );
}
