import { NextResponse } from "next/server";

import { handleRouteError, jsonError } from "@/lib/http";
import { can } from "@/lib/rbac";
import { exportMonthCsv } from "@/server/timesheets/service";

import { timesheetActor } from "../actor";

/** CSV del mes (?month=AAAA-MM, ?userId=…): la propia jornada o, con permiso, la del equipo. */
export async function GET(request: Request) {
  try {
    const { ctx, userId } = await timesheetActor(null);
    const canSeeTeam = can(ctx.membership.role, "timesheet.read");
    if (!canSeeTeam && !can(ctx.membership.role, "timesheet.own")) return jsonError(403, "No tienes acceso al registro de jornada.");
    const params = new URL(request.url).searchParams;
    const requested = params.get("userId");
    if (!canSeeTeam && requested && requested !== userId) return jsonError(403, "Solo puedes descargar tu propio registro.");
    const month = params.get("month") ?? "";
    const csv = await exportMonthCsv(ctx.company.id, ctx.tenant.id, month, canSeeTeam ? requested : userId);
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="registro-jornada-${month}.csv"`, "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, "timesheets.export");
  }
}
