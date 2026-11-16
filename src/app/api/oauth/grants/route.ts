import { inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { company } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { ForbiddenError, handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { getRequestGrant } from "@/lib/request-grant";
import { recordAudit } from "@/server/audit";
import { issuePersonalToken, listUserGrants, PERSONAL_TOKEN_SECONDS, revokeGrant } from "@/server/oauth/core";

/** Solo desde el navegador: una conexión de IA no puede ver, crear ni revocar conexiones. */
async function requireBrowserContext() {
  if (await getRequestGrant()) throw new ForbiddenError("Gestiona las conexiones desde el navegador, en Configuración › Conectar con IA.");
  return requireContext();
}

/** Conexiones activas del usuario (Claude, ChatGPT, tokens personales). */
export async function GET() {
  try {
    const ctx = await requireBrowserContext();
    const grants = await listUserGrants(ctx.user.id);
    const companies = grants.length
      ? await db.select({ id: company.id, name: company.name }).from(company).where(inArray(company.id, [...new Set(grants.map((grant) => grant.companyId))]))
      : [];
    const names = new Map(companies.map((entry) => [entry.id, entry.name]));
    return NextResponse.json(grants.map((grant) => ({ ...grant, companyName: names.get(grant.companyId) ?? null })));
  } catch (error) {
    return handleRouteError(error, "oauth.grants.list");
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  scope: z.enum(["read", "write"]),
});

/** Token personal (90 días) para clientes MCP sin OAuth: Claude Code, Cursor, scripts… */
export async function POST(request: Request) {
  try {
    const ctx = await requireBrowserContext();
    const raw = await readJsonBody(request);
    if (!raw) return invalidJsonResponse();
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ message: "Indica un nombre y el nivel de acceso." }, { status: 400 });
    const { token, grant } = await issuePersonalToken({ user: ctx.user, tenantId: ctx.tenant.id, companyId: ctx.company.id, scope: parsed.data.scope, name: parsed.data.name });
    await recordAudit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id, action: "oauth.personalToken.create", entityName: "oauthGrant", entityId: grant.id, payload: { name: grant.clientName, scope: grant.scope } });
    return NextResponse.json({ token, expiresInDays: PERSONAL_TOKEN_SECONDS / 86_400, grantId: grant.id }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "oauth.grants.create");
  }
}

/** Desconectar una aplicación: borra todas las sesiones de su autorización (y su refresco deja de valer). */
export async function DELETE(request: Request) {
  try {
    const ctx = await requireBrowserContext();
    const grantId = new URL(request.url).searchParams.get("id") ?? "";
    const revoked = await revokeGrant(ctx.user.id, grantId);
    if (revoked === 0) return NextResponse.json({ message: "Conexión no encontrada." }, { status: 404 });
    await recordAudit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id, action: "oauth.grant.revoke", entityName: "oauthGrant", entityId: grantId });
    return NextResponse.json({ revoked });
  } catch (error) {
    return handleRouteError(error, "oauth.grants.revoke");
  }
}
