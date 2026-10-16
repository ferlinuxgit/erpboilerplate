import { and, eq, inArray } from "drizzle-orm";

import { accountChart, companySettings } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { recordAudit } from "@/server/audit";
import { companyHasJournalEntries } from "@/server/accounting/subaccounts";

type Actor = { tenantId: string; companyId: string; actorUserId: string };

/** Plazo de pago que se propone a los clientes sin plazo propio (vencimiento = emisión + días). */
export async function updateDefaultPaymentTerms(actor: Actor, paymentTermsDays: number) {
  if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 365) {
    throw new HttpError(400, "El plazo de pago debe ser un número de días entre 0 y 365.");
  }
  return db.transaction(async (tx) => {
    await tx
      .insert(companySettings)
      .values({ companyId: actor.companyId, paymentTermsDays })
      .onConflictDoUpdate({ target: companySettings.companyId, set: { paymentTermsDays, updatedAt: new Date() } });
    await recordAudit({ ...actor, action: "companySettings.paymentTerms", entityName: "companySettings", entityId: actor.companyId, payload: { paymentTermsDays } }, tx);
    return { paymentTermsDays };
  });
}

export const DEFAULT_ACCOUNT_ROLES = ["customer", "supplier", "sales", "purchase", "bank"] as const;
export type DefaultAccountRole = (typeof DEFAULT_ACCOUNT_ROLES)[number];
export type DefaultAccounts = Record<DefaultAccountRole, string>;

const columns = {
  customer: "defaultCustomerAccountCode",
  supplier: "defaultSupplierAccountCode",
  sales: "defaultSalesAccountCode",
  purchase: "defaultPurchaseAccountCode",
  bank: "defaultBankAccountCode",
} as const satisfies Record<DefaultAccountRole, keyof typeof companySettings.$inferInsert>;

/**
 * Cuentas en las que la contabilidad automática apunta ventas, compras, clientes, proveedores y
 * bancos. Solo se cambian antes del primer asiento: después dejarían saldos repartidos en dos
 * cuentas (las subcuentas de clientes y proveedores cuelgan de estos códigos).
 */
export async function updateDefaultAccounts(actor: Actor, accounts: DefaultAccounts) {
  const codes = DEFAULT_ACCOUNT_ROLES.map((role) => accounts[role].trim());
  if (codes.some((code) => !/^\d{3,12}$/.test(code))) {
    throw new HttpError(400, "Cada cuenta debe ser un código numérico del plan contable (por ejemplo 700 o 4300).");
  }
  return db.transaction(async (tx) => {
    if (await companyHasJournalEntries(actor.companyId, tx)) {
      throw new HttpError(409, "La empresa ya tiene asientos: las cuentas por defecto ya no se pueden cambiar.");
    }
    const existing = await tx
      .select({ code: accountChart.code })
      .from(accountChart)
      .where(and(eq(accountChart.companyId, actor.companyId), inArray(accountChart.code, codes)));
    const known = new Set(existing.map((row) => row.code));
    const missing = codes.filter((code) => !known.has(code));
    if (missing.length > 0) {
      throw new HttpError(422, `${missing.length === 1 ? "La cuenta" : "Las cuentas"} ${missing.join(", ")} no ${missing.length === 1 ? "existe" : "existen"} en tu plan contable. Créala${missing.length === 1 ? "" : "s"} primero en Contabilidad › Plan contable.`);
    }
    const values = Object.fromEntries(DEFAULT_ACCOUNT_ROLES.map((role) => [columns[role], accounts[role].trim()]));
    await tx
      .insert(companySettings)
      .values({ companyId: actor.companyId, ...values })
      .onConflictDoUpdate({ target: companySettings.companyId, set: { ...values, updatedAt: new Date() } });
    await recordAudit({ ...actor, action: "companySettings.defaultAccounts", entityName: "companySettings", entityId: actor.companyId, payload: values }, tx);
    return accounts;
  });
}

export function defaultAccountsFrom(row: Partial<Record<(typeof columns)[DefaultAccountRole], string>> | undefined, fallback: DefaultAccounts): DefaultAccounts {
  return Object.fromEntries(DEFAULT_ACCOUNT_ROLES.map((role) => [role, row?.[columns[role]] ?? fallback[role]])) as DefaultAccounts;
}
