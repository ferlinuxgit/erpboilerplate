import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { ecbExchangeRate } from "@/server/exchange-rates";

/** GET ?from=USD&to=EUR&date=2026-10-04 → cambio de referencia del BCE de ese día. */
export async function GET(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  try {
    return NextResponse.json(await ecbExchangeRate({ from: params.get("from") ?? "", to: params.get("to") ?? "", date: params.get("date") ?? "" }));
  } catch (error) {
    const message = error instanceof Error && !/fetch failed|aborted|timeout/i.test(error.message) ? error.message : "No se pudo consultar el cambio del BCE: indícalo a mano.";
    return NextResponse.json({ message }, { status: 502 });
  }
}
