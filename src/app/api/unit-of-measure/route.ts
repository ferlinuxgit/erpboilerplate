import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { unitOfMeasure } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";

const payloadSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
});

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "stock.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  return NextResponse.json(await db.select().from(unitOfMeasure).where(eq(unitOfMeasure.companyId, ctx.company.id)));
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "stock.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });

  const [created] = await db
    .insert(unitOfMeasure)
    .values({
      companyId: ctx.company.id,
      code: parsed.data.code,
      name: parsed.data.name,
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}
