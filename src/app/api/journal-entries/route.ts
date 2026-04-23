import { NextResponse } from "next/server";

import { getUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { createJournalEntry, listJournalEntries } from "@/server/accounting/service";

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "accounting.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  return NextResponse.json(await listJournalEntries(ctx.company.id));
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "accounting.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = (await request.json()) as { postedAt?: string; reference?: string; lines?: Array<{ accountId: string; debit: string; credit: string }> };
  if (!payload.postedAt || !payload.lines) return NextResponse.json({ message: "Faltan datos." }, { status: 400 });
  try {
    const created = await createJournalEntry(ctx.company.id, ctx.tenant.id, session.user.id, {
      postedAt: new Date(payload.postedAt),
      reference: payload.reference?.trim(),
      lines: payload.lines,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Error de validacion." }, { status: 400 });
  }
}
