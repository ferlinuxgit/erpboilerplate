import { headers } from "next/headers";
import { cache } from "react";

import { verifyAuthToken, type AuthGrant } from "@/lib/auth";
import { bearerToken } from "@/lib/api-auth-header";

/**
 * Autorización delegada de la petición actual (conector de Claude / ChatGPT o token personal
 * MCP), leída del `Authorization: Bearer`. null en peticiones del navegador (cookie) o fuera de
 * una petición. La firma se verifica aquí; la sesión persistida la comprueba `getUserSession`.
 */
export const getRequestGrant = cache(async function getRequestGrant(): Promise<AuthGrant | null> {
  try {
    const token = bearerToken((await headers()).get("authorization"));
    if (!token || token.startsWith("ak_")) return null;
    return verifyAuthToken(token)?.grant ?? null;
  } catch {
    return null;
  }
});
