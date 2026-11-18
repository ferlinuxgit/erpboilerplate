import { NextResponse } from "next/server";

import { bearerToken } from "@/lib/api-auth-header";
import { verifyAuthToken } from "@/lib/auth";
import { getUserSession } from "@/lib/current-user";
import { getClientIp } from "@/lib/ip-policy";
import { logger } from "@/lib/logger";
import { publicOrigin } from "@/server/oauth/core";
import { corsHeaders, corsJson, corsPreflight, unauthorizedForMcp } from "@/server/oauth/http";
import { handleMcpMessage } from "@/server/mcp/protocol";
import { httpErrorResponse } from "@/lib/http";

/** Origen para las llamadas internas a la API (mismo proceso; MCP_INTERNAL_ORIGIN si hace falta). */
function internalOrigin() {
  return process.env.MCP_INTERNAL_ORIGIN?.trim() || `http://127.0.0.1:${process.env.PORT ?? 3000}`;
}

/**
 * Servidor MCP (Streamable HTTP, sin estado) para Claude, ChatGPT y cualquier cliente MCP.
 * Autenticación: Bearer de una conexión OAuth o de un token personal (Ajustes › Conectar con IA).
 * Sin token responde 401 con el puntero a los metadatos OAuth, y el cliente conecta solo.
 */
export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const token = bearerToken(authorization);
    const verified = token && !token.startsWith("ak_") ? verifyAuthToken(token) : null;
    // La sesión persistida decide (revocada, caducada, política de IPs o de caducidad).
    const session = verified ? await getUserSession() : null;
    if (!verified || !session?.user) return unauthorizedForMcp(request);

    const payload = await request.json().catch(() => undefined);
    if (payload === undefined) return corsJson({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON no válido." } }, { status: 400 });

    const context = {
      authorization,
      clientIp: getClientIp(request.headers),
      internalOrigin: internalOrigin(),
      publicOrigin: publicOrigin(request),
      scope: verified.grant?.scope ?? "write",
    } as const;

    try {
      if (Array.isArray(payload)) {
        const responses = (await Promise.all(payload.map((message) => handleMcpMessage(message, context)))).filter(Boolean);
        return responses.length ? corsJson(responses) : new NextResponse(null, { status: 202, headers: corsHeaders });
      }
      const response = await handleMcpMessage(payload, context);
      return response ? corsJson(response) : new NextResponse(null, { status: 202, headers: corsHeaders });
    } catch (error) {
      logger.error({ err: error }, "mcp.request");
      return corsJson({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Error interno del servidor MCP." } }, { status: 500 });
    }
  } catch (error) {
    return httpErrorResponse(error);
  }
}

/** Sin flujo SSE del servidor: este MCP solo responde a peticiones. */
export function GET() {
  try {
    return new NextResponse(null, { status: 405, headers: { ...corsHeaders, Allow: "POST, OPTIONS" } });
  } catch (error) {
    return httpErrorResponse(error);
  }
}

export function DELETE() {
  try {
    return new NextResponse(null, { status: 405, headers: { ...corsHeaders, Allow: "POST, OPTIONS" } });
  } catch (error) {
    return httpErrorResponse(error);
  }
}

export function OPTIONS() {
  return corsPreflight();
}
