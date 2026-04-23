import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { itemCategory } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
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

  const rows = await db
    .select()
    .from(itemCategory)
    .where(eq(itemCategory.companyId, ctx.company.id));
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "stock.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const parsed = payloadSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });

  const [created] = await db
    .insert(itemCategory)
    .values({
      companyId: ctx.company.id,
      code: parsed.data.code,
      name: parsed.data.name,
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}
