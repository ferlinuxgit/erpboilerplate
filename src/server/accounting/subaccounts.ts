import { and, eq, inArray, like, sql } from "drizzle-orm";

import { accountChart, company, companySettings, journalEntry, partner } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { getCompanyTemplate } from "@/lib/company-templates";
import { AccountingRuleError } from "@/server/accounting/errors";
import {
  ancestorCodes,
  canonicalSubaccountCode,
  defaultSupplierKind,
  isCanonicalSubaccountCode,
  isSupplierKind,
  natureForAccountType,
  nearestAncestorCode,
  nextFreePartnerSubaccountCode,
  normalizeSubaccountLength,
  partnerAccountPrefix,
  partnerSequenceFromNumber,
  partnerSubaccountCode,
  isValidSubaccountLength,
  type PartnerAccountRole,
  type SupplierKind,
} from "@/server/accounting/subaccounts-model";

export type ChartContext = {
  subaccountLength: number;
  countryCode: string;
  businessType: string;
  customerCode: string | null;
  supplierCode: string | null;
};

export type SubaccountRef = { id: string; code: string; name: string };

type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE" | "MIXED";

/**
 * Memo por transacción (mismo patrón que `resolveAccounts`): una importación o un cierre con muchos
 * asientos resuelve cada subcuenta una sola vez. Con el `db` global no se memoiza.
 */
const memoByTransaction = new WeakMap<object, Map<string, Promise<unknown>>>();

function memoized<T>(client: DbClient, key: string, load: () => Promise<T>): Promise<T> {
  if (client === db) return load();
  let byKey = memoByTransaction.get(client);
  if (!byKey) {
    byKey = new Map();
    memoByTransaction.set(client, byKey);
  }
  const existing = byKey.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const pending = load();
  byKey.set(key, pending);
  const memo = byKey;
  pending.catch(() => memo.delete(key));
  return pending;
}

/** Olvida lo memoizado de una empresa en la transacción (tras reclasificar o cambiar la longitud). */
export function forgetChartMemo(client: DbClient) {
  memoByTransaction.delete(client);
}

export async function loadChartContext(companyId: string, client: DbClient = db): Promise<ChartContext> {
  return memoized(client, `context:${companyId}`, async () => {
    const [row] = await client
      .select({
        countryCode: company.countryCode,
        subaccountLength: companySettings.subaccountLength,
        businessType: companySettings.businessType,
        customerCode: companySettings.defaultCustomerAccountCode,
        supplierCode: companySettings.defaultSupplierAccountCode,
      })
      .from(company)
      .leftJoin(companySettings, eq(companySettings.companyId, company.id))
      .where(eq(company.id, companyId))
      .limit(1);
    return {
      subaccountLength: normalizeSubaccountLength(row?.subaccountLength),
      countryCode: (row?.countryCode ?? "ES").toUpperCase(),
      businessType: row?.businessType ?? "both",
      customerCode: row?.customerCode ?? null,
      supplierCode: row?.supplierCode ?? null,
    };
  });
}

export async function getSubaccountLength(companyId: string, client: DbClient = db) {
  return (await loadChartContext(companyId, client)).subaccountLength;
}

type ChartRow = { code: string; name: string; type: AccountType };

/**
 * Garantiza la cadena de cuentas de grupo de `code` y devuelve la más cercana (prefijo más largo).
 * Si faltan grupos y el plan de la empresa (PGC) los tiene, los crea sin apuntes.
 */
async function ensureAncestors(client: DbClient, companyId: string, context: ChartContext, code: string): Promise<ChartRow | null> {
  const prefixes = ancestorCodes(code);
  if (prefixes.length === 0) return null;
  const existing = await client
    .select({ code: accountChart.code, name: accountChart.name, type: accountChart.type })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), inArray(accountChart.code, prefixes)));
  const byCode = new Map<string, ChartRow>(existing.map((row) => [row.code, row]));

  const catalog = getCompanyTemplate(context.countryCode)?.accounts ?? [];
  const missing = catalog.filter((account) => prefixes.includes(account.code) && !byCode.has(account.code));
  if (missing.length > 0) {
    await client
      .insert(accountChart)
      .values(missing.map((account) => ({
        companyId,
        code: account.code,
        name: account.name,
        type: account.type,
        parentCode: account.parentCode ?? nearestAncestorCode(account.code, [...byCode.keys(), ...missing.map((entry) => entry.code)]),
        level: account.level ?? account.code.length,
        isPostable: false,
        isActive: false,
        source: account.source ?? "subaccount-parent",
        templateVersion: account.templateVersion ?? null,
        nature: natureForAccountType(account.type),
      })))
      .onConflictDoNothing();
    for (const account of missing) byCode.set(account.code, { code: account.code, name: account.name, type: account.type });
  }

  const nearest = nearestAncestorCode(code, byCode.keys());
  return nearest ? byCode.get(nearest) ?? null : null;
}

