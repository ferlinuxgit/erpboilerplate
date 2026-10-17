import { and, eq, lt } from "drizzle-orm";

import { company, posBooking } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { appBaseUrl } from "@/server/email/templates";
import { isRedsysAuthorized, redsysOrderNumber, redsysPaymentForm, redsysRefund, verifyRedsysNotification, type RedsysEnvironment } from "@/server/integrations/redsys";
import { loadIntegration } from "@/server/integrations/service";
import { createCheckoutSession, refundPayment, retrieveCheckoutSession, verifyStripeWebhook } from "@/server/integrations/stripe";

/**
 * Fianza de las reservas online: se crea el cobro (Stripe Checkout o Redsys), se confirma por aviso
 * de la pasarela (o al volver el cliente) y se devuelve si cancela a tiempo.
 */

export type DepositPayment = { kind: "redirect"; url: string } | { kind: "form"; url: string; fields: Record<string, string> };

const cents = (amount: number) => Math.round(amount * 100);

async function stripeKeys(companyId: string) {
  const integration = await loadIntegration(companyId, "STRIPE");
  if (!integration?.enabled || !integration.secrets.secretKey) throw new HttpError(409, "El cobro con tarjeta no está disponible ahora mismo: llama al restaurante.");
  return { secretKey: integration.secrets.secretKey, webhookSecret: integration.secrets.webhookSecret ?? null };
}

async function redsysCredentials(companyId: string) {
  const integration = await loadIntegration(companyId, "REDSYS");
  if (!integration?.enabled || !integration.config.merchantCode || !integration.secrets.merchantKey) throw new HttpError(409, "El cobro con tarjeta no está disponible ahora mismo: llama al restaurante.");
  return {
    credentials: { merchantCode: integration.config.merchantCode, terminal: integration.config.terminal || "1", merchantKey: integration.secrets.merchantKey, environment: (integration.config.environment === "live" ? "live" : "test") as RedsysEnvironment },
    merchantName: integration.config.merchantName || "Reserva",
  };
}

/** Prepara el cobro de la fianza de una reserva y devuelve a dónde mandar al cliente. */
export async function startDepositPayment(bookingId: string, manageToken: string): Promise<DepositPayment> {
  const [booking] = await db
    .select({ id: posBooking.id, companyId: posBooking.companyId, code: posBooking.code, status: posBooking.status, email: posBooking.email, depositAmount: posBooking.depositAmount, depositProvider: posBooking.depositProvider, holdExpiresAt: posBooking.holdExpiresAt, restaurant: company.name, currency: company.baseCurrencyCode })
    .from(posBooking)
    .innerJoin(company, eq(company.id, posBooking.companyId))
    .where(eq(posBooking.id, bookingId))
    .limit(1);
  if (!booking || booking.status !== "AWAITING_PAYMENT" || !booking.depositAmount) throw new HttpError(409, "Esta reserva no tiene una fianza pendiente.");
  if (booking.holdExpiresAt && booking.holdExpiresAt.getTime() < Date.now()) throw new HttpError(409, "Ha pasado el tiempo para pagar la fianza: vuelve a hacer la reserva.");
  const base = appBaseUrl();
  const back = `${base}/reservar/gestion/${manageToken}`;
  const amount = Number(booking.depositAmount);
  const description = `Fianza reserva ${booking.code} · ${booking.restaurant}`;

  if (booking.depositProvider === "STRIPE") {
    const { secretKey } = await stripeKeys(booking.companyId);
    const session = await createCheckoutSession(secretKey, {
      amountCents: cents(amount),
      currency: booking.currency,
      description,
      successUrl: `${back}?pago=ok`,
      cancelUrl: `${back}?pago=cancelado`,
      customerEmail: booking.email,
      expiresAt: booking.holdExpiresAt ?? new Date(Date.now() + 30 * 60_000),
      metadata: { bookingId: booking.id, companyId: booking.companyId },
    });
    await db.update(posBooking).set({ depositReference: session.id, updatedAt: new Date() }).where(eq(posBooking.id, booking.id));
    if (!session.url) throw new HttpError(502, "Stripe no ha devuelto la página de pago.");
    return { kind: "redirect", url: session.url };
  }

  const { credentials, merchantName } = await redsysCredentials(booking.companyId);
  const order = redsysOrderNumber();
  await db.update(posBooking).set({ depositReference: order, updatedAt: new Date() }).where(eq(posBooking.id, booking.id));
  const form = redsysPaymentForm(credentials, { order, amountCents: cents(amount), description, merchantName, urlOk: `${back}?pago=ok`, urlKo: `${back}?pago=cancelado`, notificationUrl: `${base}/api/public/payments/redsys/${booking.companyId}` });
  return { kind: "form", url: form.url, fields: form.fields };
}

/**
 * Fianza cobrada: la reserva queda confirmada (o pendiente si el restaurante revisa las reservas). Si
 * llegó tarde y la reserva ya se había liberado, se devuelve sola. Devuelve si hay que avisar.
 */
