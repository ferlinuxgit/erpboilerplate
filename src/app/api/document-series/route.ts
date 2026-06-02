import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { documentSeries } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { defaultSeriesFormat } from "@/lib/document-series-format";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";

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
});

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "series.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const rows = await db.select().from(documentSeries).where(eq(documentSeries.companyId, ctx.company.id));
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "series.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });

  const [existing] = await db
    .select({ id: documentSeries.id })
    .from(documentSeries)
    .where(and(eq(documentSeries.companyId, ctx.company.id), eq(documentSeries.fiscalYearId, ctx.fiscalYear.id), eq(documentSeries.type, parsed.data.type)))
    .limit(1);
  if (existing) return NextResponse.json({ message: "Ya existe una serie para este tipo y ejercicio." }, { status: 409 });

  const [created] = await db
    .insert(documentSeries)
    .values({
      companyId: ctx.company.id,
      fiscalYearId: ctx.fiscalYear.id,
      type: parsed.data.type,
      prefix: parsed.data.prefix,
      format: parsed.data.format ?? defaultSeriesFormat,
      nextNumber: parsed.data.nextNumber ?? 1,
    })
    .returning();
  return NextResponse.json(created, { status: 201 });
}

export async function PATCH(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "series.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const [updated] = await db
    .update(documentSeries)
    .set({
      prefix: parsed.data.prefix,
      format: parsed.data.format ?? defaultSeriesFormat,
      ...(parsed.data.nextNumber ? { nextNumber: parsed.data.nextNumber } : {}),
    })
    .where(and(eq(documentSeries.companyId, ctx.company.id), eq(documentSeries.fiscalYearId, ctx.fiscalYear.id), eq(documentSeries.type, parsed.data.type)))
    .returning();

  if (!updated) {
    const [created] = await db
      .insert(documentSeries)
      .values({
        companyId: ctx.company.id,
        fiscalYearId: ctx.fiscalYear.id,
        type: parsed.data.type,
        prefix: parsed.data.prefix,
        format: parsed.data.format ?? defaultSeriesFormat,
        nextNumber: parsed.data.nextNumber ?? 1,
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  }

  return NextResponse.json(updated);
}
