import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { cancelWaitlistByToken } from "@/server/pos/waitlist";

/** Salir de la lista de espera desde el enlace del email. */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    return NextResponse.json(await cancelWaitlistByToken((await params).token));
  } catch (error) {
    return handleRouteError(error, "public.waitlist.cancel");
  }
}
