import { and, desc, eq } from "drizzle-orm";

import { customer, sepaMandate } from "@/db/schema";
import { checkIban, isValidBic, normalizeBic } from "@/lib/bank-import/iban";
import { db } from "@/lib/db";
import { AccountingRuleError } from "@/server/accounting/errors";
import { recordAudit } from "@/server/audit";
import { isValidMandateReference, mandateExpiresAt, proposeMandateReference } from "@/server/sepa/direct-debit-rules";

/*
 * Mandatos SEPA de adeudo directo (CORE): la autorización firmada por el cliente para cargarle
 * sus recibos en la cuenta indicada. Se gestionan desde la ficha del cliente.
 */

type Actor = { companyId: string; tenantId: string; actorUserId: string };

export type MandatePayload = {
  mandateReference?: string | null;
  signatureDate: Date;
  iban: string;
  bic?: string | null;
  mandateType: "RECURRENT" | "ONE_OFF";
  notes?: string | null;
};

export async function listCustomerMandates(companyId: string, customerId: string, now = new Date()) {
  const rows = await db
    .select({
      id: sepaMandate.id,
      mandateReference: sepaMandate.mandateReference,
      signatureDate: sepaMandate.signatureDate,
      iban: sepaMandate.iban,
      bic: sepaMandate.bic,
      mandateType: sepaMandate.mandateType,
      status: sepaMandate.status,
      collectionCount: sepaMandate.collectionCount,
      firstCollectionAt: sepaMandate.firstCollectionAt,
      lastCollectionAt: sepaMandate.lastCollectionAt,
      revokedAt: sepaMandate.revokedAt,
      notes: sepaMandate.notes,
      createdAt: sepaMandate.createdAt,
    })
    .from(sepaMandate)
    .where(and(eq(sepaMandate.companyId, companyId), eq(sepaMandate.customerId, customerId)))
    .orderBy(desc(sepaMandate.createdAt), desc(sepaMandate.id));
  return rows.map((row) => {
    const expiresAt = mandateExpiresAt(row);
    return { ...row, expiresAt, expired: expiresAt.getTime() < now.getTime() };
  });
}

async function ownedCustomer(companyId: string, customerId: string) {
  const [row] = await db
    .select({ id: customer.id, name: customer.name })
    .from(customer)
    .where(and(eq(customer.companyId, companyId), eq(customer.id, customerId)))
    .limit(1);
  if (!row) throw new AccountingRuleError(404, "CUSTOMER_NOT_FOUND", "Cliente no encontrado.");
  return row;
}

export async function createCustomerMandate(actor: Actor, customerId: string, payload: MandatePayload, now = new Date()) {
  const owner = await ownedCustomer(actor.companyId, customerId);
  const iban = checkIban(payload.iban);
  if (!iban.valid) throw new AccountingRuleError(422, "IBAN_INVALID", `IBAN del cliente: ${iban.reason}`);
  if (payload.bic && !isValidBic(payload.bic)) throw new AccountingRuleError(422, "BIC_INVALID", "El BIC no es válido (8 u 11 caracteres).");
  if (Number.isNaN(payload.signatureDate.getTime())) throw new AccountingRuleError(422, "SIGNATURE_DATE", "La fecha de firma no es válida.");
  if (payload.signatureDate.getTime() > now.getTime() + 86_400_000) throw new AccountingRuleError(422, "SIGNATURE_DATE", "La fecha de firma no puede ser futura.");
  const reference = payload.mandateReference?.trim() || proposeMandateReference(owner.name, now);
  if (!isValidMandateReference(reference)) {
    throw new AccountingRuleError(422, "MANDATE_REFERENCE", "La referencia del mandato admite hasta 35 letras sin tilde, cifras y los signos / - ? : ( ) . , ' + (sin espacios).");
  }
  return db.transaction(async (tx) => {
    const [duplicate] = await tx
      .select({ id: sepaMandate.id })
      .from(sepaMandate)
      .where(and(eq(sepaMandate.companyId, actor.companyId), eq(sepaMandate.mandateReference, reference)))
      .limit(1);
    if (duplicate) throw new AccountingRuleError(409, "MANDATE_DUPLICATE", `Ya existe un mandato con la referencia ${reference}.`);
    const [created] = await tx
      .insert(sepaMandate)
      .values({
        companyId: actor.companyId,
        customerId: owner.id,
        mandateReference: reference,
        signatureDate: payload.signatureDate,
        iban: iban.iban,
        bic: payload.bic ? normalizeBic(payload.bic) : null,
        mandateType: payload.mandateType,
        notes: payload.notes?.trim() || null,
      })
      .returning({ id: sepaMandate.id, mandateReference: sepaMandate.mandateReference });
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "sepa_mandate.create",
      entityName: "sepaMandate",
      entityId: created.id,
      payload: { customerId: owner.id, mandateReference: reference, mandateType: payload.mandateType, signatureDate: payload.signatureDate.toISOString() },
    }, tx);
    return created;
  });
}

/** Revoca un mandato (el cliente lo ha anulado o se sustituye por otro): no se usará en nuevas remesas. */
export async function revokeCustomerMandate(actor: Actor, customerId: string, mandateId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(sepaMandate)
      .set({ status: "REVOKED", revokedAt: now, updatedAt: now })
      .where(and(eq(sepaMandate.companyId, actor.companyId), eq(sepaMandate.customerId, customerId), eq(sepaMandate.id, mandateId), eq(sepaMandate.status, "ACTIVE")))
      .returning({ id: sepaMandate.id, mandateReference: sepaMandate.mandateReference });
    if (!updated) return null;
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "sepa_mandate.revoke",
      entityName: "sepaMandate",
      entityId: updated.id,
      payload: { customerId, mandateReference: updated.mandateReference },
    }, tx);
    return updated;
  });
}
