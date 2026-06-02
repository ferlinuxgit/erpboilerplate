import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserSession } from "@/lib/current-user";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { applyEsSeeds } from "@/server/seeds/apply";

const payloadSchema = z.object({
  legalName: z.string().trim().optional().or(z.literal("")),
  vatNumber: z.string().trim().optional().or(z.literal("")),
});

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });

  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "settings.manage")) {
    return NextResponse.json({ message: "Sin permisos para completar el onboarding." }, { status: 403 });
  }

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  await applyEsSeeds({
    tenantId: ctx.tenant.id,
    companyId: ctx.company.id,
    actorUserId: session.user.id,
    legalName: parsed.data.legalName || undefined,
    vatNumber: parsed.data.vatNumber || undefined,
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
