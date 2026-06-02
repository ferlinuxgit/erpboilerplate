import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { ACTIVE_COMPANY_COOKIE, ACTIVE_FISCAL_YEAR_COOKIE } from "@/lib/active-context";
import { getUserSession } from "@/lib/current-user";
import { requireContext } from "@/lib/current-context";
import { fiscalYear } from "@/db/schema";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";

const payloadSchema = z.object({
  companyId: z.string().trim().min(1),
  fiscalYearId: z.string().trim().min(1),
});

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });

  const ctx = await requireContext();
  return NextResponse.json({
    active: {
      companyId: ctx.company.id,
      fiscalYearId: ctx.fiscalYear.id,
    },
    availableCompanies: ctx.availableCompanies,
    availableFiscalYears: ctx.availableFiscalYears,
  });
}

export async function PATCH(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });

  const ctx = await requireContext();
  const isOwnedCompany = ctx.availableCompanies.some((entry) => entry.id === parsed.data.companyId);
  if (!isOwnedCompany) return NextResponse.json({ message: "Empresa inválida." }, { status: 404 });

  const companyFiscalYears = await db
    .select({ id: fiscalYear.id, code: fiscalYear.code })
    .from(fiscalYear)
    .where(eq(fiscalYear.companyId, parsed.data.companyId))
    .orderBy(asc(fiscalYear.startsAt));

  const hasFiscalYear =
    companyFiscalYears.some((entry) => entry.id === parsed.data.fiscalYearId) ||
    parsed.data.fiscalYearId === ctx.fiscalYear.id;
  if (!hasFiscalYear) return NextResponse.json({ message: "Ejercicio inválido." }, { status: 404 });

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_COMPANY_COOKIE, parsed.data.companyId, { httpOnly: false, sameSite: "lax", path: "/" });
  cookieStore.set(ACTIVE_FISCAL_YEAR_COOKIE, parsed.data.fiscalYearId, { httpOnly: false, sameSite: "lax", path: "/" });

  return NextResponse.json({ ok: true });
}
