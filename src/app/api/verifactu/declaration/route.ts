import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError } from "@/lib/http";
import { assertCountryFeature } from "@/server/fiscal/country-guard";
import { getCurrentDeclaration, getStoredDeclaration } from "@/server/verifactu/declaration";
import { renderDeclarationPdf } from "@/server/verifactu/declaration-pdf";

/**
 * Declaración responsable del productor en PDF: la de la versión desplegada o, con `?id=`, una del
 * histórico. Mientras falten datos del productor no hay PDF (no sería una declaración válida).
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireContext("fiscal.read");
    assertCountryFeature(ctx.company.countryCode, "eInvoicing");
    const id = new URL(request.url).searchParams.get("id")?.trim();
    const declaration = id
      ? await getStoredDeclaration(id).then((stored) => (stored ? { title: stored.title, version: stored.version, rows: stored.rows, issuedAt: stored.createdAt } : null))
      : await getCurrentDeclaration().then((current) => (current.complete ? { title: current.title, version: current.version, rows: current.rows, issuedAt: current.issuedAt } : null));
    if (!declaration) {
      return NextResponse.json({ message: id ? "Declaración no encontrada." : "La declaración responsable está incompleta: faltan datos del productor del sistema." }, { status: id ? 404 : 409 });
    }
    const pdf = await renderDeclarationPdf(declaration);
    const fileName = `declaracion-responsable-${declaration.version.replace(/[^0-9A-Za-z._-]+/g, "-")}.pdf`;
    return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${fileName}"` } });
  } catch (error) {
    return handleRouteError(error, "verifactu.declaration.pdf", "No se pudo generar el PDF de la declaración.");
  }
}