async function findAccountByCode(client: DbClient, companyId: string, code: string) {
  const [row] = await client
    .select({ id: accountChart.id, code: accountChart.code, name: accountChart.name, isPostable: accountChart.isPostable, partnerId: accountChart.partnerId })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), eq(accountChart.code, code)))
    .limit(1);
  return row ?? null;
}

async function insertSubaccount(
  client: DbClient,
  companyId: string,
  context: ChartContext,
  code: string,
  options: { name?: string | null; partnerId?: string | null; baseLabel: string },
): Promise<SubaccountRef> {
  const parent = await ensureAncestors(client, companyId, context, code);
  if (!parent) {
    throw new AccountingRuleError(
      422,
      "ACCOUNT_MISSING",
      `No existe la cuenta ${options.baseLabel} en el plan contable. Créala o revisa las cuentas por defecto en Contabilidad → Plan contable.`,
    );
  }
  await client
    .insert(accountChart)
    .values({
      companyId,
      code,
      name: options.name?.trim() || parent.name,
      type: parent.type,
      parentCode: parent.code,
      level: code.length,
      isPostable: true,
      isActive: true,
      source: options.partnerId ? "partner" : "subaccount",
      nature: natureForAccountType(parent.type),
      partnerId: options.partnerId ?? null,
    })
    .onConflictDoNothing();
  const created = await findAccountByCode(client, companyId, code);
  if (!created) throw new Error(`No se pudo crear la subcuenta ${code}.`);
  return { id: created.id, code: created.code, name: created.name };
}

/**
 * Subcuenta canónica de un código base (477 → 47700000, 4751 → 47510000, 700000 → 70000000),
 * creándola si falta con su cadena de cuentas de grupo y el nombre de la cuenta del PGC.
 * Los asientos automáticos solo apuntan en subcuentas obtenidas aquí.
 */
export async function ensureSubaccount(companyId: string, baseCode: string, client: DbClient = db): Promise<SubaccountRef> {
  const context = await loadChartContext(companyId, client);
  const code = canonicalSubaccountCode(baseCode, context.subaccountLength);
  if (!code) {
    throw new AccountingRuleError(
      422,
      "ACCOUNT_CODE_INVALID",
      `La cuenta ${baseCode} no se puede convertir en una subcuenta de ${context.subaccountLength} dígitos.`,
    );
  }
  return memoized(client, `subaccount:${companyId}:${code}`, async () => {
    const existing = await findAccountByCode(client, companyId, code);
    if (existing) {
      if (!existing.isPostable) {
        await client.update(accountChart).set({ isPostable: true }).where(and(eq(accountChart.companyId, companyId), eq(accountChart.code, code)));
      }
      return { id: existing.id, code: existing.code, name: existing.name };
    }
    return insertSubaccount(client, companyId, context, code, { baseLabel: baseCode });
  });
}

export type ManualAccountInput = { code: string; name: string; type: AccountType };

/**
 * Alta manual de una cuenta del plan contable, siempre enlazada con su cuenta padre:
 * - con la longitud de subcuenta → subcuenta que admite apuntes (su cadena de grupos se crea con el PGC);
 * - más corta → cuenta de grupo sin apuntes, y además su subcuenta canónica con el mismo nombre para
 *   poder usarla ya (crear «629» deja lista la 62900000).
 * Devuelve la cuenta donde se apunta.
 */
