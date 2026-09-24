import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { ACTIVE_COMPANY_COOKIE, ACTIVE_FISCAL_YEAR_COOKIE, activeContextCookieOptions, writeActiveTenant } from "@/lib/active-context";
import { requireContext } from "@/lib/current-context";
import { company, fiscalYear } from "@/db/schema";
import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { listUserTenants } from "@/lib/tenant";

const payloadSchema = z
  .object({
    tenantId: z.string().trim().min(1).optional(),
    companyId: z.string().trim().min(1).optional(),
    fiscalYearId: z.string().trim().min(1).optional(),
  })
  .refine((value) => Boolean(value.tenantId) || (Boolean(value.companyId) && Boolean(value.fiscalYearId)), {
    message: "Indica el espacio o la empresa y el ejercicio.",
  })
  .refine((value) => Boolean(value.companyId) === Boolean(value.fiscalYearId), {
    message: "Empresa y ejercicio deben indicarse juntos.",
  });

export async function GET() {
  try {
    const ctx = await requireContext();
    const [allFiscalYears, availableTenants] = await Promise.all([
      db
        .select({ id: fiscalYear.id, code: fiscalYear.code, companyId: fiscalYear.companyId })
        .from(fiscalYear)
        .where(inArray(fiscalYear.companyId, ctx.availableCompanies.map((entry) => entry.id)))
        .orderBy(asc(fiscalYear.startsAt)),
      listUserTenants(ctx.user.id),
    ]);
    return NextResponse.json({
      active: {
        tenantId: ctx.tenant.id,
        companyId: ctx.company.id,
        fiscalYearId: ctx.fiscalYear.id,
      },
      availableTenants,
      availableCompanies: ctx.availableCompanies,
      availableFiscalYears: ctx.availableFiscalYears,
      availableFiscalYearsByCompany: Object.fromEntries(ctx.availableCompanies.map((entry) => [entry.id, allFiscalYears.filter((year) => year.companyId === entry.id).map(({ id, code }) => ({ id, code }))])),
      user: {
        name: ctx.user.name,
        email: ctx.user.email,
        role: ctx.membership.role,
      },
    });
  } catch (error) {
    return handleRouteError(error, "context.active.get");
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireContext();

    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();

    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Datos inválidos.");

    const targetTenantId = parsed.data.tenantId ?? ctx.tenant.id;
    if (targetTenantId !== ctx.tenant.id) {
      const tenants = await listUserTenants(ctx.user.id);
      if (!tenants.some((entry) => entry.id === targetTenantId)) return jsonError(404, "Espacio de trabajo inválido.");
    }

    let selection: { companyId: string; fiscalYearId: string } | undefined;
    if (parsed.data.companyId && parsed.data.fiscalYearId) {
      // Empresa del tenant destino (la membership ya está validada arriba) y ejercicio de esa empresa.
      const [owned] = await db
        .select({ fiscalYearId: fiscalYear.id })
        .from(company)
        .innerJoin(fiscalYear, and(eq(fiscalYear.companyId, company.id), eq(fiscalYear.id, parsed.data.fiscalYearId)))
        .where(and(eq(company.id, parsed.data.companyId), eq(company.tenantId, targetTenantId)))
        .limit(1);
      if (!owned) return jsonError(404, "Empresa o ejercicio inválido.");
      selection = { companyId: parsed.data.companyId, fiscalYearId: parsed.data.fiscalYearId };
    }

    const cookieStore = await cookies();
    if (targetTenantId !== ctx.tenant.id) {
      writeActiveTenant(cookieStore, targetTenantId, selection);
    } else if (selection) {
      const options = activeContextCookieOptions();
      cookieStore.set(ACTIVE_COMPANY_COOKIE, selection.companyId, options);
      cookieStore.set(ACTIVE_FISCAL_YEAR_COOKIE, selection.fiscalYearId, options);
    }

    return NextResponse.json({ ok: true, tenantId: targetTenantId });
  } catch (error) {
    return handleRouteError(error, "context.active.patch", "No se pudo cambiar el contexto.");
  }
}
