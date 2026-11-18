import { NextResponse } from "next/server";
import { z } from "zod";

import { ADVISOR_PORTAL_PATH } from "@/lib/advisor-scopes";
import { readJsonBody, httpErrorResponse } from "@/lib/http";
import { logger } from "@/lib/logger";
import { getRateLimiter, RATE_LIMIT_RULES, tooManyRequestsResponse } from "@/lib/rate-limit";
import { normalizeAdvisorEmail } from "@/server/advisor/access-model";
import { ADVISOR_COOKIE, advisorCookieOptions, signInAdvisor } from "@/server/advisor/auth";

const schema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(200) });

/** Acceso al portal del asesor con email y contraseña (credenciales creadas por la empresa). */
export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await readJsonBody(request));
    if (!parsed.success) return NextResponse.json({ message: "Introduce tu email y tu contraseña." }, { status: 400 });

    // 5 intentos fallidos / 15 min por email (el límite por IP lo aplica el proxy).
    const email = normalizeAdvisorEmail(parsed.data.email);
    const limiter = getRateLimiter();
    const emailLimit = await limiter.limit(RATE_LIMIT_RULES.advisorLoginEmail, email);
    if (!emailLimit.success) {
      logger.warn({ bucket: RATE_LIMIT_RULES.advisorLoginEmail.id }, "advisor.login_rate_limited");
      return tooManyRequestsResponse(emailLimit);
    }

    const result = await signInAdvisor({ email, password: parsed.data.password, headers: request.headers });
    if (!result) return NextResponse.json({ message: "Email o contraseña incorrectos, o el acceso ya no está activo." }, { status: 401 });
    await limiter.reset(RATE_LIMIT_RULES.advisorLoginEmail, email);

    const response = NextResponse.json({ redirectTo: ADVISOR_PORTAL_PATH, companies: result.companies });
    response.cookies.set(ADVISOR_COOKIE, result.token, advisorCookieOptions());
    return response;
  } catch (error) {
    return httpErrorResponse(error);
  }
}