export async function createManualAccount(client: DbClient, companyId: string, input: ManualAccountInput) {
  const context = await loadChartContext(companyId, client);
  const code = input.code.trim();
  const name = input.name.trim();
  if (!/^\d+$/.test(code)) throw new AccountingRuleError(422, "ACCOUNT_CODE_INVALID", "El código de la cuenta solo puede tener dígitos.");
  if (code.length > context.subaccountLength) {
    throw new AccountingRuleError(422, "ACCOUNT_CODE_TOO_LONG", `Las subcuentas de la empresa tienen ${context.subaccountLength} dígitos: el código no puede ser más largo.`);
  }
  if (await findAccountByCode(client, companyId, code)) {
    throw new AccountingRuleError(409, "ACCOUNT_EXISTS", `Ya existe la cuenta ${code} en el plan contable.`);
  }
  const parent = await ensureAncestors(client, companyId, context, code);
  const isSubaccount = code.length === context.subaccountLength;
  if (isSubaccount && !parent) {
    throw new AccountingRuleError(422, "ACCOUNT_PARENT_MISSING", `No existe ninguna cuenta de grupo para ${code}. Crea antes su cuenta de grupo (p. ej. ${code.slice(0, 3)}).`);
  }
  const [created] = await client
    .insert(accountChart)
    .values({
      companyId,
      code,
      name,
      type: input.type,
      parentCode: parent?.code ?? null,
      level: code.length,
      isPostable: isSubaccount,
      isActive: true,
      source: "manual",
      nature: natureForAccountType(input.type),
    })
    .returning();
  if (isSubaccount) return created;

  const canonical = canonicalSubaccountCode(code, context.subaccountLength);
  const existing = canonical ? await findAccountByCode(client, companyId, canonical) : null;
  if (!canonical || existing) return created;
  const [subaccount] = await client
    .insert(accountChart)
    .values({
      companyId,
      code: canonical,
      name,
      type: input.type,
      parentCode: code,
      level: canonical.length,
      isPostable: true,
      isActive: true,
      source: "manual",
      nature: natureForAccountType(input.type),
    })
    .returning();
  return subaccount;
}

/**
 * Cuenta donde se apunta realmente: la propia si ya es subcuenta; si es de grupo (o de otra
 * longitud), su subcuenta canónica. Códigos más largos que la longitud (datos antiguos) se respetan.
 */
export async function toPostableAccountId(companyId: string, accountId: string, client: DbClient = db): Promise<string> {
  return memoized(client, `postable:${companyId}:${accountId}`, async () => {
    const [row] = await client
      .select({ id: accountChart.id, code: accountChart.code })
      .from(accountChart)
      .where(and(eq(accountChart.companyId, companyId), eq(accountChart.id, accountId)))
      .limit(1);
    if (!row) throw new AccountingRuleError(422, "ACCOUNT_INVALID", "Alguna cuenta del asiento no existe en el plan contable de la empresa.");
    const context = await loadChartContext(companyId, client);
    if (isCanonicalSubaccountCode(row.code, context.subaccountLength) || row.code.length > context.subaccountLength) return row.id;
    return (await ensureSubaccount(companyId, row.code, client)).id;
  });
}

export type PartnerForSubaccount = {
  id: string;
  companyId: string;
  number: string;
  name: string;
  type: "CUSTOMER" | "SUPPLIER" | "BOTH";
  supplierKind: string | null;
  defaultAccountId: string | null;
};

async function loadPartner(client: DbClient, companyId: string, partnerId: string): Promise<PartnerForSubaccount | null> {
  const [row] = await client
    .select({
      id: partner.id,
      companyId: partner.companyId,
      number: partner.number,
      name: partner.name,
      type: partner.type,
      supplierKind: partner.supplierKind,
      defaultAccountId: partner.defaultAccountId,
    })
    .from(partner)
    .where(and(eq(partner.companyId, companyId), eq(partner.id, partnerId)))
    .limit(1);
  return row ?? null;
}

/** Rol principal del tercero: el que ocupa `partner.defaultAccountId` (BOTH → proveedor). */
export function primaryPartnerRole(type: PartnerForSubaccount["type"]): PartnerAccountRole {
  return type === "CUSTOMER" ? "customer" : "supplier";
}

export function effectiveSupplierKind(partnerKind: string | null | undefined, businessType: string | null | undefined): SupplierKind {
  return isSupplierKind(partnerKind) ? partnerKind : defaultSupplierKind(businessType);
}

/**
 * Subcuenta del tercero para un rol (cliente 430…, proveedor 400…/410…), creándola si no existe:
 * prefijo + número del tercero (43000001), o la siguiente libre si ese código ya es de otro.
 * `prefix` fuerza el grupo (p. ej. el pago de una factura antigua registrada en 410). Si el rol es
 * el principal del tercero, la deja en `partner.defaultAccountId`.
 */
