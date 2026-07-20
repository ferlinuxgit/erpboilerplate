import { NextResponse } from "next/server";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await params;
  return NextResponse.json(
    { message: "Los documentos financieros no se eliminan. Anula el gasto para conservar su trazabilidad fiscal y contable." },
    { status: 409 },
  );
}
