import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody } from "@/lib/http";
import { logger } from "@/lib/logger";
import { resetPassword } from "@/server/auth/password-reset";

const payloadSchema = z.object({
  token: z.string().trim().min(20).max(1024),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres.").max(256),
});

export async function POST(request: Request) {
  const parsed = payloadSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    const passwordIssue = parsed.error.issues.find((issue) => issue.path[0] === "password");
    return NextResponse.json({ error: passwordIssue?.message ?? "El enlace no es válido." }, { status: 400 });
  }

  const result = await resetPassword(parsed.data.token, parsed.data.password);
  if (result.status !== "ok") {
    return NextResponse.json({ error: "El enlace ha caducado o ya se ha usado. Pide uno nuevo desde «¿Olvidaste tu contraseña?»." }, { status: 400 });
  }
  logger.info({ userId: result.userId }, "auth.password_reset_completed");
  return NextResponse.json({ ok: true, message: "Contraseña actualizada. Inicia sesión con la nueva contraseña." });
}
