import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { documentSeries } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { SeriesGapError, upsertDocumentSeries } from "@/server/documents/series-admin";

const documentTypes = [
  "SALES_QUOTE",
  "SALES_ORDER",
  "DELIVERY_NOTE",
  "SALES_INVOICE",
  "CREDIT_NOTE",
  "PURCHASE_ORDER",
  "GOODS_RECEIPT",
  "SUPPLIER_INVOICE",
  "SUPPLIER_CREDIT_NOTE",
  "PAYMENT",
  "RECEIPT",
] as const;

const payloadSchema = z.object({
  type: z.enum(documentTypes),
  prefix: z.string().trim().min(1).max(20),
  format: z.string().trim().min(1).max(80).optional(),
  nextNumber: z.number().int().positive().optional(),
  /** Confirmación explícita para saltar números (deja huecos): exige motivo y queda auditado. */
  confirmGap: z.boolean().optional(),
  gapReason: z.string().trim().max(500).optional(),
});

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "series.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const rows = await db.select().from(documentSeries).where(eq(documentSeries.companyId, ctx.company.id));
  return NextResponse.json(rows);
}

async function saveSeries(request: Request, mode: "create" | "upsert") {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "series.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  if (mode === "create") {
    const [existing] = await db
      .select({ id: documentSeries.id })
      .from(documentSeries)
      .where(and(eq(documentSeries.companyId, ctx.company.id), eq(documentSeries.fiscalYearId, ctx.fiscalYear.id), eq(documentSeries.type, parsed.data.type)))
      .limit(1);
    if (existing) return NextResponse.json({ message: "Ya existe una serie para este tipo y ejercicio." }, { status: 409 });
  }

  try {
    const result = await upsertDocumentSeries(
      { tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: session.user.id, fiscalYearId: ctx.fiscalYear.id },
      parsed.data,
    );
    return NextResponse.json(result.series, { status: result.created ? 201 : 200 });
  } catch (error) {
    // Numbering gap: the client asks the user to confirm it with a reason and resends
    // `{ confirmGap: true, gapReason }`.
    if (error instanceof SeriesGapError) {
      return NextResponse.json({ message: error.message, code: error.code, gap: error.gap }, { status: 409 });
    }
    return handleRouteError(error, "document-series.save", "No se pudo guardar la serie de numeración.");
  }
}

export async function POST(request: Request) {
  return saveSeries(request, "create");
}

/** Actualiza (o crea) la serie del ejercicio activo. El número siguiente nunca retrocede; saltar exige confirmación. */
export async function PATCH(request: Request) {
  return saveSeries(request, "upsert");
}
