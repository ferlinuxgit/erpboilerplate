import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { companySettings } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { defaultPdfDisplaySettings } from "@/lib/pdf-settings";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { recordAudit } from "@/server/audit";
import { pdfSettingsSchema } from "@/server/schemas/pdf-settings";

async function context() {
  const session = await getUserSession();
  if (!session?.user) return { error: NextResponse.json({ message: "No autorizado." }, { status: 401 }) };
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "settings.manage")) return { error: NextResponse.json({ message: "Sin permisos." }, { status: 403 }) };
  return { session, ctx };
}

export async function GET() {
  const auth = await context();
  if ("error" in auth) return auth.error;
  const [settings] = await db.select({
    showLogo: companySettings.pdfShowLogo,
    showEmail: companySettings.pdfShowEmail,
    showPhone: companySettings.pdfShowPhone,
    showWebsite: companySettings.pdfShowWebsite,
    showCustomerNumber: companySettings.pdfShowCustomerNumber,
    showPaymentMethod: companySettings.pdfShowPaymentMethod,
    showTaxBreakdown: companySettings.pdfShowTaxBreakdown,
  }).from(companySettings).where(eq(companySettings.companyId, auth.ctx.company.id)).limit(1);
  return NextResponse.json(settings ?? defaultPdfDisplaySettings);
}

export async function PUT(request: Request) {
  const auth = await context();
  if ("error" in auth) return auth.error;
  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();
  const parsed = pdfSettingsSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const values = {
    pdfShowLogo: parsed.data.showLogo,
    pdfShowEmail: parsed.data.showEmail,
    pdfShowPhone: parsed.data.showPhone,
    pdfShowWebsite: parsed.data.showWebsite,
    pdfShowCustomerNumber: parsed.data.showCustomerNumber,
    pdfShowPaymentMethod: parsed.data.showPaymentMethod,
    pdfShowTaxBreakdown: parsed.data.showTaxBreakdown,
    updatedAt: new Date(),
  };
  const [saved] = await db.insert(companySettings).values({ companyId: auth.ctx.company.id, ...values })
    .onConflictDoUpdate({ target: companySettings.companyId, set: values })
    .returning();
  await recordAudit({
    tenantId: auth.ctx.tenant.id,
    companyId: auth.ctx.company.id,
    actorUserId: auth.session.user.id,
    action: "company.pdf_settings.update",
    entityName: "companySettings",
    entityId: saved.id,
    payload: parsed.data,
  });
  return NextResponse.json(parsed.data);
}
