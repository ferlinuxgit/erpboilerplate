import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { importCategories } from "@/server/pos/menu";

import { posActor } from "../../actor";

/** Crea las secciones a partir de las categorías de artículos y añade sus artículos a la carta. */
export async function POST() {
  try {
    const { actor } = await posActor("pos.manage");
    return NextResponse.json(await importCategories(actor));
  } catch (error) {
    return handleRouteError(error, "pos.menu.import");
  }
}
