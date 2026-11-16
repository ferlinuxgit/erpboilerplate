import { and, eq, like } from "drizzle-orm";

import { session } from "@/db/schema";
import { verifyAuthToken, verifySignedPayload } from "@/lib/auth";
import { db } from "@/lib/db";
import { GRANT_SESSION_PREFIX } from "@/server/oauth/core";
import { corsJson, corsPreflight, readOAuthParams } from "@/server/oauth/http";

/** RFC 7009: revocar un token de acceso o de refresco revoca toda la conexión. Siempre 200. */
export async function POST(request: Request) {
  const params = await readOAuthParams(request);
  const token = params.get("token");
  const access = verifyAuthToken(token);
  const refresh = verifySignedPayload<{ g?: string; u?: { id?: string } }>("oauth-refresh", token);
  const grantId = access?.grant?.id ?? refresh?.g;
  const userId = access?.user.id ?? refresh?.u?.id;
  if (grantId && userId) {
    await db.delete(session).where(and(eq(session.userId, userId), like(session.userAgent, `${GRANT_SESSION_PREFIX}${grantId}:%`)));
  }
  return corsJson({});
}

export function OPTIONS() {
  return corsPreflight();
}
