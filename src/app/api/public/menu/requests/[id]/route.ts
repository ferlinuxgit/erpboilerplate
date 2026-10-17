import { NextResponse } from "next/server";

import { jsonError } from "@/lib/http";
import { getTableRequest } from "@/server/pos/table-requests";

/** El cliente consulta en qué queda su pedido (?token=). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const result = await getTableRequest((await params).id, token);
  if (!result) return jsonError(404, "Pedido no encontrado.");
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
