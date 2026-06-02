import { NextResponse } from "next/server";

import { requireUserSession } from "@/lib/current-user";
import { ensureUserTenant } from "@/lib/tenant";
import {
  getTenantSecurityPolicyState,
  updateTenantSecurityPolicy,
} from "@/server/security-policy";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";

export async function GET() {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant(session.user);
  const result = await getTenantSecurityPolicyState(ctx.tenant.id);

  return NextResponse.json({
    canManage: ctx.membership.role === "OWNER" || ctx.membership.role === "ADMIN",
    policy: result,
  });
}

export async function PUT(request: Request) {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant(session.user);
  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const result = await updateTenantSecurityPolicy({
    actorUserId: session.user.id,
    role: ctx.membership.role,
    tenantId: ctx.tenant.id,
    companyId: ctx.company.id,
    payload,
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ policy: result.policy, changes: result.changes }, { status: result.status });
}
