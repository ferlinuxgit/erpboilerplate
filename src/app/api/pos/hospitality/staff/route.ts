import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { listStaff } from "@/server/pos/hospitality";

import { posActor } from "../../actor";

/** Equipo y quién tiene PIN de camarero. */
export async function GET() {
  try {
    const { ctx } = await posActor("pos.sell");
    return NextResponse.json(await listStaff(ctx.company.id, ctx.tenant.id));
  } catch (error) {
    return handleRouteError(error, "pos.staff.list");
  }
}