export async function markDepositPaid(companyId: string, reference: string, paymentId: string | null) {
  const [booking] = await db.select().from(posBooking).where(and(eq(posBooking.companyId, companyId), eq(posBooking.depositReference, reference))).limit(1);
  if (!booking || booking.depositStatus === "PAID" || booking.depositStatus === "REFUNDED") return { bookingId: booking?.id ?? null, notify: false };
  const { getBookingSettings } = await import("@/server/pos/bookings");
  const settings = await getBookingSettings(companyId);
  if (booking.status === "AWAITING_PAYMENT") {
    await db.update(posBooking).set({ status: settings.autoConfirm ? "CONFIRMED" : "PENDING", depositStatus: "PAID", depositPaymentId: paymentId, depositPaidAt: new Date(), holdExpiresAt: null, updatedAt: new Date() }).where(and(eq(posBooking.id, booking.id), eq(posBooking.status, "AWAITING_PAYMENT")));
    return { bookingId: booking.id, notify: true };
  }
  // Pagó cuando la reserva ya se había liberado (tiempo agotado o cancelada): se devuelve.
  await db.update(posBooking).set({ depositStatus: "PAID", depositPaymentId: paymentId, depositPaidAt: new Date(), updatedAt: new Date() }).where(eq(posBooking.id, booking.id));
  await refundDeposit(companyId, booking.id).catch(() => undefined);
  return { bookingId: booking.id, notify: false };
}

/** Devuelve la fianza cobrada de una reserva. */
export async function refundDeposit(companyId: string, bookingId: string) {
  const [booking] = await db.select().from(posBooking).where(and(eq(posBooking.id, bookingId), eq(posBooking.companyId, companyId))).limit(1);
  if (!booking || booking.depositStatus !== "PAID" || !booking.depositAmount || !booking.depositReference) return { refunded: false };
  if (booking.depositProvider === "STRIPE") {
    const { secretKey } = await stripeKeys(companyId);
    let paymentIntent = booking.depositPaymentId;
    if (!paymentIntent) paymentIntent = (await retrieveCheckoutSession(secretKey, booking.depositReference)).payment_intent;
    if (!paymentIntent) throw new HttpError(409, "No se encuentra el pago en Stripe.");
    await refundPayment(secretKey, paymentIntent);
  } else {
    const { credentials } = await redsysCredentials(companyId);
    await redsysRefund(credentials, { order: booking.depositReference, amountCents: cents(Number(booking.depositAmount)) });
  }
  await db.update(posBooking).set({ depositStatus: "REFUNDED", updatedAt: new Date() }).where(eq(posBooking.id, booking.id));
  return { refunded: true };
}

/** Al volver de Stripe: si el aviso de la pasarela aún no llegó, se pregunta a Stripe. */
export async function syncStripeDeposit(companyId: string, reference: string) {
  const { secretKey } = await stripeKeys(companyId);
  const session = await retrieveCheckoutSession(secretKey, reference);
  if (session.payment_status === "paid") return markDepositPaid(companyId, reference, session.payment_intent);
  return { bookingId: null, notify: false };
}

/** Aviso de Stripe (webhook firmado con el secreto del restaurante). */
export async function handleStripeWebhook(companyId: string, payload: string, signature: string | null) {
  const { webhookSecret } = await stripeKeys(companyId);
  if (!webhookSecret) throw new HttpError(400, "Webhook de Stripe sin configurar.");
  const event = verifyStripeWebhook(payload, signature, webhookSecret);
  if (!event) throw new HttpError(400, "Firma no válida.");
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return { bookingId: null, notify: false };
  const session = event.data.object as { id?: string; payment_status?: string; payment_intent?: string | null };
  if (!session.id || session.payment_status !== "paid") return { bookingId: null, notify: false };
  return markDepositPaid(companyId, session.id, session.payment_intent ?? null);
}

/** Notificación de Redsys (servidor a servidor, firmada con la clave del comercio). */
export async function handleRedsysNotification(companyId: string, encodedParameters: string, signature: string) {
  const { credentials } = await redsysCredentials(companyId);
  const parameters = verifyRedsysNotification(encodedParameters, signature, credentials.merchantKey);
  if (!parameters) throw new HttpError(400, "Firma no válida.");
  const order = parameters.Ds_Order ?? parameters.DS_ORDER;
  if (!isRedsysAuthorized(parameters)) return { bookingId: null, notify: false, order };
  return { ...(await markDepositPaid(companyId, order, parameters.Ds_AuthorisationCode ?? null)), order };
}

/** Libera las mesas de quien no pagó la fianza a tiempo (worker, cada minuto). */
export async function expireDepositHolds(now = new Date()) {
  const expired = await db
    .update(posBooking)
    .set({ status: "CANCELLED", cancelledAt: now, cancelReason: "No se pagó la fianza a tiempo", depositStatus: "NONE", updatedAt: now })
    .where(and(eq(posBooking.status, "AWAITING_PAYMENT"), lt(posBooking.holdExpiresAt, now)))
    .returning({ id: posBooking.id });
  return { expired: expired.length };
}
