import { NextResponse } from "next/server";

import { getMenuImage } from "@/server/pos/menu";

/** Foto de un plato. La URL lleva la versión (?v=), así que se puede cachear mucho tiempo. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const image = await getMenuImage((await params).id);
  if (!image) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(image.body), { headers: { "Content-Type": image.contentType, "Cache-Control": "public, max-age=31536000, immutable" } });
}
