import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError } from "@/lib/http";
import { exportVerifactuRecords } from "@/server/verifactu/service";

/** Descarga de los registros de facturación (?format=csv | xml). */
export async function GET(request: Request) {
  try {
    const ctx = await requireContext("fiscal.read");
    const format = new URL(request.url).searchParams.get("format") === "xml" ? "xml" : "csv";
    const file = await exportVerifactuRecords(ctx.company.id, format, ctx.user.id);
    return new NextResponse(file.content, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleRouteError(error, "verifactu.export", "No se pudieron exportar los registros.");
  }
}
