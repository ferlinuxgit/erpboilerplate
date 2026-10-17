import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { deleteRecipe, saveRecipe } from "@/server/pos/recipes";

import { posActor } from "../../actor";

const recipeSchema = z.object({
  lines: z.array(z.object({ ingredientItemId: z.string().trim().min(1), quantity: z.number().positive("Las cantidades deben ser mayores que cero.").max(100_000) })).min(1, "Añade al menos un ingrediente.").max(80),
});

type Params = { params: Promise<{ itemId: string }> };

/** Escandallo de un plato: ingredientes y cantidad por ración. */
export async function PUT(request: Request, { params }: Params) {
  try {
    const { actor } = await posActor("pos.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = recipeSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Datos inválidos.");
    return NextResponse.json(await saveRecipe(actor, (await params).itemId, parsed.data.lines));
  } catch (error) {
    return handleRouteError(error, "pos.recipes.save");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { actor } = await posActor("pos.manage");
    await deleteRecipe(actor, (await params).itemId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleRouteError(error, "pos.recipes.delete");
  }
}
