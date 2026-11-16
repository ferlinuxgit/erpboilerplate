import { and, count, eq, sql } from "drizzle-orm";

import { accountChart, bankAccount, company, companySettings, customer, documentSeries, invoice, tenant } from "@/db/schema";
import { getCompanyTemplate } from "@/lib/company-templates";
import { companyInvoiceReadiness, normalizeIban, parseBusinessType, type BusinessType } from "@/lib/company-readiness";
import { db, type DbClient } from "@/lib/db";
import { HttpError } from "@/lib/http";
import type { OnboardingStepPayload } from "@/lib/onboarding";
import { getCountryFiscalProfile } from "@/lib/country-packs/profile";
import { normalizeTaxIdForCountry, spanishTaxpayerTypeFromTaxId } from "@/lib/country-packs/tax-id";
import { DEFAULT_COMPANY_NAME } from "@/lib/tenant";
import { recordAudit } from "@/server/audit";
import { changeCompanyCountry } from "@/server/company/country";
import { applyCompanyTemplate } from "@/server/seeds/apply";
import { createBankAccount } from "@/server/treasury/service";

export type OnboardingActor = {
  tenantId: string;
  tenantName: string;
  companyId: string;
  companyName: string;
  countryCode: string;
  fiscalYearId: string;
  actorUserId: string;
};

/** Estado de configuración de la empresa: alimenta el asistente, el panel y la redirección inicial. */
export async function getCompanySetupState(companyId: string, fiscalYearId: string) {
  const [[profile], [settings], [series], [banks], [customers], [invoices]] = await Promise.all([
    db
      .select({
        name: company.name,
        legalName: company.legalName,
        vatNumber: company.vatNumber,
        fiscalAddress: company.fiscalAddress,
        postalCode: company.postalCode,
        city: company.city,
        province: company.province,
        countryCode: company.countryCode,
      })
      .from(company)
      .where(eq(company.id, companyId))
      .limit(1),
    db
      .select({
        businessType: companySettings.businessType,
        onboardingCompletedAt: companySettings.onboardingCompletedAt,
        onboardingDismissedAt: companySettings.onboardingDismissedAt,
      })
      .from(companySettings)
      .where(eq(companySettings.companyId, companyId))
      .limit(1),
    db
      .select({ prefix: documentSeries.prefix, nextNumber: documentSeries.nextNumber })
      .from(documentSeries)
      .where(and(eq(documentSeries.companyId, companyId), eq(documentSeries.fiscalYearId, fiscalYearId), eq(documentSeries.type, "SALES_INVOICE"), eq(documentSeries.isDefault, true)))
      .limit(1),
    db.select({ total: count(), firstIban: sql<string | null>`min(${bankAccount.iban})` }).from(bankAccount).where(and(eq(bankAccount.companyId, companyId), eq(bankAccount.isActive, true))),
    db.select({ total: count() }).from(customer).where(eq(customer.companyId, companyId)),
    db.select({ total: count() }).from(invoice).where(eq(invoice.companyId, companyId)),
  ]);

  const readiness = companyInvoiceReadiness(profile ?? {});
  return {
    profile: profile ?? null,
    readiness,
    businessType: parseBusinessType(settings?.businessType),
    onboardingCompletedAt: settings?.onboardingCompletedAt ?? null,
    onboardingDismissedAt: settings?.onboardingDismissedAt ?? null,
    invoiceSeries: series ?? null,
    bankAccountCount: Number(banks?.total ?? 0),
    firstIban: banks?.firstIban ?? null,
    customerCount: Number(customers?.total ?? 0),
    invoiceCount: Number(invoices?.total ?? 0),
  };
}

export type CompanySetupState = Awaited<ReturnType<typeof getCompanySetupState>>;

/** Qué vende la empresa activa (para adaptar navegación y avisos). */
export async function getCompanyBusinessType(companyId: string): Promise<BusinessType> {
  const [row] = await db.select({ businessType: companySettings.businessType }).from(companySettings).where(eq(companySettings.companyId, companyId)).limit(1);
  return parseBusinessType(row?.businessType);
}

/**
 * Garantiza la fila de `company_settings` con los valores de la plantilla del país,
 * sin aplicar todavía el plan contable completo.
 */
