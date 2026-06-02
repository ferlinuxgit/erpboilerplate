import { NextResponse } from "next/server";

export async function readJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function invalidJsonResponse(message = "El cuerpo de la petición debe ser JSON válido.") {
  return NextResponse.json({ message }, { status: 400 });
}
