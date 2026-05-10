import { recordAudit } from "@/server/audit";
import { createCheckoutSession, createPortalSession } from "@/server/billing/stripe";

type BillingActor = {
  id: string;
  email: string;
};

type BillingContext = {
  tenantId: string;
  companyId?: string;
};

type AuditWriter = typeof recordAudit;
type CheckoutSessionCreator = typeof createCheckoutSession;
type PortalSessionCreator = typeof createPortalSession;

function billingReturnUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/$/, "")}/billing`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Error desconocido";
}

export async function openBillingCheckout(params: {
  actor: BillingActor;
  context: BillingContext;
  priceId: string;
  baseUrl: string;
  audit?: AuditWriter;
  createCheckoutSession?: CheckoutSessionCreator;
}) {
  const audit = params.audit ?? recordAudit;
  const checkoutSession = params.createCheckoutSession ?? createCheckoutSession;
  const returnUrl = billingReturnUrl(params.baseUrl);
  const auditBase = {
    tenantId: params.context.tenantId,
    companyId: params.context.companyId,
    actorUserId: params.actor.id,
    entityName: "billingCheckout",
    entityId: params.priceId,
  };

  await audit({
    ...auditBase,
    action: "billing.checkout.attempt",
    payload: { priceId: params.priceId },
  });

  try {
    const checkout = await checkoutSession({
      customerEmail: params.actor.email,
      priceId: params.priceId,
      successUrl: returnUrl,
      cancelUrl: returnUrl,
    });
    await audit({
      ...auditBase,
      action: "billing.checkout.success",
      payload: { priceId: params.priceId },
    });
    return { url: checkout.url };
  } catch (error) {
    await audit({
      ...auditBase,
      action: "billing.checkout.error",
      payload: { priceId: params.priceId, error: errorMessage(error) },
    });
    throw error;
  }
}

export async function openBillingPortal(params: {
  actor: BillingActor;
  context: BillingContext;
  stripeCustomerId: string;
  baseUrl: string;
  audit?: AuditWriter;
  createPortalSession?: PortalSessionCreator;
}) {
  const audit = params.audit ?? recordAudit;
  const portalSession = params.createPortalSession ?? createPortalSession;
  const returnUrl = billingReturnUrl(params.baseUrl);
  const auditBase = {
    tenantId: params.context.tenantId,
    companyId: params.context.companyId,
    actorUserId: params.actor.id,
    entityName: "billingPortal",
    entityId: params.stripeCustomerId,
  };

  await audit({
    ...auditBase,
    action: "billing.portal.attempt",
    payload: { stripeCustomerId: params.stripeCustomerId },
  });

  try {
    const portal = await portalSession(params.stripeCustomerId, returnUrl);
    await audit({
      ...auditBase,
      action: "billing.portal.success",
      payload: { stripeCustomerId: params.stripeCustomerId },
    });
    return { url: portal.url };
  } catch (error) {
    await audit({
      ...auditBase,
      action: "billing.portal.error",
      payload: { stripeCustomerId: params.stripeCustomerId, error: errorMessage(error) },
    });
    throw error;
  }
}
