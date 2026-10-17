import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { createRegister, listRegisters } from "@/server/pos/service";

import { posActor } from "../actor";
import { firstIssue, registerSchema } from "../schemas";

export async function GET() {
  try {
    const { ctx } = await posActor("pos.read");
    return NextResponse.json(await listRegisters(ctx.company.id));
  } catch (error) {
    return handleRouteError(error, "pos.registers.list");
  }
}

export async function POST(request: Request) {
  try {
    const { actor } = await posActor("pos.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = registerSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    return NextResponse.json(await createRegister(actor, parsed.data), { status: 201 });
  } catch (error) {
    return handleRouteError(error, "pos.registers.create");
  }
}
