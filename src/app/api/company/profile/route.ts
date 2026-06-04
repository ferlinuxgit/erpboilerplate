import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { company } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { normalizeSpanishTaxId } from "@/lib/spanish-tax-id";
import { recordAudit } from "@/server/audit";
import { companyProfileSchema } from "@/server/schemas/forms";

type CompanyProfilePayload = z.infer<typeof companyProfileSchema>;

function cleanOptional(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizePayload(payload: CompanyProfilePayload) {
  return {
    name: payload.name.trim(),
    legalName: cleanOptional(payload.legalName),
    vatNumber: payload.vatNumber ? normalizeSpanishTaxId(payload.vatNumber) : null,
    fiscalAddress: cleanOptional(payload.fiscalAddress),
    fiscalAddressLine2: cleanOptional(payload.fiscalAddressLine2),
    postalCode: cleanOptional(payload.postalCode),
    city: cleanOptional(payload.city),
    province: cleanOptional(payload.province),
    countryCode: payload.countryCode.trim().toUpperCase(),
    timezone: payload.timezone.trim(),
    baseCurrencyCode: payload.baseCurrencyCode.trim().toUpperCase(),
    email: cleanOptional(payload.email),
    phone: cleanOptional(payload.phone),
    website: cleanOptional(payload.website),
    logoDataUrl: cleanOptional(payload.logoDataUrl),
    invoiceFooter: cleanOptional(payload.invoiceFooter),
  };
}

async function requireCompanySettingsContext() {
  const session = await getUserSession();
  if (!session?.user) return { error: NextResponse.json({ message: "No autorizado." }, { status: 401 }) };

  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "settings.manage")) {
    return { error: NextResponse.json({ message: "Sin permisos." }, { status: 403 }) };
  }

  return { ctx, userId: session.user.id };
}

export async function GET() {
  const auth = await requireCompanySettingsContext();
  if ("error" in auth) return auth.error;

  const [profile] = await db
    .select()
    .from(company)
    .where(and(eq(company.id, auth.ctx.company.id), eq(company.tenantId, auth.ctx.tenant.id)))
    .limit(1);

  return NextResponse.json(profile ?? null);
}

export async function PUT(request: Request) {
  const auth = await requireCompanySettingsContext();
  if ("error" in auth) return auth.error;

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsed = companyProfileSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const values = normalizePayload(parsed.data);
  const [updated] = await db
    .update(company)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(company.id, auth.ctx.company.id), eq(company.tenantId, auth.ctx.tenant.id)))
    .returning();

  if (!updated) return NextResponse.json({ message: "Empresa no encontrada." }, { status: 404 });

  await recordAudit({
    tenantId: auth.ctx.tenant.id,
    companyId: auth.ctx.company.id,
    actorUserId: auth.userId,
    action: "company.profile.update",
    entityName: "company",
    entityId: auth.ctx.company.id,
    payload: values,
  });

  return NextResponse.json(updated);
}
