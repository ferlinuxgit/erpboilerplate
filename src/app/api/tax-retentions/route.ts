import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { taxRetention } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";

const payloadSchema = z.object({
  name: z.string().trim().min(1),
  rate: z.number().positive(),
});

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "settings.manage")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  return NextResponse.json(await db.select().from(taxRetention).where(eq(taxRetention.companyId, ctx.company.id)));
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "settings.manage")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });

  const [created] = await db
    .insert(taxRetention)
    .values({ companyId: ctx.company.id, name: parsed.data.name, rate: parsed.data.rate.toFixed(3) })
    .returning();
  return NextResponse.json(created, { status: 201 });
}
