import { NextResponse } from "next/server";
import { z } from "zod";

import { isBankConnectionsEnabled } from "@/lib/bank-connections-config";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { listBankConnections, startBankConnection } from "@/server/bank-connections/service";

const payloadSchema = z.object({ institutionId: z.string().trim().min(1).max(120) });

export async function GET() {
  try {
    const { ctx } = await requirePermission("treasury.read");
    if (!isBankConnectionsEnabled()) return NextResponse.json({ enabled: false, connections: [] });
    return NextResponse.json({ enabled: true, connections: await listBankConnections(ctx.company.id) });
  } catch (error) {
    return handleRouteError(error, "bank_connections.list");
  }
}

/** Inicia una conexión PSD2: devuelve el enlace del banco donde el usuario da su permiso. */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("treasury.write", "Tu rol no permite conectar bancos.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: "Elige tu banco." }, { status: 400 });
    const started = await startBankConnection({ companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: user.id }, { institutionId: parsed.data.institutionId });
    return NextResponse.json(started, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "bank_connections.start", "No se pudo iniciar la conexión con el banco.");
  }
}
