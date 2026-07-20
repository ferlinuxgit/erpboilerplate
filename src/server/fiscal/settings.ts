import { eq } from "drizzle-orm";

import type { FiscalSettingsFormValues } from "@/components/fiscal/fiscal-settings-form";
import { companySettings } from "@/db/schema";
import { db } from "@/lib/db";

export function defaultFiscalSettings(): FiscalSettingsFormValues {
  return {
    logoUrl: "",
    paymentTermsDays: 30,
    fiscalRegime: "general",
    taxPeriodicity: "quarterly",
    siiEnabled: false,
    verifactuMode: "pending",
    prorrataPct: 100,
    defaultCustomerAccountCode: "4300",
    defaultSupplierAccountCode: "4100",
    defaultSalesAccountCode: "700",
    defaultPurchaseAccountCode: "600",
    defaultBankAccountCode: "572",
  };
}

export async function getFiscalSettings(
  companyId: string,
): Promise<FiscalSettingsFormValues> {
  const [settings] = await db
    .select()
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);
  if (!settings) return defaultFiscalSettings();
  return {
    logoUrl: settings.logoUrl ?? "",
    paymentTermsDays: settings.paymentTermsDays,
    fiscalRegime:
      settings.fiscalRegime as FiscalSettingsFormValues["fiscalRegime"],
    taxPeriodicity:
      settings.taxPeriodicity as FiscalSettingsFormValues["taxPeriodicity"],
    siiEnabled: settings.siiEnabled,
    verifactuMode:
      settings.verifactuMode as FiscalSettingsFormValues["verifactuMode"],
    prorrataPct: Number(settings.prorrataPct),
    defaultCustomerAccountCode: settings.defaultCustomerAccountCode,
    defaultSupplierAccountCode: settings.defaultSupplierAccountCode,
    defaultSalesAccountCode: settings.defaultSalesAccountCode,
    defaultPurchaseAccountCode: settings.defaultPurchaseAccountCode,
    defaultBankAccountCode: settings.defaultBankAccountCode,
  };
}
