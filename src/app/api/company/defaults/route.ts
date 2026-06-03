import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { applyCompanyDefaults, getCompanyDefaultsStatus } from "@/server/company/defaults";

export async function GET() {
  try {
    const ctx = await requireContext("settings.manage");
    const status = await getCompanyDefaultsStatus({
      companyId: ctx.company.id,
      fiscalYearId: ctx.fiscalYear.id,
      countryCode: ctx.company.countryCode,
    });
    return NextResponse.json(status);
  } catch {
    return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  }
}

export async function POST() {
  try {
    const ctx = await requireContext("settings.manage");
    const status = await applyCompanyDefaults({
      tenantId: ctx.tenant.id,
      companyId: ctx.company.id,
      fiscalYearId: ctx.fiscalYear.id,
      countryCode: ctx.company.countryCode,
      actorUserId: ctx.user.id,
    });
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "No se pudo aplicar la configuracion." },
      { status: 400 },
    );
  }
}
