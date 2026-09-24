import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { companySettings } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { recordAudit } from "@/server/audit";

const payloadSchema = z.object({
  logoUrl: z.string().trim().optional().or(z.literal("")),
  paymentTermsDays: z.number().int().min(0).max(365),
  fiscalRegime: z.enum(["general", "recargo_equivalencia", "cash_accounting", "exempt"]).default("general"),
  taxPeriodicity: z.enum(["monthly", "quarterly"]).default("quarterly"),
  siiEnabled: z.boolean().default(false),
  // Se acepta por compatibilidad pero se ignora: el modo VERI*FACTU se cambia en /api/verifactu/settings
  // (exige NIF válido, deja evento en el registro y no se puede desactivar una vez activo).
  verifactuMode: z.enum(["pending", "verifactu", "non_verifactu"]).optional(),
  // Sociedad (IS) o autónomo (IRPF, modelo 130). Si no se envía, no se modifica.
  taxpayerType: z.enum(["company", "individual"]).optional(),
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { verifactuMode: _ignoredVerifactuMode, taxpayerType, ...settingsData } = parsed.data;
  const settingsValues = {
    ...settingsData,
    ...(taxpayerType ? { taxpayerType } : {}),
    prorrataPct: parsed.data.prorrataPct.toFixed(3),
    logoUrl: parsed.data.logoUrl || null,
  };

  try {
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: companySettings.id })
        .from(companySettings)
        .where(eq(companySettings.companyId, ctx.company.id))
        .limit(1);

      if (existing) {
        const [updated] = await tx
          .update(companySettings)
          .set({
            ...settingsValues,
            updatedAt: new Date(),
          })
          .where(and(eq(companySettings.id, existing.id), eq(companySettings.companyId, ctx.company.id)))
          .returning();
        await recordAudit(
          {
            tenantId: ctx.tenant.id,
            companyId: ctx.company.id,
            actorUserId: session.user.id,
            action: "companySettings.update",
            entityName: "companySettings",
            entityId: updated.id,
            payload: settingsValues,
          },
          tx,
        );
        return { row: updated, created: false };
      }

      const [created] = await tx
        .insert(companySettings)
        .values({
          companyId: ctx.company.id,
          ...settingsValues,
        })
        .returning();
      await recordAudit(
        {
          tenantId: ctx.tenant.id,
          companyId: ctx.company.id,
          actorUserId: session.user.id,
          action: "companySettings.create",
          entityName: "companySettings",
          entityId: created.id,
          payload: settingsValues,
        },
        tx,
      );
      return { row: created, created: true };
    });

    return NextResponse.json(result.row, { status: result.created ? 201 : 200 });
  } catch (error) {
    return handleRouteError(error, "companySettings.update", "No se pudo guardar la configuración de la empresa.");
  }
}
