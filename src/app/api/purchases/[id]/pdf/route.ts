import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ message: "PDF de compras pendiente de plantilla avanzada." }, { status: 501 });
}
