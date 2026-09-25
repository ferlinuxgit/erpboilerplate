import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody } from "@/lib/http";
import { logger } from "@/lib/logger";
import { getRateLimiter, RATE_LIMIT_RULES, tooManyRequestsResponse } from "@/lib/rate-limit";
import { PASSWORD_RESET_TTL_MINUTES, requestPasswordReset } from "@/server/auth/password-reset";
import { isEmailDeliveryConfigured, sendEmail } from "@/server/email/send";
import { appBaseUrl, passwordResetEmail } from "@/server/email/templates";

const payloadSchema = z.object({ email: z.string().trim().email() });

/** Misma respuesta exista o no la cuenta: no permite averiguar qué emails están registrados. */
const GENERIC_RESPONSE = {
  ok: true,
  message: "Si hay una cuenta con ese email, recibirás un enlace para elegir una contraseña nueva en unos minutos.",
};

export async function POST(request: Request) {
  const parsed = payloadSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Indica un email válido." }, { status: 400 });
  if (process.env.NODE_ENV === "production" && !isEmailDeliveryConfigured()) {
    return NextResponse.json({ error: "La recuperación de contraseña no está disponible porque el correo no está configurado. Contacta con el administrador." }, { status: 503 });
  }

  const email = parsed.data.email.toLowerCase();
  const emailLimit = await getRateLimiter().limit(RATE_LIMIT_RULES.forgotPasswordEmail, email);
  if (!emailLimit.success) return tooManyRequestsResponse(emailLimit);

  try {
    const reset = await requestPasswordReset(email);
    if (reset) {
      const url = `${appBaseUrl(request)}/auth/reset-password?token=${encodeURIComponent(reset.token)}`;
      await sendEmail({ to: reset.user.email, ...passwordResetEmail({ name: reset.user.name, url, expiresInMinutes: PASSWORD_RESET_TTL_MINUTES }) });
    }
  } catch (error) {
    // No revelamos el fallo al cliente (enumeración); queda registrado para soporte.
    logger.error({ err: error }, "auth.password_reset_request_failed");
  }
  return NextResponse.json(GENERIC_RESPONSE);
}
