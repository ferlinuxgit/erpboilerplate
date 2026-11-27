import { z } from "zod";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { assertSpanishAnnualAccounts } from "@/server/accounting/annual-accounts/availability";
import { generateBooksPackage } from "@/server/accounting/books/service";

const payloadSchema = z.object({ fiscalYearId: z.string().trim().min(1), format: z.enum(["xlsx", "pdf"]).default("xlsx") });

/**
 * Genera el juego de libros para legalizar (Diario, Inventarios y Cuentas Anuales y Mayor) en un ZIP
 * con la relación de huellas SHA-256 y las instrucciones de Legalia 2, y lo deja anotado.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireContext("accounting.write");
    assertSpanishAnnualAccounts(ctx.company.countryCode);
    const body = await readJsonBody(request);
    if (!body) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(body);
    if (!parsed.success) return jsonError(400, "Indica el ejercicio y el formato (xlsx o pdf).");
    const { bytes, fileName } = await generateBooksPackage({ companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: ctx.user.id, fiscalYearId: parsed.data.fiscalYearId, format: parsed.data.format });
    return new Response(new Uint8Array(bytes), { headers: { "Content-Disposition": `attachment; filename="${fileName}"`, "Content-Type": "application/zip", "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, "accounting.books.package", "No se pudieron generar los libros. Inténtalo de nuevo.");
  }
}
