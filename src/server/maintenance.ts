import { lt } from "drizzle-orm";

import { processedStripeEvent, session, verification } from "@/db/schema";
import { db } from "@/lib/db";

/**
 * Limpieza periódica: sesiones caducadas, códigos de verificación vencidos y el registro de
 * eventos de Stripe ya procesados de hace más de 90 días (Stripe no reenvía eventos tan antiguos).
 */
export async function purgeExpiredRows(now = new Date()) {
  const [sessions, verifications, stripeEvents] = await Promise.all([
    db.delete(session).where(lt(session.expiresAt, now)).returning({ id: session.id }),
    db.delete(verification).where(lt(verification.expiresAt, now)).returning({ id: verification.id }),
    db.delete(processedStripeEvent).where(lt(processedStripeEvent.processedAt, new Date(now.getTime() - 90 * 86_400_000))).returning({ id: processedStripeEvent.id }),
  ]);
  return { sessions: sessions.length, verifications: verifications.length, stripeEvents: stripeEvents.length };
}