export async function ensurePartnerSubaccount(
  partnerRef: { id: string; companyId: string } | PartnerForSubaccount,
  options: { role?: PartnerAccountRole; prefix?: string; client?: DbClient } = {},
): Promise<SubaccountRef> {
  const client = options.client ?? db;
  const row = "number" in partnerRef ? partnerRef : await loadPartner(client, partnerRef.companyId, partnerRef.id);
  if (!row) throw new AccountingRuleError(404, "PARTNER_NOT_FOUND", "Tercero no encontrado.");
  const context = await loadChartContext(row.companyId, client);
  const role = options.role ?? primaryPartnerRole(row.type);
  const prefix = options.prefix ?? partnerAccountPrefix({
    role,
    supplierKind: effectiveSupplierKind(row.supplierKind, context.businessType),
    countryCode: context.countryCode,
    customerCode: context.customerCode,
    supplierCode: context.supplierCode,
  });
  const length = context.subaccountLength;

  return memoized(client, `partner:${row.companyId}:${row.id}:${prefix}`, async () => {
    // Un grupo forzado (apuntes antiguos en 410 de un proveedor de mercaderías) no cambia su subcuenta principal.
    const isPrimary = role === primaryPartnerRole(row.type) && !options.prefix;
    const setDefault = async (accountId: string) => {
      if (!isPrimary || row.defaultAccountId === accountId) return;
      await client
        .update(partner)
        .set({ defaultAccountId: accountId, updatedAt: new Date() })
        .where(and(eq(partner.companyId, row.companyId), eq(partner.id, row.id)));
    };

    if (row.defaultAccountId) {
      const [current] = await client
        .select({ id: accountChart.id, code: accountChart.code, name: accountChart.name })
        .from(accountChart)
        .where(and(eq(accountChart.companyId, row.companyId), eq(accountChart.id, row.defaultAccountId)))
        .limit(1);
      if (current && current.code.startsWith(prefix) && isCanonicalSubaccountCode(current.code, length)) return current;
    }

    const [owned] = await client
      .select({ id: accountChart.id, code: accountChart.code, name: accountChart.name })
      .from(accountChart)
      .where(and(
        eq(accountChart.companyId, row.companyId),
        eq(accountChart.partnerId, row.id),
        like(accountChart.code, `${prefix}%`),
        sql`length(${accountChart.code}) = ${length}`,
      ))
      .orderBy(accountChart.code)
      .limit(1);
    if (owned) {
      await setDefault(owned.id);
      return owned;
    }

    let code = partnerSubaccountCode(prefix, partnerSequenceFromNumber(row.number) ?? 1, length);
    const taken = code ? await findAccountByCode(client, row.companyId, code) : null;
    if (!code || (taken && taken.partnerId !== row.id)) {
      const inRange = await client
        .select({ code: accountChart.code })
        .from(accountChart)
        .where(and(eq(accountChart.companyId, row.companyId), like(accountChart.code, `${prefix}%`), sql`length(${accountChart.code}) = ${length}`));
      code = nextFreePartnerSubaccountCode(prefix, length, inRange.map((entry) => entry.code));
    }
    if (!code) {
      throw new AccountingRuleError(422, "PARTNER_ACCOUNT_RANGE_FULL", `No quedan subcuentas libres en la cuenta ${prefix}. Amplía la longitud de las subcuentas.`);
    }
    const created = taken && taken.partnerId === row.id
      ? { id: taken.id, code: taken.code, name: taken.name }
      : await insertSubaccount(client, row.companyId, context, code, { name: row.name, partnerId: row.id, baseLabel: prefix });
    await setDefault(created.id);
    return created;
  });
}

/**
 * Crea las subcuentas de un tercero recién dado de alta o modificado (cliente y/o proveedor según su
 * tipo) y actualiza su nombre. No falla si el plan contable aún no está configurado: la subcuenta se
 * creará al contabilizar el primer documento.
 */
export async function syncPartnerSubaccounts(client: DbClient, companyId: string, partnerId: string) {
  const row = await loadPartner(client, companyId, partnerId);
  if (!row) return;
  await client
    .update(accountChart)
    .set({ name: row.name })
    .where(and(eq(accountChart.companyId, companyId), eq(accountChart.partnerId, partnerId), sql`${accountChart.name} <> ${row.name}`));
  const roles: PartnerAccountRole[] = row.type === "BOTH" ? ["supplier", "customer"] : [primaryPartnerRole(row.type)];
  for (const role of roles) {
    try {
      await ensurePartnerSubaccount(row, { role, client });
    } catch (error) {
      // Plan contable sin grupos 43/40/41 (empresa sin configurar): se crea al contabilizar.
      if (error instanceof AccountingRuleError && error.code === "ACCOUNT_MISSING") continue;
      throw error;
    }
  }
}

