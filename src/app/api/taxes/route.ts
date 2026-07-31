import { and, asc, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { tax } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { operationForTaxKind, taxMutationSchema } from "@/server/taxes/schema";

function taxWriteError(error: unknown) {
  const databaseError = error as { code?: string };
  if (databaseError?.code === "23505") return "Ya existe un impuesto con ese nombre.";
  return "No se pudo guardar el impuesto.";
}

export async function GET(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const requestedInactive = new URL(request.url).searchParams.get("includeInactive") === "true";
  const includeInactive = requestedInactive && can(ctx.membership.role, "settings.manage");
  const where = includeInactive
    ? eq(tax.companyId, ctx.company.id)
    : and(eq(tax.companyId, ctx.company.id), eq(tax.isActive, true));

  return NextResponse.json(
    await db.select().from(tax).where(where).orderBy(desc(tax.isActive), asc(tax.operation), asc(tax.rate), asc(tax.name)),
  );
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "settings.manage")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();
  const parsed = taxMutationSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Los datos no son válidos." }, { status: 400 });
  }

  const values = parsed.data;
  try {
    const [created] = await db.insert(tax).values({
      companyId: ctx.company.id,
      name: values.name,
      rate: values.rate.toFixed(3),
      kind: values.kind,
      operation: operationForTaxKind(values.kind, values.operation),
      isDefault: values.isDefault,
      isActive: values.isActive,
    }).returning();
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json({ message: taxWriteError(error) }, { status: 409 });
  }
}
