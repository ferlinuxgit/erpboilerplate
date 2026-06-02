import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { companySettings } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";

const payloadSchema = z.object({
  logoUrl: z.string().trim().optional().or(z.literal("")),
  paymentTermsDays: z.number().int().min(0).max(365),
  fiscalRegime: z.enum(["general", "recargo_equivalencia", "cash_accounting", "exempt"]).default("general"),
  taxPeriodicity: z.enum(["monthly", "quarterly"]).default("quarterly"),
  siiEnabled: z.boolean().default(false),
  verifactuMode: z.enum(["pending", "verifactu", "non_verifactu"]).default("pending"),
  prorrataPct: z.number().min(0).max(100).default(100),
  defaultCustomerAccountCode: z.string().trim().min(1),
  defaultSupplierAccountCode: z.string().trim().min(1),
  defaultSalesAccountCode: z.string().trim().min(1),
  defaultPurchaseAccountCode: z.string().trim().min(1),
  defaultBankAccountCode: z.string().trim().min(1),
});

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "settings.manage")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const [settings] = await db
    .select()
    .from(companySettings)
    .where(eq(companySettings.companyId, ctx.company.id))
    .limit(1);

  return NextResponse.json(settings ?? null);
}

export async function PUT(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "settings.manage")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });

  const [existing] = await db
    .select({ id: companySettings.id })
    .from(companySettings)
    .where(eq(companySettings.companyId, ctx.company.id))
    .limit(1);
  const settingsValues = {
    ...parsed.data,
    prorrataPct: parsed.data.prorrataPct.toFixed(3),
    logoUrl: parsed.data.logoUrl || null,
  };

  if (existing) {
    const [updated] = await db
      .update(companySettings)
      .set({
        ...settingsValues,
        updatedAt: new Date(),
      })
      .where(and(eq(companySettings.id, existing.id), eq(companySettings.companyId, ctx.company.id)))
      .returning();
    return NextResponse.json(updated);
  }

  const [created] = await db
    .insert(companySettings)
    .values({
      companyId: ctx.company.id,
      ...settingsValues,
    })
    .returning();
  return NextResponse.json(created, { status: 201 });
}