/** Subcuenta existente del tercero en un grupo (430, 400, 410), sin crearla. Para mostrarla en su ficha. */
export async function findPartnerSubaccount(companyId: string, partnerId: string, prefixes: string[], client: DbClient = db) {
  const rows = await client
    .select({ id: accountChart.id, code: accountChart.code, name: accountChart.name })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), eq(accountChart.partnerId, partnerId)))
    .orderBy(accountChart.code);
  return rows.find((row) => prefixes.some((prefix) => row.code.startsWith(prefix))) ?? null;
}

/** ¿La empresa tiene ya asientos? Con asientos la longitud de subcuenta no se puede cambiar. */
export async function companyHasJournalEntries(companyId: string, client: DbClient = db) {
  const [row] = await client.select({ id: journalEntry.id }).from(journalEntry).where(eq(journalEntry.companyId, companyId)).limit(1);
  return Boolean(row);
}

/**
 * Nuevo código de una subcuenta al cambiar la longitud (función pura): las de terceros conservan
 * grupo y número (43000001 → 4300000001); el resto es la subcuenta canónica de su cuenta padre.
 */
export function resizedSubaccountCode(account: { code: string; parentCode: string | null; partnerId: string | null }, newLength: number) {
  if (account.partnerId) {
    const prefix = account.code.slice(0, 3);
    return partnerSubaccountCode(prefix, Number(account.code.slice(3)), newLength);
  }
  const base = account.parentCode ?? account.code.replace(/0+$/, "");
  return canonicalSubaccountCode(base || account.code, newLength);
}

/**
 * Cambia la longitud de las subcuentas (8–12) mientras la empresa no tenga asientos: renombra las
 * subcuentas existentes a la nueva longitud. Falla si dos subcuentas acabarían con el mismo código.
 */
export async function changeSubaccountLength(client: DbClient, companyId: string, newLength: number) {
  if (!isValidSubaccountLength(newLength)) {
    throw new AccountingRuleError(422, "SUBACCOUNT_LENGTH_INVALID", "La longitud de las subcuentas debe estar entre 8 y 12 dígitos.");
  }
  if (await companyHasJournalEntries(companyId, client)) {
    throw new AccountingRuleError(409, "SUBACCOUNT_LENGTH_LOCKED", "La empresa ya tiene asientos: la longitud de las subcuentas ya no se puede cambiar.");
  }
  const context = await loadChartContext(companyId, client);
  forgetChartMemo(client);
  if (context.subaccountLength === newLength) return { changed: 0 };
  const accounts = await client
    .select({ id: accountChart.id, code: accountChart.code, parentCode: accountChart.parentCode, partnerId: accountChart.partnerId })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), sql`length(${accountChart.code}) = ${context.subaccountLength}`));
  const renames = accounts.map((account) => ({ id: account.id, from: account.code, to: resizedSubaccountCode(account, newLength) }));
  const invalid = renames.find((rename) => !rename.to);
  if (invalid) throw new AccountingRuleError(409, "SUBACCOUNT_LENGTH_CONFLICT", `La subcuenta ${invalid.from} no cabe en ${newLength} dígitos.`);
  const targets = new Set<string>();
  for (const rename of renames) {
    if (targets.has(rename.to as string)) throw new AccountingRuleError(409, "SUBACCOUNT_LENGTH_CONFLICT", `Dos subcuentas acabarían con el código ${rename.to}.`);
    targets.add(rename.to as string);
  }
  // Primero a un código temporal para no chocar con la restricción única entre renombrados.
  for (const rename of renames) await client.update(accountChart).set({ code: `~${rename.id}` }).where(eq(accountChart.id, rename.id));
  for (const rename of renames) {
    await client.update(accountChart).set({ code: rename.to as string, level: newLength }).where(eq(accountChart.id, rename.id));
  }
  await client.update(companySettings).set({ subaccountLength: newLength, updatedAt: new Date() }).where(eq(companySettings.companyId, companyId));
  forgetChartMemo(client);
  return { changed: renames.length };
}
