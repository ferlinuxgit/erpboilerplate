import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { recordAudit } from "@/server/audit";
import { reconcileBankTransaction } from "@/server/treasury/reconciliation";
import { acceptSafeSuggestions, listManualMatchCandidates, undoReconciliationInTx } from "@/server/treasury/workbench";

const manualSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("match"), transactionId: z.string().min(1), kind: z.enum(["customer", "supplier"]), matchId: z.string().min(1) }),
  z.object({ action: z.literal("unmatch"), transactionId: z.string().min(1) }),
]);

export async function GET(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "treasury.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const transactionId = new URL(request.url).searchParams.get("transactionId");
  if (!transactionId) return NextResponse.json({ message: "Movimiento obligatorio." }, { status: 400 });
  const result = await listManualMatchCandidates(ctx.company.id, transactionId);
  if (!result) return NextResponse.json({ message: "Movimiento no encontrado." }, { status: 404 });
  return NextResponse.json(result);
}

export async function POST() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "treasury.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  try {
    // Solo propuestas seguras (confianza alta y sin rival); el resto se revisa en la mesa de conciliación.
    const safe = await acceptSafeSuggestions({ companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: session.user.id, activeFiscalYearId: ctx.fiscalYear.id });
    const result = { reconciled: safe.applied.length, skipped: safe.skipped.length, applied: safe.applied, failures: safe.skipped };
    await recordAudit({
      tenantId: ctx.tenant.id,
      companyId: ctx.company.id,
      actorUserId: session.user.id,
      action: "treasury.reconcile.auto",
      entityName: "bankTransaction",
      entityId: ctx.company.id,
      payload: result,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "treasury.reconcile.auto", "No se pudo ejecutar la conciliación automática. Inténtalo de nuevo.");
  }
}

export async function PATCH(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "treasury.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();
  const parsed = manualSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });

  const actor = { companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: session.user.id };
  try {
    const result = await db.transaction<unknown>((tx) => parsed.data.action === "unmatch"
      ? undoReconciliationInTx(tx, actor, parsed.data.transactionId)
      : reconcileBankTransaction(tx, { ...actor, transactionId: parsed.data.transactionId, kind: parsed.data.kind, matchId: parsed.data.matchId }));
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "treasury.reconcile.manual", "No se pudo actualizar la conciliación. Inténtalo de nuevo.");
  }
}
