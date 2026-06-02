import { CreateFiscalReportForm } from "@/components/fiscal/create-fiscal-report-form";
import { FiscalSettingsForm, type FiscalSettingsFormValues } from "@/components/fiscal/fiscal-settings-form";
import { FiscalReportsList } from "@/components/fiscal/fiscal-reports-list";
import { SpanishTaxSummary } from "@/components/fiscal/spanish-tax-summary";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <main className="container mx-auto px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Fiscalidad España</CardTitle>
          <CardDescription>Control operativo de modelos 303, 390, 347, 111 y 115 con cálculo de IVA desde facturación emitida.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <SpanishTaxSummary reports={reports} />
          {canWrite ? <FiscalSettingsForm initialValues={fiscalSettings} /> : null}
          {canWrite ? <CreateFiscalReportForm /> : null}
          <FiscalReportsList canWrite={canWrite} reports={reports} />
        </CardContent>
      </Card>
    </main>
  );
}
