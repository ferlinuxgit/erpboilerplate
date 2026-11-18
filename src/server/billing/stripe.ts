import { and, eq, isNull } from "drizzle-orm";
import Stripe from "stripe";

import { billingPrice, subscription } from "@/db/schema";
import { BASE_PLAN, BILLING_CURRENCY, MODULE_MONTHLY_CENTS, OCR_PACKS, modulePriceCode, type OcrPack } from "@/lib/billing/catalog";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { getModule, type ModuleId } from "@/modules/registry";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim();

export const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

function requireStripe() {
  if (!stripe) throw new HttpError(503, "El cobro no está configurado en este servidor (falta STRIPE_SECRET_KEY).");
  return stripe;
}

type PriceSpec = { code: string; name: string; description?: string; amountCents: number; interval: "month" | null };

export function basePriceSpec(): PriceSpec {
  return { code: BASE_PLAN.code, name: `Plan ${BASE_PLAN.name}`, description: BASE_PLAN.description, amountCents: BASE_PLAN.monthlyCents, interval: "month" };
}

export function modulePriceSpec(moduleId: ModuleId): PriceSpec {
  const manifest = getModule(moduleId);
  return { code: modulePriceCode(moduleId), name: `Módulo ${manifest.name}`, description: manifest.description, amountCents: MODULE_MONTHLY_CENTS[moduleId], interval: "month" };
}

export function ocrPackPriceSpec(pack: OcrPack): PriceSpec {
  return { code: `ocr:${pack.credits}`, name: `${pack.credits} créditos de lectura de facturas con IA`, amountCents: pack.cents, interval: null };
}

/**
 * Precio de Stripe para un concepto del catálogo: se reutiliza el ya creado con ese importe o se
 * crea (producto la primera vez, precio nuevo si cambia el importe). Así no hay que preparar nada a
 * mano en el panel de Stripe.
 */
export async function ensureStripePrice(spec: PriceSpec) {
  const client = requireStripe();
  const intervalCondition = spec.interval ? eq(billingPrice.interval, spec.interval) : isNull(billingPrice.interval);
  const [existing] = await db
    .select({ stripePriceId: billingPrice.stripePriceId })
    .from(billingPrice)
    .where(and(eq(billingPrice.code, spec.code), eq(billingPrice.amountCents, spec.amountCents), eq(billingPrice.currency, BILLING_CURRENCY), intervalCondition))
    .limit(1);
  if (existing) return existing.stripePriceId;
  const [sameProduct] = await db.select({ stripeProductId: billingPrice.stripeProductId }).from(billingPrice).where(eq(billingPrice.code, spec.code)).limit(1);
  const productId = sameProduct?.stripeProductId
    ?? (await client.products.create({ name: spec.name, ...(spec.description ? { description: spec.description } : {}), metadata: { code: spec.code }, tax_code: "txcd_10103001" })).id;
  const price = await client.prices.create({
    product: productId,
    currency: BILLING_CURRENCY,
    unit_amount: spec.amountCents,
    tax_behavior: "exclusive",
    ...(spec.interval ? { recurring: { interval: spec.interval } } : {}),
    metadata: { code: spec.code },
  });
  await db.insert(billingPrice).values({ code: spec.code, amountCents: spec.amountCents, currency: BILLING_CURRENCY, interval: spec.interval, stripeProductId: productId, stripePriceId: price.id }).onConflictDoNothing();
  return price.id;
}

/** Código del catálogo de un precio de Stripe (null si no es nuestro). */
export async function priceCodeFor(stripePriceId: string) {
  const [row] = await db.select({ code: billingPrice.code }).from(billingPrice).where(eq(billingPrice.stripePriceId, stripePriceId)).limit(1);
  return row?.code ?? null;
}

