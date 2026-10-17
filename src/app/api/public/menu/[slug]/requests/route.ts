import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { createTableRequest, TABLE_REQUEST_KINDS } from "@/server/pos/table-requests";

const schema = z.object({
  tableId: z.string().trim().min(1).max(64),
  kind: z.enum(TABLE_REQUEST_KINDS),
  items: z.array(z.object({ dishId: z.string().trim().min(1).max(64), quantity: z.number().int().min(1).max(20), note: z.string().trim().max(120).nullable().optional().transform((value) => value || null) })).max(30).default([]),
  note: z.string().trim().max(200).nullable().optional().transform((value) => value || null),
  // Trampa para bots.
  website: z.string().max(0).optional(),
});

/** Desde la mesa (QR): pedir, llamar al camarero o pedir la cuenta. Sin sesión. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Datos inválidos.");
    return NextResponse.json(await createTableRequest((await params).slug, parsed.data), { status: 201 });
  } catch (error) {
    return handleRouteError(error, "public.table_request");
  }
}
