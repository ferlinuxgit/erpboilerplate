import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { account, user } from "@/db/schema";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/http";
import { logger } from "@/lib/logger";
import { getRateLimiter, RATE_LIMIT_RULES, tooManyRequestsResponse } from "@/lib/rate-limit";
import { createVerificationToken, deliverVerificationEmail, replaceVerificationToken } from "@/server/auth/email-verification";
import { isEmailDeliveryConfigured } from "@/server/email/send";

const payloadSchema = z.object({ email: z.string().trim().email(), next: z.unknown().optional() });

const GENERIC_RESPONSE = {
  ok: true,
  message: "Si la cuenta está pendiente de verificar, te hemos enviado un enlace nuevo. Revisa también la carpeta de spam.",
};

export async function POST(request: Request) {
  const parsed = payloadSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Indica un email válido." }, { status: 400 });
  if (!isEmailDeliveryConfigured() && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "El correo no está configurado. Contacta con el administrador." }, { status: 503 });
  }

  const email = parsed.data.email.toLowerCase();
  const emailLimit = await getRateLimiter().limit(RATE_LIMIT_RULES.resendVerificationEmail, email);
  if (!emailLimit.success) return tooManyRequestsResponse(emailLimit);

  try {
    const [pending] = await db
      .select({ id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified })
      .from(user)
      .innerJoin(account, and(eq(account.userId, user.id), eq(account.providerId, "credential")))
      .where(eq(user.email, email))
      .limit(1);
    if (pending && !pending.emailVerified) {
      const token = createVerificationToken();
      await db.transaction((tx) => replaceVerificationToken(tx, pending.id, token));
      await deliverVerificationEmail({ email: pending.email, name: pending.name, token, request, next: parsed.data.next });
    }
  } catch (error) {
    logger.error({ err: error }, "auth.verification_resend_failed");
  }
  return NextResponse.json(GENERIC_RESPONSE);
}
