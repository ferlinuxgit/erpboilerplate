import { and, asc, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { documentSeries } from "@/db/schema";
import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { SeriesGapError, createDocumentSeries, updateDocumentSeries, upsertDocumentSeries } from "@/server/documents/series-admin";

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

const prefixSchema = z.string().trim().min(1, "Indica el prefijo (por ejemplo, FA).").max(20, "El prefijo no puede superar 20 caracteres.");
const formatSchema = z.string().trim().min(1, "Indica el formato.").max(80, "El formato no puede superar 80 caracteres.");
const nameSchema = z.string().trim().min(1, "Indica el nombre de la serie (por ejemplo, Tickets).").max(60, "El nombre no puede superar 60 caracteres.");
const gapSchema = {
  /** Confirmación explícita para saltar números (deja huecos): exige motivo y queda auditado. */
  confirmGap: z.boolean().optional(),
  gapReason: z.string().trim().max(500).optional(),
};

/** Serie por defecto del tipo en el ejercicio activo (formato antiguo, sin código). */
const legacyPayloadSchema = z.object({
  type: z.enum(documentTypes),
  prefix: prefixSchema,
  format: formatSchema.optional(),
  nextNumber: z.number().int().positive().optional(),
  ...gapSchema,
});

const createPayloadSchema = z.object({
  type: z.enum(documentTypes),
  code: z.string().trim().min(1, "Indica un código corto (por ejemplo, T).").max(10, "El código no puede superar 10 caracteres."),
  name: nameSchema,
  prefix: prefixSchema,
  format: formatSchema.optional(),
  nextNumber: z.number().int().positive().optional(),
  isDefault: z.boolean().optional(),
  ...gapSchema,
});

const updatePayloadSchema = z.object({
  id: z.string().trim().min(1),
  name: nameSchema.optional(),
  prefix: prefixSchema.optional(),
  format: formatSchema.optional(),
  nextNumber: z.number().int().positive().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  ...gapSchema,
});

function badRequest(error: z.ZodError) {
  return NextResponse.json({ message: error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
}

function seriesErrorResponse(error: unknown) {
  // Numbering gap: the client asks the user to confirm it with a reason and resends
  // `{ confirmGap: true, gapReason }`.
  if (error instanceof SeriesGapError) {
    return NextResponse.json({ message: error.message, code: error.code, gap: error.gap }, { status: 409 });
  }
  return handleRouteError(error, "document-series.save", "No se pudo guardar la serie de numeración.");
}

/**
 * Series de numeración de la empresa. `?fiscalYear=active` devuelve solo las del ejercicio activo
 * (por tipo, la de por defecto primero).
 */
export async function GET(request: Request) {
  try {
    const { ctx } = await requirePermission("series.read");
    const onlyActiveYear = new URL(request.url).searchParams.get("fiscalYear") === "active";
    const rows = await db
      .select()
      .from(documentSeries)
      .where(and(eq(documentSeries.companyId, ctx.company.id), ...(onlyActiveYear ? [eq(documentSeries.fiscalYearId, ctx.fiscalYear.id)] : [])))
      .orderBy(asc(documentSeries.type), desc(documentSeries.isDefault), asc(documentSeries.code));
    return NextResponse.json(rows);
  } catch (error) {
    return handleRouteError(error, "document-series.list", "No se pudieron cargar las series de numeración.");
  }
}

/**
 * Crea una serie en el ejercicio activo. Con `code` crea una serie adicional (tickets, exportación…);
 * sin él (formato antiguo) crea la serie general del tipo si todavía no existe.
 */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("series.write");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const actor = { tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id, fiscalYearId: ctx.fiscalYear.id };

    if (typeof payload === "object" && payload !== null && "code" in payload) {
      const parsed = createPayloadSchema.safeParse(payload);
      if (!parsed.success) return badRequest(parsed.error);
      const created = await createDocumentSeries(actor, parsed.data);
      return NextResponse.json(created, { status: 201 });
    }

    const parsed = legacyPayloadSchema.safeParse(payload);
    if (!parsed.success) return badRequest(parsed.error);
    const [existing] = await db
      .select({ id: documentSeries.id })
      .from(documentSeries)
      .where(and(eq(documentSeries.companyId, ctx.company.id), eq(documentSeries.fiscalYearId, ctx.fiscalYear.id), eq(documentSeries.type, parsed.data.type)))
      .limit(1);
    if (existing) return NextResponse.json({ message: "Ya existe una serie para este tipo y ejercicio. Para añadir otra, indica un código (por ejemplo, T para tickets)." }, { status: 409 });
    const result = await upsertDocumentSeries(actor, parsed.data);
    return NextResponse.json(result.series, { status: 201 });
  } catch (error) {
    return seriesErrorResponse(error);
  }
}

/**
 * Con `id`: edita esa serie (nombre, prefijo, formato, siguiente número, por defecto, activa).
 * Sin `id` (formato antiguo): actualiza o crea la serie por defecto del tipo en el ejercicio activo.
 * El número siguiente nunca retrocede; saltar exige confirmación.
 */
export async function PATCH(request: Request) {
  try {
    const { ctx, user } = await requirePermission("series.write");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const actor = { tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id, fiscalYearId: ctx.fiscalYear.id };

    if (typeof payload === "object" && payload !== null && "id" in payload) {
      const parsed = updatePayloadSchema.safeParse(payload);
      if (!parsed.success) return badRequest(parsed.error);
      const { id, ...input } = parsed.data;
      const saved = await updateDocumentSeries(actor, id, input);
      if (!saved) return NextResponse.json({ message: "Serie no encontrada." }, { status: 404 });
      return NextResponse.json(saved);
    }

    const parsed = legacyPayloadSchema.safeParse(payload);
    if (!parsed.success) return badRequest(parsed.error);
    const result = await upsertDocumentSeries(actor, parsed.data);
    return NextResponse.json(result.series, { status: result.created ? 201 : 200 });
  } catch (error) {
    return seriesErrorResponse(error);
  }
}
