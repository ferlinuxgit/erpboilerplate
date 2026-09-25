import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { cancelRemittance, confirmRemittance, getRemittance, undoRemittanceConfirmation } from "@/server/sepa/service";

/** Detalle de la remesa; con `?download=xml` devuelve el fichero para subirlo a la banca online. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx } = await requirePermission("treasury.read");
    const { id } = await params;
    const remittance = await getRemittance(ctx.company.id, id);
    if (!remittance) return NextResponse.json({ message: "Remesa no encontrada." }, { status: 404 });
    if (new URL(request.url).searchParams.get("download") === "xml") {
      return new NextResponse(remittance.xml, {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Content-Disposition": `attachment; filename="remesa-${remittance.number}.xml"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return NextResponse.json(remittance);
  } catch (error) {
    return handleRouteError(error, "sepa.remittances.get");
  }
}

const actionSchema = z.object({ action: z.enum(["confirm", "unconfirm", "cancel"]) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("treasury.write", "Tu rol no permite gestionar remesas.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = actionSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: "Acción no válida." }, { status: 400 });
    const { id } = await params;
    const actor = { companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: user.id, activeFiscalYearId: ctx.fiscalYear.id };
    if (parsed.data.action === "confirm") return NextResponse.json(await confirmRemittance(actor, id));
    if (parsed.data.action === "unconfirm") return NextResponse.json(await undoRemittanceConfirmation(actor, id));
    return NextResponse.json(await cancelRemittance(actor, id));
  } catch (error) {
    return handleRouteError(error, "sepa.remittances.update", "No se pudo actualizar la remesa.");
  }
}
