import { NextResponse } from "next/server";

import { isHttpError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { requirePermission } from "@/lib/rbac-server";
import { completeBankConnection } from "@/server/bank-connections/service";

/**
 * Vuelta desde la web del banco tras dar (o denegar) el permiso PSD2. GoCardless añade
 * `?ref=<referencia>`; se completan las cuentas y se vuelve a la pantalla de conexiones.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = new URL("/treasury/bank-connections", url.origin);
  const reference = url.searchParams.get("ref")?.trim();
  if (!reference) {
    back.searchParams.set("result", "missing");
    return NextResponse.redirect(back);
  }
  try {
    const { ctx, user } = await requirePermission("treasury.write");
    const result = await completeBankConnection({ companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: user.id }, reference);
    back.searchParams.set("result", result.status === "LINKED" ? "linked" : "not-linked");
    if (result.status === "LINKED") back.searchParams.set("accounts", String(result.accounts));
  } catch (error) {
    if (isHttpError(error) && error.status === 401) return NextResponse.redirect(new URL("/auth/login", url.origin));
    if (!isHttpError(error)) logger.error({ err: error, scope: "bank_connections.callback" }, "route.unexpected_error");
    back.searchParams.set("result", "error");
  }
  return NextResponse.redirect(back);
}