async function ensureSettingsRow(tx: DbClient, companyId: string, countryCode: string) {
  const [existing] = await tx.select({ id: companySettings.id }).from(companySettings).where(eq(companySettings.companyId, companyId)).limit(1);
  if (existing) return;
  const template = getCompanyTemplate(countryCode).settings;
  await tx
    .insert(companySettings)
    .values({
      companyId,
      fiscalRegime: template.fiscalRegime,
      taxPeriodicity: template.taxPeriodicity,
      defaultCustomerAccountCode: template.defaultCustomerAccountCode,
      defaultSupplierAccountCode: template.defaultSupplierAccountCode,
      defaultSalesAccountCode: template.defaultSalesAccountCode,
      defaultPurchaseAccountCode: template.defaultPurchaseAccountCode,
      defaultBankAccountCode: template.defaultBankAccountCode,
    })
    .onConflictDoNothing();
}

/**
 * ¿Ya se aplicó la plantilla del país (plan contable y series del ejercicio)? Evita
 * repetir el upsert del plan contable completo en cada paso del asistente.
 */
async function templateAlreadyApplied(companyId: string, fiscalYearId: string) {
  const [[series], [accounts]] = await Promise.all([
    db
      .select({ id: documentSeries.id })
      .from(documentSeries)
      .where(and(eq(documentSeries.companyId, companyId), eq(documentSeries.fiscalYearId, fiscalYearId), eq(documentSeries.type, "SALES_INVOICE")))
      .limit(1),
    db.select({ total: count() }).from(accountChart).where(eq(accountChart.companyId, companyId)),
  ]);
  return Boolean(series) && Number(accounts?.total ?? 0) > 0;
}

async function ensureCompanyTemplate(actor: OnboardingActor, auditAction: string) {
  if (await templateAlreadyApplied(actor.companyId, actor.fiscalYearId)) return;
  await applyCompanyTemplate({
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    activeFiscalYearId: actor.fiscalYearId,
    countryCode: actor.countryCode,
    actorUserId: actor.actorUserId,
    auditAction,
  });
}

