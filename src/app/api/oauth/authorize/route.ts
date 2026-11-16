import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserSession } from "@/lib/current-user";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { recordAudit } from "@/server/audit";
import { issueAuthorizationCode, OAuthError, validateAuthorizationRequest } from "@/server/oauth/core";

const payloadSchema = z.object({
  params: z.string().max(8000),
  decision: z.enum(["allow", "deny"]),
  tenantId: z.string().optional(),
  companyId: z.string().optional(),
  scope: z.enum(["read", "write"]),
});

/** Decisión del consentimiento (sesión del navegador + CSRF): devuelve la URL de retorno con el código. */
export async function POST(request: Request) {
  try {
    const session = await getUserSession();
    if (!session?.user) return NextResponse.json({ message: "Inicia sesión para continuar." }, { status: 401 });
    const raw = await readJsonBody(request);
    if (!raw) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ message: "Solicitud no válida." }, { status: 400 });

    const { request: authorization, client } = validateAuthorizationRequest(new URLSearchParams(parsed.data.params));
    const target = new URL(authorization.redirectUri);
    if (authorization.state) target.searchParams.set("state", authorization.state);
    if (parsed.data.decision === "deny") {
      target.searchParams.set("error", "access_denied");
      return NextResponse.json({ redirectTo: target.toString() });
    }
    if (!parsed.data.tenantId || !parsed.data.companyId) return NextResponse.json({ message: "Elige una empresa." }, { status: 400 });

    const code = await issueAuthorizationCode({
      ...authorization,
      scope: parsed.data.scope,
      user: session.user,
      tenantId: parsed.data.tenantId,
      companyId: parsed.data.companyId,
    });
    target.searchParams.set("code", code);
    await recordAudit({
      tenantId: parsed.data.tenantId,
      companyId: parsed.data.companyId,
      actorUserId: session.user.id,
      action: "oauth.authorize",
      entityName: "oauthClient",
      entityId: client.name,
      payload: { client: client.name, scope: parsed.data.scope, redirectHost: target.host },
    });
    return NextResponse.json({ redirectTo: target.toString() });
  } catch (error) {
    if (error instanceof OAuthError) return NextResponse.json({ message: error.message }, { status: error.status });
    return handleRouteError(error, "oauth.authorize", "No se pudo completar la conexión.");
  }
}
