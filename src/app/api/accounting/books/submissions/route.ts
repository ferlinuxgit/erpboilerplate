import { NextResponse } from "next/server";
import { z } from "zod";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { assertSpanishAnnualAccounts } from "@/server/accounting/annual-accounts/availability";
import { registerBooksSubmission, unregisterBooksSubmission } from "@/server/accounting/books/service";

const registerSchema = z.object({
  submissionId: z.string().trim().min(1),
  submittedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  registryName: z.string().trim().max(120).nullish(),
  submissionReference: z.string().trim().max(120).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

/** Anota la presentación de un juego de libros en el Registro Mercantil (fecha y número de entrada). */
export async function POST(request: Request) {
  try {
    const ctx = await requireContext("accounting.write");
    assertSpanishAnnualAccounts(ctx.company.countryCode);
    const body = await readJsonBody(request);
    if (!body) return invalidJsonResponse();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) return jsonError(400, "Indica la fecha de presentación (AAAA-MM-DD) y el juego de libros presentado.");
    if (parsed.data.submittedAt > new Date().toISOString().slice(0, 10)) return jsonError(400, "La fecha de presentación no puede ser futura.");
    const result = await registerBooksSubmission({ companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: ctx.user.id, ...parsed.data });
    return NextResponse.json({ ok: true, id: result.id });
  } catch (error) {
    return handleRouteError(error, "accounting.books.submit", "No se pudo anotar la presentación de los libros.");
  }
}

/** Deshace la anotación de una presentación registrada por error: `?id=<presentación>`. */
export async function DELETE(request: Request) {
  try {
    const ctx = await requireContext("accounting.write");
    assertSpanishAnnualAccounts(ctx.company.countryCode);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return jsonError(400, "Falta la presentación que quieres deshacer.");
    await unregisterBooksSubmission({ companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: ctx.user.id, submissionId: id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "accounting.books.unsubmit", "No se pudo deshacer la anotación.");
  }
}