function cleanText(value: string | undefined) {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * Guarda los datos de un paso del asistente (o del resumen de empresa). Solo toca los
 * campos enviados, así un paso a medias nunca borra lo guardado en otro.
 */
export async function saveOnboardingStep(actorInput: OnboardingActor, payload: OnboardingStepPayload) {
  // El país va primero: decide moneda, plantilla, impuestos y cómo se valida el NIF.
  let actor = actorInput;
  if (payload.countryCode && payload.countryCode !== actor.countryCode) {
    await db.transaction((tx) => changeCompanyCountry({ ...actor, countryCode: payload.countryCode! }, tx));
    actor = { ...actor, countryCode: getCountryFiscalProfile(payload.countryCode).countryCode };
  }
  const profile = getCountryFiscalProfile(actor.countryCode);
  const invoicePrefix = payload.invoicePrefix?.trim().toUpperCase();
  // La serie de facturas se crea con la plantilla del país (plan contable, impuestos y series).
  if (invoicePrefix) await ensureCompanyTemplate(actor, "company.defaults.ensure");

  const result = await db.transaction(async (tx) => {
    await ensureSettingsRow(tx, actor.companyId, actor.countryCode);

    const legalName = cleanText(payload.legalName);
    const companyValues = {
      ...(legalName ? { legalName, name: legalName } : {}),
      ...(payload.vatNumber !== undefined ? { vatNumber: payload.vatNumber.trim() ? normalizeTaxIdForCountry(payload.vatNumber, actor.countryCode) : null } : {}),
      ...(payload.fiscalAddress !== undefined ? { fiscalAddress: cleanText(payload.fiscalAddress) } : {}),
      ...(payload.postalCode !== undefined ? { postalCode: cleanText(payload.postalCode) } : {}),
      ...(payload.city !== undefined ? { city: cleanText(payload.city) } : {}),
      ...(payload.province !== undefined ? { province: cleanText(payload.province) } : {}),
    };
    if (Object.keys(companyValues).length > 0) {
      await tx.update(company).set({ ...companyValues, updatedAt: new Date() }).where(and(eq(company.id, actor.companyId), eq(company.tenantId, actor.tenantId)));
    }

    // El espacio de trabajo adopta el nombre de la empresa mientras conserve el provisional.
    if (legalName && (actor.tenantName === DEFAULT_COMPANY_NAME || actor.tenantName === actor.companyName)) {
      await tx.update(tenant).set({ name: legalName, updatedAt: new Date() }).where(eq(tenant.id, actor.tenantId));
    }

    if (payload.businessType) {
      await tx.update(companySettings).set({ businessType: payload.businessType, updatedAt: new Date() }).where(eq(companySettings.companyId, actor.companyId));
    }

    // España: autónomo o sociedad se deduce del NIF (DNI/NIE → autónomo, CIF → sociedad); decide
    // si aplica el modelo 130. No se pregunta.
    const taxpayerType = profile.features.nationalTaxIdValidation === "es" && payload.vatNumber ? spanishTaxpayerTypeFromTaxId(payload.vatNumber) : null;
    if (taxpayerType) {
      await tx.update(companySettings).set({ taxpayerType, updatedAt: new Date() }).where(eq(companySettings.companyId, actor.companyId));
    }

    let seriesPrefix: string | null = null;
    if (invoicePrefix) {
      const [series] = await tx
        .select({ id: documentSeries.id, prefix: documentSeries.prefix, nextNumber: documentSeries.nextNumber })
        .from(documentSeries)
        .where(and(eq(documentSeries.companyId, actor.companyId), eq(documentSeries.fiscalYearId, actor.fiscalYearId), eq(documentSeries.type, "SALES_INVOICE"), eq(documentSeries.isDefault, true)))
        .limit(1);
      if (series && series.prefix !== invoicePrefix) {
        // Cambiar el prefijo con facturas ya numeradas rompería la correlación de la serie.
        if (series.nextNumber > 1) {
          throw new HttpError(409, `Ya has emitido facturas con la serie ${series.prefix}. Para usar otra serie, créala en Configuración › Documentos.`);
        }
        await tx.update(documentSeries).set({ prefix: invoicePrefix }).where(and(eq(documentSeries.id, series.id), eq(documentSeries.companyId, actor.companyId)));
      }
      seriesPrefix = series ? invoicePrefix : null;
    }

    await recordAudit(
      {
        tenantId: actor.tenantId,
        companyId: actor.companyId,
        actorUserId: actor.actorUserId,
        action: "onboarding.update",
        entityName: "company",
        entityId: actor.companyId,
        payload: { ...companyValues, countryCode: actor.countryCode, taxpayerType, businessType: payload.businessType, invoicePrefix: seriesPrefix, iban: payload.iban ? "[iban]" : undefined },
      },
      tx,
    );
    return { seriesPrefix };
  });

  let bankAccountCreated = false;
  const iban = payload.iban?.trim() ? normalizeIban(payload.iban) : null;
  if (iban) {
    const [existing] = await db.select({ id: bankAccount.id }).from(bankAccount).where(and(eq(bankAccount.companyId, actor.companyId), eq(bankAccount.iban, iban))).limit(1);
    if (!existing) {
      await createBankAccount(actor.companyId, actor.tenantId, actor.actorUserId, { iban, bankName: payload.bankName?.trim() || "Cuenta principal" });
      bankAccountCreated = true;
    }
  }

  return { ...result, bankAccountCreated, countryCode: actor.countryCode };
}

/** Termina el asistente: plantilla contable completa y marca de completado. */
export async function completeOnboarding(actorInput: OnboardingActor, payload: OnboardingStepPayload) {
  let actor = actorInput;
  if (payload.countryCode && payload.countryCode !== actor.countryCode) {
    await db.transaction((tx) => changeCompanyCountry({ ...actor, countryCode: payload.countryCode! }, tx));
    actor = { ...actor, countryCode: getCountryFiscalProfile(payload.countryCode).countryCode };
  }
  // Plantilla primero: así el prefijo elegido se aplica sobre la serie recién creada.
  await ensureCompanyTemplate(actor, "onboarding.seed.apply");
  const saved = await saveOnboardingStep(actor, payload);
  await db.transaction(async (tx) => {
    await ensureSettingsRow(tx, actor.companyId, actor.countryCode);
    await tx.update(companySettings).set({ onboardingCompletedAt: new Date(), updatedAt: new Date() }).where(eq(companySettings.companyId, actor.companyId));
    await recordAudit(
      { tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action: "onboarding.complete", entityName: "company", entityId: actor.companyId },
      tx,
    );
  });
  return saved;
}

/** "Hacerlo más tarde": no se vuelve a redirigir al asistente (sigue accesible desde el panel). */
export async function dismissOnboarding(actor: OnboardingActor) {
  await db.transaction(async (tx) => {
    await ensureSettingsRow(tx, actor.companyId, actor.countryCode);
    await tx.update(companySettings).set({ onboardingDismissedAt: new Date(), updatedAt: new Date() }).where(eq(companySettings.companyId, actor.companyId));
    await recordAudit(
      { tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action: "onboarding.dismiss", entityName: "company", entityId: actor.companyId },
      tx,
    );
  });
}
