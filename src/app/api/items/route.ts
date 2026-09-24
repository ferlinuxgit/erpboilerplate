import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { item } from "@/db/schema";
import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { recordAudit } from "@/server/audit";

const itemPayloadSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio."),
  sku: z.string().trim().min(1, "El SKU es obligatorio."),
  isService: z.boolean().default(false),
  salePrice: z.coerce.number().nonnegative().default(0),
  costPrice: z.coerce.number().nonnegative().default(0),
  minimumStock: z.coerce.number().nonnegative().default(0),
});

export async function GET() {
  try {
    const { ctx } = await requirePermission("stock.read");
    const rows = await db.select().from(item).where(eq(item.companyId, ctx.company.id));
    return NextResponse.json(rows);
  } catch (error) {
    return handleRouteError(error, "item.list");
  }
}

export async function POST(request: Request) {
  try {
    return await createItem(request);
  } catch (error) {
    const candidate = error as { code?: string; cause?: { code?: string } } | null;
    if (candidate?.code === "23505" || candidate?.cause?.code === "23505") {
      return NextResponse.json({ message: "Ya existe un artículo con ese SKU." }, { status: 409 });
    }
    return handleRouteError(error, "item.create", "No se pudo crear el artículo.");
  }
}

async function createItem(request: Request) {
  const { ctx, user } = await requirePermission("stock.write");
  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();
  const parsed = itemPayloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const created = await db.transaction(async (tx) => {
    const [row] = await tx.insert(item).values({ companyId: ctx.company.id, name: parsed.data.name, sku: parsed.data.sku, isService: parsed.data.isService, salePrice: parsed.data.salePrice.toFixed(2), costPrice: parsed.data.costPrice.toFixed(2), averageCost: parsed.data.costPrice.toFixed(2), minimumStock: parsed.data.minimumStock.toFixed(3) }).returning();
    await recordAudit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id, action: "item.create", entityName: "item", entityId: row.id, payload: parsed.data }, tx);
    return row;
  });
  return NextResponse.json(created, { status: 201 });
}
