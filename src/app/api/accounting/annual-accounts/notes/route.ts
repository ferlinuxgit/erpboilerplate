import { NextResponse } from "next/server";
import { z } from "zod";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { assertSpanishAnnualAccounts } from "@/server/accounting/annual-accounts/availability";
import { saveAnnualAccountsNotes } from "@/server/accounting/annual-accounts/service";

const amount = z.string().trim().max(20).regex(/^(-?\d+([.,]\d{1,2})?)?$/, "Importe no válido");

const payloadSchema = z.object({
  fiscalYearId: z.string().trim().min(1),
  /** Texto por apartado; vacío = volver al texto de partida. */
  sections: z.record(z.string().max(20), z.string().max(20_000)).optional(),
  averageEmployees: z.number().min(0).max(100_000).nullable().optional(),
  taxData: z.object({ permanentDifferences: amount, temporaryDifferences: amount, lossCarryforward: amount }).partial().optional(),
});

/** Guarda la memoria de un ejercicio: textos de los apartados, plantilla media y datos fiscales. */
export async function PUT(request: Request) {
  try {
    const ctx = await requireContext("accounting.write");
    assertSpanishAnnualAccounts(ctx.company.countryCode);
    const body = await readJsonBody(request);
    if (!body) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(body);
    if (!parsed.success) return jsonError(400, "Revisa los datos de la memoria: hay un importe o un texto no válido.");
    const taxData = parsed.data.taxData
      ? Object.fromEntries(Object.entries(parsed.data.taxData).filter((item): item is [string, string] => typeof item[1] === "string").map(([key, value]) => [key, value.replace(",", ".")]))
      : undefined;
    await saveAnnualAccountsNotes({
      companyId: ctx.company.id,
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      fiscalYearId: parsed.data.fiscalYearId,
      sections: parsed.data.sections,
      averageEmployees: parsed.data.averageEmployees,
      taxData,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "accounting.annual-accounts.notes", "No se pudo guardar la memoria.");
  }
}
