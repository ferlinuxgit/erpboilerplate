import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { cancelDirectDebitRemittance, getDirectDebitRemittance, markDirectDebitCollected, undoDirectDebitCollection } from "@/server/sepa/direct-debits";

/** Detalle de la remesa de cobros; con `?download=xml` devuelve el fichero para la banca online. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx } = await requirePermission("treasury.read");
    const { id } = await params;
    const remittance = await getDirectDebitRemittance(ctx.company.id, id);
    if (!remittance) return NextResponse.json({ message: "Remesa no encontrada." }, { status: 404 });
    if (new URL(request.url).searchParams.get("download") === "xml") {
      return new NextResponse(remittance.xml, {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Content-Disposition": `attachment; filename="recibos-${remittance.number}.xml"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return NextResponse.json(remittance);
  } catch (error) {
    return handleRouteError(error, "sepa.direct_debits.get");
  }
}

const actionSchema = z.object({ action: z.enum(["collect", "uncollect", "cancel"]) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("treasury.write", "Tu rol no permite gestionar remesas.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = actionSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: "Acción no válida." }, { status: 400 });
    const { id } = await params;
    const actor = { companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: user.id, activeFiscalYearId: ctx.fiscalYear.id };
    if (parsed.data.action === "collect") return NextResponse.json(await markDirectDebitCollected(actor, id));
    if (parsed.data.action === "uncollect") return NextResponse.json(await undoDirectDebitCollection(actor, id));
    return NextResponse.json(await cancelDirectDebitRemittance(actor, id));
  } catch (error) {
    return handleRouteError(error, "sepa.direct_debits.update", "No se pudo actualizar la remesa.");
  }
}