/** Cliente de Stripe del espacio: siempre el mismo (se crea la primera vez y se guarda). */
export async function ensureStripeCustomer(input: { tenantId: string; email: string; name: string }) {
  const client = requireStripe();
  const [row] = await db.select({ stripeCustomerId: subscription.stripeCustomerId }).from(subscription).where(eq(subscription.tenantId, input.tenantId)).limit(1);
  if (row?.stripeCustomerId) return row.stripeCustomerId;
  const customer = await client.customers.create(
    { email: input.email, name: input.name, preferred_locales: ["es"], metadata: { tenantId: input.tenantId } },
    { idempotencyKey: `customer-${input.tenantId}` },
  );
  await db
    .insert(subscription)
    .values({ tenantId: input.tenantId, plan: "free", status: "NONE", stripeCustomerId: customer.id })
    .onConflictDoUpdate({ target: subscription.tenantId, set: { stripeCustomerId: customer.id } });
  return customer.id;
}

const taxCheckout = {
  automatic_tax: { enabled: true },
  tax_id_collection: { enabled: true },
  billing_address_collection: "required",
  customer_update: { address: "auto", name: "auto" },
  locale: "es",
} as const;

/** Alta de la suscripción: plan base más los módulos elegidos, con IVA según el cliente. */
export async function createSubscriptionCheckout(input: { tenantId: string; customerId: string; modules: readonly ModuleId[]; returnUrl: string }) {
  const client = requireStripe();
  const prices = [await ensureStripePrice(basePriceSpec())];
  for (const moduleId of [...new Set(input.modules)]) prices.push(await ensureStripePrice(modulePriceSpec(moduleId)));
  return client.checkout.sessions.create({
    mode: "subscription",
    customer: input.customerId,
    line_items: prices.map((price) => ({ price, quantity: 1 })),
    success_url: `${input.returnUrl}?checkout=ok&session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.returnUrl}?checkout=cancel`,
    client_reference_id: input.tenantId,
    allow_promotion_codes: true,
    metadata: { tenantId: input.tenantId, kind: "subscription" },
    subscription_data: { metadata: { tenantId: input.tenantId } },
    ...taxCheckout,
  });
}

/**
 * Cambia los módulos de una suscripción en curso: añade y quita líneas con prorrateo (se cobra o
 * abona la parte proporcional en la siguiente factura).
 */
export async function updateSubscriptionModules(input: { stripeSubscriptionId: string; modules: readonly ModuleId[] }) {
  const client = requireStripe();
  const current = await client.subscriptions.retrieve(input.stripeSubscriptionId);
  const wanted = new Map<string, ModuleId>();
  for (const moduleId of new Set(input.modules)) wanted.set(modulePriceCode(moduleId), moduleId);
  const items: Stripe.SubscriptionUpdateParams.Item[] = [];
  const present = new Set<string>();
  for (const item of current.items.data) {
    const code = await priceCodeFor(item.price.id);
    if (!code?.startsWith("module:")) continue;
    if (wanted.has(code)) present.add(code);
    else items.push({ id: item.id, deleted: true });
  }
  for (const [code, moduleId] of wanted) {
    if (!present.has(code)) items.push({ price: await ensureStripePrice(modulePriceSpec(moduleId)), quantity: 1 });
  }
  if (items.length === 0) return current;
  return client.subscriptions.update(input.stripeSubscriptionId, { items, proration_behavior: "create_prorations" });
}

/** Compra de un pack de créditos de lectura (pago único con factura). */
export async function createCreditsCheckout(input: { tenantId: string; customerId: string; packCode: string; returnUrl: string; actorUserId: string }) {
  const client = requireStripe();
  const pack = OCR_PACKS.find((entry) => entry.code === input.packCode);
  if (!pack) throw new HttpError(400, "Ese pack de créditos no existe.");
  const price = await ensureStripePrice(ocrPackPriceSpec(pack));
  return client.checkout.sessions.create({
    mode: "payment",
    customer: input.customerId,
    line_items: [{ price, quantity: 1 }],
    success_url: `${input.returnUrl}?credits=ok&session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.returnUrl}?credits=cancel`,
    client_reference_id: input.tenantId,
    invoice_creation: { enabled: true },
    metadata: { tenantId: input.tenantId, kind: "ocr-credits", packCode: pack.code, credits: String(pack.credits), actorUserId: input.actorUserId },
    ...taxCheckout,
  });
}

/** Portal de Stripe: método de pago, facturas y cancelación. */
export async function createPortalSession(customerId: string, returnUrl: string) {
  return requireStripe().billingPortal.sessions.create({ customer: customerId, return_url: returnUrl, locale: "es" });
}
