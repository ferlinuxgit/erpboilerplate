import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError } from "@/lib/http";
import { getVerifactuOverview } from "@/server/verifactu/service";

/** Estado VeriFactu de la empresa activa: modo, envío, contadores, últimos registros y eventos. */
export async function GET() {
  try {
    const ctx = await requireContext("fiscal.read");
    return NextResponse.json(await getVerifactuOverview(ctx.company.id));
  } catch (error) {
    return handleRouteError(error, "verifactu.overview");
  }
}
